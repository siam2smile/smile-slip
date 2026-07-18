/**
 * /api/pos/customers — thin shim ที่ delegate ไปหา /api/pos/contacts
 * ระบบ customers ถูกรวมเข้ากับ contacts แล้ว (2026-07-06)
 * API นี้ยังใช้ได้เพื่อ backward compat แต่ filter เฉพาะ contact_type ≠ ผู้จำหน่าย
 */
import contactsHandler from './contacts';

export default function handler(req, res) {
  // map customer_id → contact_id ใน body/query
  if (req.body?.customer_id && !req.body?.contact_id) {
    req.body.contact_id = req.body.customer_id;
  }
  // GET: inject type filter for customers
  if (req.method === 'GET' && !req.query.type) {
    req.query.type = 'ลูกค้า';
  }
  return contactsHandler(req, res);
}
