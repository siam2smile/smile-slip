/**
 * บังคับสิทธิ์เจ้าของร้าน/แอดมินร้านก่อนทำ action ที่ละเอียดอ่อนใน API route — คู่ขนานกับ
 * lib/pos-auth.js (requirePermission สำหรับพนักงาน) แต่ผูกกับ owner-session แทน staff-session
 *
 * Phase A/B/C (ตอนนี้): endpoint ส่วนใหญ่ยัง "ไม่มี token เลย = ผ่านเสมอ" (non-breaking ระหว่าง
 * migration — เจ้าของร้านที่ยังไม่ได้ login ผ่าน flow ใหม่/deep-link จากบอทที่ยังไม่มี token
 * ต้องไม่ถูกบล็อกจนกว่า Phase B จะพิสูจน์เสถียรแล้ว) — endpoint ที่ถูกเลือกบังคับจริงในเฟส C
 * (เช่น shop/delete-shop.js) ต้องส่ง `{ enforce: true }` เพื่อปิด fallback นี้
 *
 * ไม่ว่า enforce จะเป็นอะไร — ถ้า "มี" token ที่ไม่ผ่าน verify หรือ shopId/role ไม่ตรง จะถูกบล็อก
 * เสมอ (การส่ง token ผิดมาแปลว่ามีความพยายามยืนยันตัวตนแต่ล้มเหลว ไม่ใช่กรณี "ไม่มี token" ที่จะ
 * ปล่อยผ่านได้)
 */
import { verifyOwnerSession } from './owner-session';

// แนบ session ได้ 2 ทาง: header `x-owner-session` (fetch() ปกติ) หรือ query param `ownerSession`
// (จำเป็นสำหรับดาวน์โหลดไฟล์ที่เปิดผ่าน window.open()/<a href> ตรงๆ เช่น export Excel/PDF ที่แนบ
// custom header ไม่ได้ — เหมือน pattern เดียวกับ extractSessionToken ใน lib/pos-auth.js)
function extractOwnerSessionToken(req) {
  return req.headers['x-owner-session'] || req.query?.ownerSession || null;
}

/**
 * คืน `true` ถ้าผ่าน (handler เรียกต่อได้ปกติ) คืน `false` ถ้าถูกบล็อก (เขียน response 401
 * ให้เรียบร้อยแล้ว handler แค่ต้อง `if (!requireOwnerAuth(...)) return;`)
 *
 * options:
 *   enforce         — true = ไม่มี token เลยก็บล็อกด้วย (ใช้เฉพาะ endpoint ที่ถูกเลือกในเฟส C)
 *   requireOwnerRole — true = ต้องเป็น role 'owner' เท่านั้น ไม่รับ 'admin' (เช่น ลบร้าน/จัดการแอดมิน)
 */
export function requireOwnerAuth(req, res, shopId, { enforce = false, requireOwnerRole = false } = {}) {
  const token = extractOwnerSessionToken(req);

  if (!token) {
    if (enforce) {
      res.status(401).json({ error: 'ต้องเข้าสู่ระบบก่อนทำรายการนี้ กรุณา login ใหม่' });
      return false;
    }
    return true; // Phase A/B: ไม่มี token = ยังไม่บล็อก (non-breaking)
  }

  const session = verifyOwnerSession(token);
  if (!session) {
    res.status(401).json({ error: 'session หมดอายุหรือไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่' });
    return false;
  }
  if (session.shopId !== shopId) {
    res.status(403).json({ error: 'ไม่มีสิทธิ์เข้าถึงร้านนี้' });
    return false;
  }
  if (requireOwnerRole && session.role !== 'owner') {
    res.status(403).json({ error: 'เฉพาะเจ้าของร้านเท่านั้นที่ทำรายการนี้ได้' });
    return false;
  }
  return true;
}

/** ดึง ownerId จาก session (ถ้ามี) — ใช้บันทึก "ผู้บันทึก"/audit trail ในบางจุด */
export function getSessionOwnerId(req) {
  const token = extractOwnerSessionToken(req);
  if (!token) return null;
  const session = verifyOwnerSession(token);
  return session?.ownerId || null;
}
