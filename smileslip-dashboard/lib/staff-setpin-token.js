/**
 * โทเคนเซ็นชื่อสำหรับลิงก์ "ตั้ง/เปลี่ยน PIN" ที่ส่งให้พนักงานทาง LINE (`/pos-staff?...&setpin=1`)
 *
 * เดิม endpoint `staff-setpin.js` ยึดหลัก "รู้ shopId+staff_id = ยืนยันตัวตนแล้ว" (แค่พิสูจน์ว่า
 * "มีลิงก์" ไม่ได้เซ็นชื่อ/ไม่มีวันหมดอายุ) — ถ้า shopId/staff_id หลุด (เดา/พบใน log/ URL ถูก
 * forward) ใครก็ตั้ง PIN ของพนักงานคนอื่นแทนได้ แล้วเข้าระบบเป็นคนนั้น (ได้สิทธิ์ตามที่พนักงาน
 * คนนั้นมี เช่น perm_manage_stock/perm_export_vat) — เปลี่ยนเป็นต้องมี token ที่เซ็นชื่อไว้คู่กัน
 *
 * ใช้ STAFF_SESSION_SECRET เดียวกับ lib/staff-session.js (คนละ trust domain — พนักงานทั้งคู่ — ไม่
 * อยากเพิ่ม secret ใหม่โดยไม่จำเป็น) แต่ **ต้องแยกฟังก์ชัน verify ต่างหาก ห้ามใช้ verifyStaffSession()
 * ปนกัน** เพราะ token นี้ออกให้ "ก่อน" มี PIN จริงด้วยซ้ำ (พิสูจน์แค่ "ลิงก์นี้เราออกเองจริง" ไม่ใช่
 * "คนนี้ authenticate แล้ว") — ใส่ purpose:'setpin' กำกับไว้ชัดเจน กัน token ประเภทนี้ถูกเข้าใจผิด/
 * ใช้แทน staff-session จริงได้ในโค้ดจุดอื่นที่อาจเพิ่มในอนาคต
 */
import crypto from 'crypto';

const TTL_SECONDS = 7 * 24 * 60 * 60; // 7 วัน — ลิงก์ตั้ง PIN อาจค้างไม่ได้เปิดในแชทนานกว่าลิงก์ใช้งานทั่วไป

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

/** ออก token — คืน null ถ้ายังไม่ได้ตั้ง STAFF_SESSION_SECRET (fail-closed) */
export function issueSetpinToken(shopId, staffId) {
  const secret = process.env.STAFF_SESSION_SECRET;
  if (!secret || !shopId || !staffId) return null;
  const payload = { shopId, staffId, purpose: 'setpin', exp: Math.floor(Date.now() / 1000) + TTL_SECONDS };
  const payloadB64 = base64url(JSON.stringify(payload));
  const sig = sign(payloadB64);
  if (!sig) return null;
  return `${payloadB64}.${sig}`;
}

/**
 * ตรวจสอบ token — ต้องตรงกับ shopId/staffId ที่ระบุมาด้วย (กันเอา token ของพนักงานคนหนึ่งไปตั้ง
 * PIN ให้อีกคน) และต้องมี purpose:'setpin' เท่านั้น — คืน true/false, fail-closed เสมอ (ไม่มี
 * secret/รูปแบบผิด/ลายเซ็นไม่ตรง/หมดอายุ/shopId-staffId ไม่ตรง/purpose ผิด ล้วนคืน false)
 */
export function verifySetpinToken(token, shopId, staffId) {
  if (!token || typeof token !== 'string') return false;
  const secret = process.env.STAFF_SESSION_SECRET;
  if (!secret) return false;

  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payloadB64, sig] = parts;

  const expectedSig = sign(payloadB64);
  if (!expectedSig) return false;

  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length) return false;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return false;

  let payload;
  try {
    payload = JSON.parse(base64urlDecode(payloadB64).toString('utf8'));
  } catch {
    return false;
  }

  if (!payload?.shopId || !payload?.staffId || !payload?.exp) return false;
  if (payload.purpose !== 'setpin') return false;
  if (Math.floor(Date.now() / 1000) > payload.exp) return false;
  if (payload.shopId !== shopId || payload.staffId !== staffId) return false;

  return true;
}
