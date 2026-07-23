import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

/**
 * DELETE /api/shop/delete-shop { shopId, lineUserId, confirmShopName }
 *
 * ลบร้านแบบถาวร (hard delete) — ใช้ตอนเจ้าของร้านเลือก "ลบร้านเดิมแล้วสมัครใหม่" ในหน้า register.js
 * เจตนาของผู้ใช้ชัดเจนว่าต้องเป็นการลบจริง ไม่ใช่ soft-delete เพราะต้องปิดช่องโหว่ลบแล้วสมัครใหม่
 * เพื่อขอสิทธิ์ทดลองฟรี 30 วันซ้ำไม่จำกัดรอบ (ดู trial_used_line_ids ที่บันทึกไว้ "ก่อน" ลบเสมอ
 * เพราะตารางนั้นแยกจาก shop_profiles โดยเจตนา อยู่รอดข้ามการลบร้านนี้)
 *
 * ความปลอดภัย:
 * - ต้องเป็นเจ้าของร้านจริงเท่านั้น (แอดมินร้านลบร้านที่ตัวเองแค่ดูแลอยู่ไม่ได้)
 * - ต้องพิมพ์ชื่อร้านให้ตรงเป๊ะก่อนเสมอ (กันกดพลาด/สคริปต์ยิงมั่ว)
 * - ถ้ามี subscription Stripe ที่ active อยู่ ต้องยกเลิกทันที (ไม่ใช่รอสิ้นรอบบิล) ก่อนลบ
 *   ไม่งั้นลูกค้าจะโดนเก็บเงินต่อไปเรื่อยๆ ทั้งที่ไม่มีร้าน/dashboard ให้เข้าไปยกเลิกเองแล้ว
 */

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

// ตารางทั้งหมดที่รู้จักว่าผูกกับ shop_id — ลบเองตรงๆ ก่อนลบ shop_profiles เสมอ ไม่พึ่ง
// ON DELETE CASCADE อย่างเดียว เพราะบางตารางสร้างผ่าน Supabase UI มาก่อนไม่รู้แน่ชัดว่ามี
// cascade จริงหรือไม่ — ถ้าตารางไหน cascade อยู่แล้วก็แค่ไม่เจอแถวให้ลบซ้ำ ไม่มีผลเสีย
// (ตั้งใจไม่รวม trial_used_line_ids — ต้องอยู่รอดข้ามการลบร้านเสมอ, ไม่รวม company_admins —
// เป็นคนละระบบ ไม่ผูก shop_id, ไม่รวม anonymous_market_prices — เก็บด้วย shop_hash แบบ
// ทางเดียวเจตนาไม่ให้ผูกกลับ shop_id ได้ ไม่ใช่ "ข้อมูลของร้าน" ในความหมาย PDPA)
const CHILD_TABLES_BY_SHOP_ID = [
  'shop_credits',
  'shop_google_configs',
  'shop_branches',
  'shop_bank_accounts',
  'shop_admins',
  'credit_purchase_history',
  'credit_topup_history',
  'invoice_requests',
  'slip_analytics',
  'sender_profiles',
  'shop_usage_daily',
  'pos_configs',
  'delivery_configs',
  'branch_role_requests',
  'procurement_alerts',
  'pos_open_bills',
  'shop_category_rules',
];

export default async function handler(req, res) {
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });

  const { shopId, lineUserId, confirmShopName } = req.body || {};
  if (!shopId || !lineUserId || !confirmShopName) {
    return res.status(400).json({ error: 'ข้อมูลไม่ครบถ้วน กรุณาลองใหม่อีกครั้ง' });
  }

  const { data: shop, error: fetchErr } = await supabase
    .from('shop_profiles')
    .select('id, shop_name, owner_line_id, trial_started_at, stripe_subscription_id')
    .eq('id', shopId)
    .maybeSingle();

  if (fetchErr) return res.status(500).json({ error: fetchErr.message });
  if (!shop) return res.status(404).json({ error: 'ไม่พบร้านค้านี้' });

  // ต้องเป็นเจ้าของร้านจริงเท่านั้นถึงจะลบได้ (แอดมินของร้านลบร้านที่ตัวเองแค่ดูแลอยู่ไม่ได้)
  if (shop.owner_line_id !== lineUserId) {
    return res.status(403).json({ error: 'คุณไม่ใช่เจ้าของร้านนี้ ไม่สามารถลบได้' });
  }

  // บังคับพิมพ์ชื่อร้านให้ตรงเป๊ะก่อนลบจริง (กันกดพลาด)
  if (confirmShopName.trim() !== (shop.shop_name || '').trim()) {
    return res.status(400).json({ error: 'ชื่อร้านที่พิมพ์ไม่ตรงกับชื่อร้านจริง กรุณาตรวจสอบอีกครั้ง' });
  }

  let stripeCancelWarning = null;

  try {
    // 1. ถ้ามี subscription Stripe ที่ยัง active อยู่ ต้องยกเลิกทันที (ไม่ใช่รอสิ้นรอบบิล)
    //    ก่อนลบร้าน ไม่งั้นลูกค้าจะโดนเก็บเงินต่อไปเรื่อยๆ ทั้งที่ร้าน/dashboard หายไปแล้ว
    if (shop.stripe_subscription_id && stripe) {
      try {
        await stripe.subscriptions.cancel(shop.stripe_subscription_id);
      } catch (stripeErr) {
        console.error('[delete-shop] Stripe cancel failed:', stripeErr.message);
        stripeCancelWarning = `ยกเลิก Stripe subscription ไม่สำเร็จ (${stripeErr.message}) — กรุณาตรวจสอบและยกเลิกด้วยมือใน Stripe Dashboard`;
      }
    }

    // 2. บันทึกว่าไลไอดีนี้เคยใช้สิทธิ์ทดลองฟรีไปแล้ว (ถ้าร้านนี้เคยได้ trial) — ต้องทำ "ก่อน"
    //    ลบร้านเสมอ กันช่องโหว่ลบแล้วสมัครใหม่ขอเครดิตทดลองซ้ำไม่จำกัดรอบ (ตารางนี้แยกจาก
    //    shop_profiles โดยเจตนา อยู่รอดข้ามการลบร้านนี้เสมอ — ดู CLAUDE.md)
    if (shop.trial_started_at) {
      const { error: trialErr } = await supabase
        .from('trial_used_line_ids')
        .upsert({ line_user_id: lineUserId }, { onConflict: 'line_user_id', ignoreDuplicates: true });
      if (trialErr) console.error('[delete-shop] trial_used_line_ids upsert failed:', trialErr.message);
    }

    // 3. ลบข้อมูลลูกในทุกตารางที่ผูก shop_id ก่อนเสมอ (ไม่พึ่ง ON DELETE CASCADE อย่างเดียว)
    for (const table of CHILD_TABLES_BY_SHOP_ID) {
      const { error: cleanupErr } = await supabase.from(table).delete().eq('shop_id', shopId);
      if (cleanupErr) console.error(`[delete-shop] cleanup ${table} failed (may not exist):`, cleanupErr.message);
    }

    // 4. ลบร้านจริง (แถวหลัก)
    const { error: deleteErr } = await supabase.from('shop_profiles').delete().eq('id', shopId);
    if (deleteErr) throw deleteErr;

    return res.status(200).json({ success: true, stripeCancelWarning });
  } catch (err) {
    console.error('[delete-shop] fatal error:', err.message);
    return res.status(500).json({ error: `ลบร้านไม่สำเร็จ: ${err.message}` });
  }
}
