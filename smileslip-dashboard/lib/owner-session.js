/**
 * ระบบ session ที่เซ็นชื่อ (signed) สำหรับเจ้าของร้าน/แอดมินร้าน — คู่ขนานกับ
 * lib/staff-session.js (ที่ใช้กับพนักงาน) แต่ผูกกับตัวตนที่พิสูจน์แล้วผ่าน LINE Login/Email Login
 *
 * ก่อนหน้านี้เจ้าของร้านไม่มี auth token ใดๆ เลย — ทุกหน้าเว็บ/ทุก API endpoint รู้ว่า
 * "ใครคือเจ้าของร้าน" จากค่า userId/shopId ที่เป็น query string เปลือยๆ เท่านั้น ไม่มีการเซ็นชื่อ
 * ไม่มีวันหมดอายุ ไม่มีการตรวจสอบใดๆ — ใช้ HMAC-SHA256 เซ็น payload
 * {shopId, ownerId, role, exp} ด้วย OWNER_SESSION_SECRET (ต้องตั้งใน env เสมอ ไม่มี fallback
 * — ถ้าไม่ตั้งค่านี้ถือว่าระบบ session เจ้าของร้านใช้งานไม่ได้ fail-closed)
 */
import crypto from 'crypto';

const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 วัน — เจ้าของร้านไม่ได้ "เข้ากะ" แบบพนักงาน ต้องอยู่ได้นานกว่ามาก

function base64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64');
}

function sign(payloadB64) {
  const secret = process.env.OWNER_SESSION_SECRET;
  if (!secret) return null;
  return base64url(crypto.createHmac('sha256', secret).update(payloadB64).digest());
}

/** ออก session token ใหม่หลังพิสูจน์ตัวตนสำเร็จ (LIFF/LINE OAuth/Email login) — คืน null ถ้ายังไม่ได้ตั้ง OWNER_SESSION_SECRET (fail-closed) */
export function issueOwnerSession({ shopId, ownerId, role }) {
  const secret = process.env.OWNER_SESSION_SECRET;
  if (!secret) {
    console.error('[owner-session] OWNER_SESSION_SECRET ยังไม่ได้ตั้งค่า — ออก session ไม่ได้');
    return null;
  }
  const payload = {
    shopId, ownerId, role: role === 'admin' ? 'admin' : 'owner',
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const payloadB64 = base64url(JSON.stringify(payload));
  const sig = sign(payloadB64);
  return `${payloadB64}.${sig}`;
}

/**
 * ตรวจสอบ session token — คืน {shopId, ownerId, role} ถ้าถูกต้องและยังไม่หมดอายุ, null ถ้าไม่ถูกต้อง
 * (ไม่มี secret / รูปแบบผิด / ลายเซ็นไม่ตรง / หมดอายุ ล้วนคืน null — fail-closed เสมอ ไม่เดา)
 */
export function verifyOwnerSession(token) {
  if (!token || typeof token !== 'string') return null;
  const secret = process.env.OWNER_SESSION_SECRET;
  if (!secret) return null;

  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;

  const expectedSig = sign(payloadB64);
  if (!expectedSig) return null;

  // timing-safe comparison กัน timing attack เดา signature
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

  let payload;
  try {
    payload = JSON.parse(base64urlDecode(payloadB64).toString('utf8'));
  } catch {
    return null;
  }

  if (!payload?.shopId || !payload?.ownerId || !payload?.exp) return null;
  if (Math.floor(Date.now() / 1000) > payload.exp) return null; // หมดอายุ

  return { shopId: payload.shopId, ownerId: payload.ownerId, role: payload.role === 'admin' ? 'admin' : 'owner' };
}
