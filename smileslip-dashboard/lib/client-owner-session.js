/**
 * Helper ฝั่ง browser เท่านั้น สำหรับเก็บ/อ่าน owner-session token ใน localStorage
 * (คู่ขนานกับ sessionStorage key `pos_staff_session_${shopId}`/`pos_cashier_session_${shopId}`
 * ที่ pos-staff.js/pos.js ใช้กับพนักงาน — แต่ owner ใช้ localStorage ไม่ใช่ sessionStorage
 * เพราะต้องอยู่รอดข้ามการปิด/เปิดแท็บใหม่ได้ เช่น กดลิงก์จากบอท LINE เปิดแท็บใหม่บ่อยๆ)
 *
 * token เองไม่ได้ verify signature ฝั่ง client (ทำไม่ได้เพราะไม่รู้ secret และไม่จำเป็น —
 * แค่เช็ค exp คร่าวๆ เพื่อตัดสินใจว่าต้อง redirect ไป /login ใหม่ก่อนไหม backend จะ verify
 * signature จริงอีกทีเสมอ)
 */

function storageKey(shopId) {
  return `owner_session_${shopId}`;
}

function decodePayload(token) {
  try {
    const [payloadB64] = token.split('.');
    if (!payloadB64) return null;
    const b64 = payloadB64.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

/** คืน token string ถ้ามีและยังไม่หมดอายุ (เช็คจาก exp ในตัว payload) — null ถ้าไม่มี/หมดอายุ/รูปแบบผิด */
export function getOwnerSessionToken(shopId) {
  if (typeof window === 'undefined' || !shopId) return null;
  const token = window.localStorage.getItem(storageKey(shopId));
  if (!token) return null;
  const payload = decodePayload(token);
  if (!payload?.exp) return null;
  if (Math.floor(Date.now() / 1000) > payload.exp) {
    window.localStorage.removeItem(storageKey(shopId));
    return null;
  }
  return token;
}

export function setOwnerSessionToken(shopId, token) {
  if (typeof window === 'undefined' || !shopId || !token) return;
  window.localStorage.setItem(storageKey(shopId), token);
}

export function clearOwnerSessionToken(shopId) {
  if (typeof window === 'undefined' || !shopId) return;
  window.localStorage.removeItem(storageKey(shopId));
}

/** ล้าง owner-session token ของทุกร้านที่เคยล็อกอินไว้บนเครื่องนี้ — ใช้ตอน logout เท่านั้น
 * (ไม่รู้ shopId เจาะจงตอน logout เพราะเป็นหน้าทั่วไป ไม่ผูกร้านใดร้านหนึ่ง) */
export function clearAllOwnerSessionTokens() {
  if (typeof window === 'undefined') return;
  const keys = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (k && k.startsWith('owner_session_')) keys.push(k);
  }
  keys.forEach(k => window.localStorage.removeItem(k));
}
