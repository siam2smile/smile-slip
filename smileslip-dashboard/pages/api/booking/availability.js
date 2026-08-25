/**
 * GET /api/booking/availability?shopId=xxx&serviceId=xxx&date=YYYY-MM-DD&providerId=xxx(ถ้าบริการนั้น
 * ต้องเลือกพนักงาน) — สาธารณะ ไม่ต้อง login — คืนช่วงเวลาที่จองได้จริงตอนนี้ของวันนั้น
 *
 * คำนวณสด ไม่มีตาราง "ตารางว่าง" แยกเก็บไว้ล่วงหน้า — logic เดียวกันเป๊ะกับที่ reserve.js ใช้
 * ยืนยันซ้ำก่อนบันทึกจริง (ผ่าน lib/booking.js's getAvailableSlots ร่วมกัน กัน logic สองไฟล์ drift)
 */
import { createClient } from '@supabase/supabase-js';
import { configFromRow, getAvailableSlots } from '../../../lib/booking';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { shopId, serviceId, date, providerId } = req.query;
  if (!shopId || !serviceId || !date) return res.status(400).json({ error: 'ข้อมูลไม่ครบ' });

  try {
    const [{ data: configRow }, { data: serviceRow }] = await Promise.all([
      supabase.from('booking_configs').select('*').eq('shop_id', shopId).maybeSingle(),
      supabase.from('booking_services').select('*').eq('id', serviceId).eq('shop_id', shopId).is('deleted_at', null).maybeSingle(),
    ]);
    if (!serviceRow || serviceRow.is_active === false) return res.status(404).json({ error: 'ไม่พบบริการนี้ หรือปิดให้บริการแล้ว' });
    const config = configFromRow(configRow) || configFromRow({});
    if (!config.enabled) return res.status(403).json({ error: 'ร้านนี้ยังไม่เปิดรับจองในขณะนี้' });

    const { slots, error } = await getAvailableSlots(supabase, { shopId, service: serviceRow, config, dateStr: date, providerId });
    if (error) return res.status(400).json({ error });
    return res.json({ slots });
  } catch (err) {
    console.error('[booking/availability]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
