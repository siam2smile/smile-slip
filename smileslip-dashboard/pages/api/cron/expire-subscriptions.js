/**
 * POST /api/cron/expire-subscriptions
 * เช็คร้านที่ Admin ตั้ง tier มือไว้แล้ว subscription_expires_at หมดอายุแล้ว → downgrade กลับ normal
 * เรียกโดย Cloud Scheduler วันละครั้ง (ต้องส่ง x-cron-secret ตรงกับ CRON_SECRET)
 */
import { createClient } from '@supabase/supabase-js';

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

  const now = new Date().toISOString();

  const { data: expired, error } = await supabase
    .from('shop_profiles')
    .select('id, shop_name, subscription_tier, subscription_expires_at')
    .lt('subscription_expires_at', now)
    .not('subscription_tier', 'eq', 'normal');

  if (error) {
    console.error('[cron/expire-subscriptions] query error:', error.message);
    return res.status(500).json({ error: error.message });
  }

  let downgraded = 0;
  for (const shop of expired || []) {
    const { error: updateErr } = await supabase
      .from('shop_profiles')
      .update({ subscription_tier: 'normal', subscription_expires_at: null })
      .eq('id', shop.id);
    if (!updateErr) {
      downgraded++;
      console.log(`[cron/expire-subscriptions] shop ${shop.id} (${shop.shop_name}) tier ${shop.subscription_tier} expired ${shop.subscription_expires_at} → downgraded to normal`);
    } else {
      console.error(`[cron/expire-subscriptions] failed to downgrade shop ${shop.id}:`, updateErr.message);
    }
  }

  return res.status(200).json({ success: true, checked: expired?.length || 0, downgraded });
}
