/**
 * GET /api/promotion
 * ดึงโปรโมชั่นที่ active อยู่ปัจจุบัน — public, ใช้แสดงในหน้า pricing/index
 * เช็ค validUntil อัตโนมัติ ถ้าหมดอายุแล้วถือว่าไม่ active
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { data } = await supabase.from('admin_settings').select('value').eq('key', 'active_promotion').maybeSingle();
  if (!data?.value) return res.status(200).json({ promotion: null });

  const promo = JSON.parse(data.value);
  if (!promo.enabled) return res.status(200).json({ promotion: null });

  if (promo.validUntil) {
    const today = new Date().toISOString().slice(0, 10);
    if (today > promo.validUntil) return res.status(200).json({ promotion: null });
  }

  return res.status(200).json({ promotion: promo });
}
