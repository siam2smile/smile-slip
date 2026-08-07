// smileslip-pro/lib/owner-session-sign.js
// ออก owner-session token ที่เซ็นชื่อไว้ในลิงก์ deep-link ที่บอทส่งให้เจ้าของร้านทาง LINE — ใช้
// อัลกอริทึมเดียวกับ smileslip-dashboard/lib/owner-session.js เป๊ะ (HMAC-SHA256, base64url,
// payload {shopId, ownerId, role, exp}) ต้องแชร์ค่า OWNER_SESSION_SECRET เดียวกันทั้งสองฝั่ง —
// dashboard's verifyOwnerSession() ตรวจสอบ token นี้ได้ตรงๆ โดยไม่ต้องแก้อะไรฝั่ง dashboard เลย
//
// เดิม deep-link ของบอททุกจุด (~11 จุด) ใช้ `?userId=${shop.owner_line_id}` เปลือยๆ เป็นตัวพิสูจน์
// ตัวตนเดียว — ไม่มีวันหมดอายุ ไม่มีลายเซ็น ถ้าหลุด/ถูก forward ต่อใครก็เข้าดูข้อมูลร้านได้ตลอดไป
// (แม้ Phase D ของ owner-session overhaul จะบล็อกฝั่ง "เขียน" ไปมากแล้ว แต่ฝั่ง "อ่าน" ยังหลุดอยู่
// บางจุด) — เปลี่ยนเป็นแนบ token อายุสั้น (24 ชม.) คู่กับ userId เดิม (คง userId ไว้เพื่อ backward
// compat กับหน้าที่ยังไม่รองรับ token และเพื่อไม่ให้ query param เปลี่ยนชื่อทำ URL เก่าที่แชร์ไปแล้วพัง)
const crypto = require('crypto');

const DEEPLINK_TTL_SECONDS = 24 * 60 * 60; // 24 ชม. — สั้นกว่า login-session (30 วัน) เพราะเป็นลิงก์
// ที่ตั้งใจให้กดใช้ทันทีหลังบอทส่งข้อความ ไม่ใช่ session ยาวแบบ login ปกติ

function base64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sign(payloadB64) {
  const secret = process.env.OWNER_SESSION_SECRET;
  if (!secret) return null;
  return base64url(crypto.createHmac('sha256', secret).update(payloadB64).digest());
}

/**
 * ออก token เซ็นชื่อสำหรับ deep-link — คืน null ถ้ายังไม่ได้ตั้ง OWNER_SESSION_SECRET (fail-closed
 * แบบเดียวกับฝั่ง dashboard) — caller ต้อง fallback เป็นไม่แนบ token ถ้าได้ null (ลิงก์ยังใช้ userId
 * เดิมได้อยู่ ไม่พัง แค่ไม่มี owner-session ให้ dashboard consume)
 */
function issueDeepLinkToken(shopId, ownerLineId) {
  const secret = process.env.OWNER_SESSION_SECRET;
  if (!secret || !shopId || !ownerLineId) return null;
  const payload = {
    shopId, ownerId: ownerLineId, role: 'owner',
    exp: Math.floor(Date.now() / 1000) + DEEPLINK_TTL_SECONDS,
  };
  const payloadB64 = base64url(JSON.stringify(payload));
  const sig = sign(payloadB64);
  if (!sig) return null;
  return `${payloadB64}.${sig}`;
}

/**
 * สร้าง URL เต็มไปหน้า dashboard พร้อม userId (เดิม, คงไว้เพื่อ backward compat) + ownerSession
 * (ใหม่, ถ้าออกได้) — path ต้องขึ้นต้นด้วย '/' เช่น '/dashboard', '/pos', '/pricing'
 * extraParams เป็น object ของ query param เพิ่มเติม เช่น { ref: fingerprint, year: 2026 }
 */
function ownerDeepLink(shop, path, extraParams = {}) {
  const base = process.env.FRONTEND_URL || '';
  const params = new URLSearchParams({ userId: shop.owner_line_id });
  for (const [k, v] of Object.entries(extraParams)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, v);
  }
  const token = issueDeepLinkToken(shop.id, shop.owner_line_id);
  if (token) params.set('ownerSession', token);
  return `${base}${path}?${params.toString()}`;
}

module.exports = { issueDeepLinkToken, ownerDeepLink, DEEPLINK_TTL_SECONDS };
