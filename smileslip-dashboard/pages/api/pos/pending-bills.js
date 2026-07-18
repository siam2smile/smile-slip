/**
 * GET /api/pos/pending-bills?shopId=xxx
 * คืนบิลที่มีสถานะ "รอยืนยัน" (transfer ที่ยังไม่ได้รับสลิป)
 */
import { createClient } from '@supabase/supabase-js';
import { getAccessToken, readSheet, ensureTabExists, rowToSale, SALE_HEADERS } from '../../../lib/google-pos';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { shopId } = req.query;
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });

  try {
    const [{ data: pc }, { data: gc }, { data: sp }] = await Promise.all([
      supabase.from('pos_configs').select('pos_sheet_id').eq('shop_id', shopId).single(),
      supabase.from('shop_google_configs').select('google_refresh_token').eq('shop_id', shopId).single(),
      supabase.from('shop_profiles').select('shop_name').eq('id', shopId).single(),
    ]);

    if (!pc?.pos_sheet_id || !gc?.google_refresh_token) {
      return res.json({ bills: [], shopName: sp?.shop_name || '' });
    }

    const token = await getAccessToken(gc.google_refresh_token);
    await ensureTabExists(token, pc.pos_sheet_id, 'ยอดขาย', SALE_HEADERS);

    const rows = await readSheet(token, pc.pos_sheet_id, 'ยอดขาย!A:L');
    const bills = rows.slice(1)
      .map((r, i) => ({ ...rowToSale(r), _row: i + 2 }))
      .filter(b => b.bill_no && b.status === 'รอยืนยัน')
      .reverse(); // ล่าสุดก่อน

    return res.json({ bills, shopName: sp?.shop_name || '' });

  } catch (err) {
    console.error('[pending-bills]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
