/**
 * POST /api/cron/purge-deleted-shops
 * ไล่ล้างร้านที่ถูก soft-delete (ข้อ 91, 6-month retention) ไว้เกิน RETENTION_MONTHS เดือนแล้ว —
 * เรียก deleteShopCompletely() จริง (hard delete ล้างข้อมูลลูกทุกตารางถาวร กู้คืนไม่ได้อีกต่อไป)
 * เรียกโดย Cloud Scheduler วันละครั้ง (ต้องส่ง x-cron-secret ตรงกับ CRON_SECRET)
 *
 * ไม่ต้องยกเลิก Stripe/บันทึก trial_used_line_ids ซ้ำ — ทั้งสองอย่างทำไปแล้วตั้งแต่ตอน soft-delete
 * (softDeleteShop() ตอนกดลบครั้งแรก) deleteShopCompletely() แค่ล้างข้อมูลลูก+แถวหลักจริงเท่านั้น
 */
import { createClient } from '@supabase/supabase-js';
import { deleteShopCompletely, RETENTION_MONTHS } from '../../../lib/shop-deletion';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const secret = req.headers['x-cron-secret'] || req.query.secret;
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const cutoffIso = new Date(Date.now() - RETENTION_MONTHS * 30 * 24 * 3600 * 1000).toISOString();

  const { data: expired, error } = await supabase
    .from('shop_profiles')
    .select('id, shop_name, deleted_at')
    .not('deleted_at', 'is', null)
    .lt('deleted_at', cutoffIso);

  if (error) {
    // คอลัมน์อาจยังไม่ถูกสร้าง (รอรัน SQL) — ไม่ทำให้ cron พังทั้งอัน แค่รายงาน error กลับ
    console.error('[cron/purge-deleted-shops] query error:', error.message);
    return res.status(500).json({ error: error.message });
  }

  const results = [];
  for (const shop of (expired || [])) {
    try {
      const result = await deleteShopCompletely(shop.id);
      results.push({ shopId: shop.id, shopName: shop.shop_name, ok: !!result.success, error: result.notFound ? 'notFound' : null });
    } catch (err) {
      console.error(`[cron/purge-deleted-shops] purge ${shop.id} failed:`, err.message);
      results.push({ shopId: shop.id, shopName: shop.shop_name, ok: false, error: err.message });
    }
  }

  console.log(`[cron/purge-deleted-shops] purged ${results.filter(r => r.ok).length}/${results.length} shops (retention cutoff: ${cutoffIso})`);
  return res.status(200).json({ ok: true, checked: expired?.length || 0, purged: results.filter(r => r.ok).length, results });
}
