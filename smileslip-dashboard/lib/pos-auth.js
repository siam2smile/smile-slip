/**
 * บังคับสิทธิ์ก่อนทำ action ที่ละเอียดอ่อนใน API route ของ POS — ใช้ร่วมกันทุกไฟล์ที่ต้องเช็ค
 * สิทธิ์เชิงลึกของพนักงาน (แทนที่การเช็ค `if (staffId)` แบบเดิมที่กระจาย/ไม่ครบทุก endpoint)
 */
import { verifyStaffSession } from './staff-session';
import { getStaffPermissions } from './google-pos';

// แนบ session ได้ 2 ทาง: header `x-staff-session` (ทุก fetch() ปกติ) หรือ query param `session`
// (จำเป็นสำหรับดาวน์โหลดไฟล์ที่เปิดผ่าน window.open()/<a href> ตรงๆ เช่น export VAT/PDF ที่แนบ
// custom header ไม่ได้ — ทั้งสองทางตรวจสอบลายเซ็นเดียวกันทุกประการ ปลอมไม่ได้เหมือนกัน)
function extractSessionToken(req) {
  return req.headers['x-staff-session'] || req.query?.session || null;
}

/**
 * ไม่มี session เลย = เจ้าของร้าน/แอดมิน (เข้าผ่าน Dashboard ปกติ) — ทำงานเหมือนเดิมทุกประการ
 * ไม่ถูกกระทบเลย (zero regression risk)
 *
 * มี session = พนักงานที่เข้าผ่าน PIN (แคชเชียร์/พนักงานส่งของ) — ต้องมีสิทธิ์ `permKey` จริง
 * เท่านั้น ดึงสิทธิ์สดจาก Sheet ทุกครั้ง ไม่เชื่อค่าที่ฝังใน token (แอดมินถอนสิทธิ์ต้องมีผลทันที
 * ไม่ใช่รอ token หมดอายุ)
 *
 * คืน `true` ถ้าผ่าน (handler เรียกต่อได้ปกติ) คืน `false` ถ้าถูกบล็อก (เขียน response
 * 401/403 ให้เรียบร้อยแล้ว handler แค่ต้อง `if (!(await requirePermission(...))) return;`)
 */
export async function requirePermission(req, res, token, sheetId, permKey) {
  const sessionToken = extractSessionToken(req);
  if (!sessionToken) return true;

  const session = verifyStaffSession(sessionToken);
  if (!session) {
    res.status(401).json({ error: 'session พนักงานหมดอายุหรือไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่' });
    return false;
  }

  const perms = await getStaffPermissions(token, sheetId, session.staffId);
  if (!perms[permKey]) {
    res.status(403).json({ error: 'คุณไม่มีสิทธิ์ทำรายการนี้ — ติดต่อเจ้าของร้าน/แอดมินให้เปิดสิทธิ์ให้ก่อน' });
    return false;
  }
  return true;
}

/**
 * บล็อกไม่ให้ session พนักงานทำรายการนี้ได้เลยไม่ว่าจะมีสิทธิ์อะไรก็ตาม (เช่น pos-config.js
 * แก้ค่าธนาคาร/API key ของร้าน — ไม่มีสิทธิ์ไหนควรปลดล็อคให้พนักงานแตะได้เด็ดขาด)
 */
export function blockAllStaffSessions(req, res) {
  const sessionToken = extractSessionToken(req);
  if (!sessionToken) return true;
  res.status(403).json({ error: 'พนักงานไม่มีสิทธิ์แก้ไขการตั้งค่านี้ — ต้องเข้าผ่านบัญชีเจ้าของร้าน/แอดมินเท่านั้น' });
  return false;
}

/** ดึง staffId จาก session (ถ้ามี) — ใช้บันทึก "ผู้บันทึก"/audit trail ในบางจุด */
export function getSessionStaffId(req) {
  const sessionToken = extractSessionToken(req);
  if (!sessionToken) return null;
  const session = verifyStaffSession(sessionToken);
  return session?.staffId || null;
}
