/**
 * GET /api/pos/pending-bills?shopId=xxx
 * คืนบิลที่มีสถานะ "รอยืนยัน" (transfer ที่ยังไม่ได้รับสลิป)
 *
 * Phase 2 (write-primary flip, 2026-07-29): อ่านจาก Supabase (pos_sales) แทน Sheets แล้ว
 */
import { createClient } from '@supabase/supabase-js';
import { saleFromRow } from '../../../lib/google-pos';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { shopId } = req.query;
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });

  try {
    const { data: sp } = await supabase.from('shop_profiles').select('shop_name').eq('id', shopId).maybeSingle();
    const { data, error } = await supabase.from('pos_sales').select('*')
      .eq('shop_id', shopId).is('deleted_at', null).eq('status', 'รอยืนยัน')
      .order('created_at', { ascending: false });
    if (error) throw error;

    const bills = (data || []).map(saleFromRow).filter(b => b.bill_no);
    return res.json({ bills, shopName: sp?.shop_name || '' });

  } catch (err) {
    console.error('[pending-bills]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
