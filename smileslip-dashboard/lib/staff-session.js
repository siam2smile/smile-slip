/**
 * ระบบ session ที่เซ็นชื่อ (signed) สำหรับพนักงานที่เข้าระบบผ่าน PIN — ใช้ร่วมกันทั้ง
 * `/pos?mode=cashier` (แคชเชียร์หน้าร้าน) และ `/pos-staff` (แอปพนักงานส่งของ/เก็บเงิน)
 *
 * ก่อนหน้านี้ทั้งสองหน้าไม่มี session ที่พิสูจน์ได้เลยว่า "staffId นี้มาจากการใส่ PIN ถูกจริง"
 * — เป็นแค่ค่าธรรมดาที่ React state เก็บไว้ (ปลอมได้ตรงๆ ถ้ายิง API เอง) และหายทันทีที่รีเฟรชหน้า
 * ใช้ HMAC-SHA256 เซ็น payload {shopId, staffId, exp} ด้วย STAFF_SESSION_SECRET (ต้องตั้งใน env
 * เสมอ ไม่มี fallback — ถ้าไม่ตั้งค่านี้ถือว่าระบบ session พนักงานใช้งานไม่ได้ fail-closed)
 */
import crypto from 'crypto';

const SESSION_TTL_SECONDS = 14 * 60 * 60; // ~14 ชม. ครอบคลุมกะทำงานยาวสุด

function base64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64');
}

function sign(payloadB64) {
  const secret = process.env.STAFF_SESSION_SECRET;
  if (!secret) return null;
  return base64url(crypto.createHmac('sha256', secret).update(payloadB64).digest());
}

/** ออก session token ใหม่หลัง PIN ถูกต้อง — คืน null ถ้ายังไม่ได้ตั้ง STAFF_SESSION_SECRET (fail-closed) */
export function issueStaffSession(shopId, staffId) {
  const secret = process.env.STAFF_SESSION_SECRET;
  if (!secret) {
    console.error('[staff-session] STAFF_SESSION_SECRET ยังไม่ได้ตั้งค่า — ออก session ไม่ได้');
    return null;
  }
  const payload = { shopId, staffId, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS };
  const payloadB64 = base64url(JSON.stringify(payload));
  const sig = sign(payloadB64);
  return `${payloadB64}.${sig}`;
}

/**
 * ตรวจสอบ session token — คืน {shopId, staffId} ถ้าถูกต้องและยังไม่หมดอายุ, null ถ้าไม่ถูกต้อง
 * (ไม่มี secret / รูปแบบผิด / ลายเซ็นไม่ตรง / หมดอายุ ล้วนคืน null — fail-closed เสมอ ไม่เดา)
 */
export function verifyStaffSession(token) {
  if (!token || typeof token !== 'string') return null;
  const secret = process.env.STAFF_SESSION_SECRET;
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

  if (!payload?.shopId || !payload?.staffId || !payload?.exp) return null;
  if (Math.floor(Date.now() / 1000) > payload.exp) return null; // หมดอายุ

  return { shopId: payload.shopId, staffId: payload.staffId };
}
