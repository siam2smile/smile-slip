/**
 * POST /api/pos/staff-setpin { shopId, staff_id, pin }
 * พนักงานตั้ง/เปลี่ยน PIN ของตัวเอง — เข้าถึงหน้านี้ได้จากลิงก์ที่ส่งทาง LINE เท่านั้น
 * (การมีลิงก์คือการยืนยันตัวตน เหมือน pattern เดียวกับลิงก์ยืนยันงานจัดส่ง/เก็บเงินที่มีอยู่แล้ว)
 *
 * Phase 2 (write-primary flip, 2026-07-29): อ่าน/เขียนจาก Supabase (pos_staff) แทน Sheets แล้ว
 * ไม่ต้องเช็ค PIN ซ้ำกับคนอื่นในร้านอีกต่อไป (เดิมเช็คเพราะ verify-pin.js เคยค้นหา PIN เดี่ยวๆ ข้าม
 * พนักงานทั้งร้าน) — verify-pin.js ระบุตัวตนด้วย staff_id/line_id ก่อนเสมอแล้วเช็ค PIN เฉพาะคนนั้น
 * ทำให้ 2 คนตั้ง PIN ซ้ำกันได้แล้วโดยไม่มีปัญหา (คนละแถวกันในตาราง)
 */
import { supabase } from '../../../lib/supabase-pos';
import { verifySetpinToken } from '../../../lib/staff-setpin-token';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { shopId, staff_id, pin, token } = req.body || {};
  if (!shopId || !staff_id || !pin) return res.status(400).json({ error: 'Missing shopId, staff_id, or pin' });
  if (!/^\d{4}$/.test(String(pin))) return res.status(400).json({ error: 'PIN ต้องเป็นตัวเลข 4 หลัก' });

  // ต้องมี token ที่เซ็นชื่อไว้คู่กับ shopId+staff_id นี้เท่านั้น (ออกให้ตอนส่งลิงก์ทาง LINE) — เดิม
  // "รู้ shopId+staff_id" อย่างเดียวก็ตั้ง PIN แทนคนอื่นได้ ปิดช่องโหว่นี้ — ลิงก์เก่าก่อนแก้ (ไม่มี
  // token) จะใช้ไม่ได้อีกต่อไป ต้องกดส่งลิงก์ใหม่จากหน้าตั้งค่าพนักงาน (ตั้งใจ ไม่ใช่บั๊ก)
  if (!verifySetpinToken(token, shopId, staff_id)) {
    return res.status(401).json({ error: 'ลิงก์นี้หมดอายุหรือไม่ถูกต้อง กรุณาขอลิงก์ตั้ง PIN ใหม่จากแอดมิน/เจ้าของร้าน' });
  }

  try {
    const { data: existing, error: fetchErr } = await supabase.from('pos_staff').select('name')
      .eq('shop_id', shopId).eq('staff_id', staff_id).is('deleted_at', null).maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!existing) return res.status(404).json({ error: 'ไม่พบพนักงาน' });

    const { error } = await supabase.from('pos_staff').update({ pin: String(pin) })
      .eq('shop_id', shopId).eq('staff_id', staff_id);
    if (error) throw error;

    return res.json({ ok: true, name: existing.name || '' });
  } catch (err) {
    console.error('[staff-setpin]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
