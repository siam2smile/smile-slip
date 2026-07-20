/**
 * POST /api/cron/expire-trials
 * เช็คร้านที่ trial_ends_at หมดอายุแล้วและยังไม่มี Stripe subscription จริง (ยังไม่อัปเกรด) →
 * ตั้ง status = 'trial_expired' (บล็อกการเขียนข้อมูลฝั่ง POS + บอทสแกนสลิป — ดู lib/shop-access.js
 * และ smileslip-pro/index.js STEP 1.9 — ข้อมูลเดิมใน Google Sheets/Drive ของร้านไม่ถูกแตะเลย)
 * เรียกโดย Cloud Scheduler วันละครั้ง (ต้องส่ง x-cron-secret ตรงกับ CRON_SECRET)
 *
 * ร้านเก่าก่อน 2026-07-20 ไม่มี trial_started_at/trial_ends_at เลย (NULL) จึงไม่ตรงเงื่อนไข
 * .not('trial_ends_at', 'is', null) ด้านล่าง — ยกเว้นตลอดไปตามที่ผู้ใช้ตัดสินใจไว้
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
    .select('id, shop_name, trial_ends_at, stripe_subscription_id, status')
    .not('trial_ends_at', 'is', null)
    .lt('trial_ends_at', now)
    .is('stripe_subscription_id', null)
    .neq('status', 'trial_expired');

  if (error) {
    // คอลัมน์อาจยังไม่ถูกสร้าง (รอรัน SQL) — ไม่ทำให้ cron พังทั้งอัน แค่รายงาน error กลับ
    console.error('[cron/expire-trials] query error:', error.message);
    return res.status(500).json({ error: error.message });
  }

  let lockedCount = 0;
  for (const shop of expired || []) {
    const { error: updateErr } = await supabase
      .from('shop_profiles')
      .update({ status: 'trial_expired' })
      .eq('id', shop.id);
    if (!updateErr) {
      lockedCount++;
      console.log(`[cron/expire-trials] shop ${shop.id} (${shop.shop_name}) trial expired ${shop.trial_ends_at} → locked`);
    } else {
      console.error(`[cron/expire-trials] failed to lock shop ${shop.id}:`, updateErr.message);
    }
  }

  return res.status(200).json({ success: true, checked: expired?.length || 0, locked: lockedCount });
}
