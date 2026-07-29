/**
 * GET /api/pos/staff-picker?shopId=xxx&mode=cashier
 * → รายชื่อพนักงานขั้นต่ำสุดสำหรับหน้า "เลือกชื่อตัวเอง" ก่อนใส่ PIN (แทนการพิมพ์ PIN เดี่ยวๆ
 *   แล้วให้ระบบไล่หาว่าใครในร้านตั้งไว้ — ดู verify-pin.js/staff-setpin.js สำหรับเหตุผลเต็ม)
 *
 * ไม่ต้องยืนยันตัวตนใดๆ (เรียกได้ก่อนรู้ว่าใครกำลังใช้เครื่อง) แต่คืนแค่ชื่อ+สาขา เท่านั้น —
 * ไม่คืนเบอร์โทร/LINE ID/สิทธิ์ต่างๆ เพื่อไม่เปิดเผยข้อมูลเกินจำเป็นที่หน้าจอนี้ยังไม่มีใครยืนยัน
 * ตัวตนเลย (แม้ endpoint อื่นในระบบ POS ส่วนใหญ่จะไม่บังคับ auth เหมือนกันอยู่แล้วก็ตาม)
 *
 * `mode=cashier` (ใช้จาก /pos?mode=cashier เท่านั้น) — กรองพนักงานที่มีแค่สิทธิ์งานจัดส่ง/เก็บเงิน
 * ล้วนๆ ออกจากรายชื่อไปเลย (เข้าหน้าขายเต็มรูปแบบไม่ได้อยู่ดี ตาม verify-pin.js — ซ่อนชื่อไว้ตั้งแต่
 * ต้นกันสับสนว่าทำไมกดชื่อแล้วใส่ PIN ถูกแต่เข้าไม่ได้) — /pos-staff ไม่ส่ง mode นี้มา จึงยังเห็น
 * ทุกคนตามปกติ (ใครก็ใช้แอปพนักงานได้ ไม่ผูกกับสิทธิ์เฉพาะเจาะจง)
 *
 * Phase 2 (write-primary flip, 2026-07-29): อ่านจาก Supabase (pos_staff) แทน Sheets แล้ว
 */
import { supabase } from '../../../lib/supabase-pos';
import { staffFromRow, staffQualifiesForCashier } from '../../../lib/google-pos';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { shopId, mode } = req.query;
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });

  try {
    const { data, error } = await supabase.from('pos_staff').select('*')
      .eq('shop_id', shopId).is('deleted_at', null).order('created_at', { ascending: true });
    if (error) throw error;

    const staff = (data || [])
      .map(staffFromRow)
      .filter(s => s.staff_id && s.name && s.has_pin) // ยังไม่ตั้ง PIN = เลือกแล้วก็ล็อกอินไม่ได้อยู่ดี ไม่ต้องโชว์
      .filter(s => mode !== 'cashier' || staffQualifiesForCashier(s)) // โหมดแคชเชียร์ซ่อนพนักงานส่งของล้วนๆ
      .map(s => ({ staff_id: s.staff_id, name: s.name.trim(), branch_name: s.branch_name || '' }));

    return res.json({ staff });
  } catch (err) {
    console.error('[staff-picker]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
