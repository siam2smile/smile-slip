/**
 * POST /api/pos/verify-pin { shopId, pin }
 * ตรวจสอบ Staff PIN → { ok: true } หรือ 401
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { shopId, pin } = req.body || {};
  if (!shopId || !pin) return res.status(400).json({ error: 'Missing shopId or pin' });

  const { data, error } = await supabase
    .from('pos_configs')
    .select('staff_pin, pos_sheet_id')
    .eq('shop_id', shopId)
    .single();

  if (error || !data) return res.status(404).json({ error: 'ไม่พบร้านค้า' });
  if (!data.staff_pin) return res.status(400).json({ error: 'ยังไม่ได้ตั้ง Staff PIN' });
  if (data.staff_pin !== String(pin)) return res.status(401).json({ error: 'PIN ไม่ถูกต้อง' });

  return res.json({ ok: true, hasSheet: !!data.pos_sheet_id });
}
