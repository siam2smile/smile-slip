import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

/**
 * ตารางทั้งหมดที่รู้จักว่าผูกกับ shop_id — ลบเองตรงๆ ก่อนลบ shop_profiles เสมอ ไม่พึ่ง
 * ON DELETE CASCADE อย่างเดียว เพราะบางตารางสร้างผ่าน Supabase UI มาก่อนไม่รู้แน่ชัดว่ามี
 * cascade จริงหรือไม่ — ถ้าตารางไหน cascade อยู่แล้วก็แค่ไม่เจอแถวให้ลบซ้ำ ไม่มีผลเสีย
 *
 * รวมตารางของโมดูล POS ที่ถูกย้ายจาก Google Sheets มา Supabase (Phase 0-2, ดู CLAUDE.md)
 * และ ledger_transactions ของบอท (Phase 3) เข้ามาด้วยแล้ว — ตารางเหล่านี้ไม่เคยอยู่ในลิสต์เดิม
 * ของ /api/shop/delete-shop.js เพราะถูกสร้างขึ้นทีหลัง (migration เสร็จ 2026-08-02 ส่วนไฟล์นี้
 * เขียนตั้งแต่ 2026-07-23) และ /api/admin/update-shop.js ก็ไม่เคยอัปเดตตามเลยตั้งแต่แรก —
 * รวมเป็นค่าคงที่จุดเดียวใช้ร่วมกันทั้ง 2 endpoint กันไม่ให้ 2 ชุด logic ไหลออกจากกันอีกในอนาคต
 *
 * (ตั้งใจไม่รวม: trial_used_line_ids — ต้องอยู่รอดข้ามการลบร้านเสมอ, company_admins — เป็น
 * คนละระบบ ไม่ผูก shop_id, anonymous_market_prices — เก็บด้วย shop_hash แบบทางเดียวเจตนา
 * ไม่ให้ผูกกลับ shop_id ได้, canonical_name_cache/admin_settings/stripe_processed_events —
 * เป็นข้อมูลระดับบริษัท/ระบบกลาง ไม่ใช่ข้อมูลของร้านใดร้านหนึ่ง)
 */
export const CHILD_TABLES_BY_SHOP_ID = [
  'shop_credits',
  'shop_google_configs',
  'shop_branches',
  'shop_bank_accounts',
  'shop_admins',
  'shop_testimonials',
  'credit_purchase_history',
  'credit_topup_history',
  'invoice_requests',
  'slip_analytics',
  'sender_profiles',
  'shop_usage_daily',
  'shop_category_rules',
  'branch_role_requests',
  'procurement_alerts',
  'delivery_configs',
  // ── โมดูล POS (Sheets→Supabase migration) ──
  'pos_configs',
  'pos_open_bills',
  'pos_products',
  'pos_contacts',
  'pos_sales',
  'pos_staff',
  'pos_delivery_orders',
  'pos_collections',
  'pos_loans',
  'pos_expenses',
  'pos_receives',
  'pos_tax_invoices',
  'pos_customer_orders',
  'pos_pending_receives',
  'pos_pending_expenses',
  'pos_cash_shifts',
  'pos_cyclical_log',
  // ── บัญชีหลักของบอท (Phase 3) ──
  'ledger_transactions',
];

/**
 * ลบร้านแบบถาวร (hard delete) พร้อมล้างข้อมูลลูกทุกตารางที่ผูก shop_id + ยกเลิก Stripe
 * subscription ที่ยัง active อยู่ก่อนเสมอ (กันลูกค้าโดนเก็บเงินต่อทั้งที่ร้านหายไปแล้ว) +
 * บันทึกไว้ก่อนลบว่าไลไอดีนี้เคยใช้สิทธิ์ทดลองฟรีไปแล้ว (กันสมัครใหม่ขอ trial ซ้ำ)
 *
 * ใช้ร่วมกันทั้งฝั่งลูกค้า (self-service ใน register.js ผ่าน /api/shop/delete-shop — auth
 * ด้วย owner-session + ต้องพิมพ์ชื่อร้านยืนยัน) และฝั่งแอดมินบริษัท (ปุ่ม "ลบร้านนี้" ใน /admin
 * ผ่าน /api/admin/update-shop — auth ด้วย ADMIN_PASSWORD/company_admins) — auth ของแต่ละทาง
 * ยังคงแยกกันตามเดิม เช็คก่อนเรียกฟังก์ชันนี้เสมอ ฟังก์ชันนี้รับผิดชอบแค่ "ลบข้อมูลให้ครบ" อย่างเดียว
 *
 * @returns {{notFound:true}|{success:true, shopName:string, ownerLineId:string, stripeCancelWarning:string|null}}
 */
export async function deleteShopCompletely(shopId) {
  const { data: shop, error: fetchErr } = await supabase
    .from('shop_profiles')
    .select('id, shop_name, owner_line_id, trial_started_at, stripe_subscription_id')
    .eq('id', shopId)
    .maybeSingle();

  if (fetchErr) throw fetchErr;
  if (!shop) return { notFound: true };

  let stripeCancelWarning = null;

  // 1. ยกเลิก Stripe subscription ทันที (ไม่ใช่รอสิ้นรอบบิล) ถ้ายัง active อยู่
  if (shop.stripe_subscription_id && stripe) {
    try {
      await stripe.subscriptions.cancel(shop.stripe_subscription_id);
    } catch (stripeErr) {
      console.error('[deleteShopCompletely] Stripe cancel failed:', stripeErr.message);
      stripeCancelWarning = `ยกเลิก Stripe subscription ไม่สำเร็จ (${stripeErr.message}) — กรุณาตรวจสอบและยกเลิกด้วยมือใน Stripe Dashboard`;
    }
  }

  // 2. บันทึกว่าไลไอดีนี้เคยใช้สิทธิ์ทดลองฟรีไปแล้ว (ถ้าร้านนี้เคยได้ trial) — ต้องทำ "ก่อน" ลบร้านเสมอ
  if (shop.trial_started_at && shop.owner_line_id) {
    const { error: trialErr } = await supabase
      .from('trial_used_line_ids')
      .upsert({ line_user_id: shop.owner_line_id }, { onConflict: 'line_user_id', ignoreDuplicates: true });
    if (trialErr) console.error('[deleteShopCompletely] trial_used_line_ids upsert failed:', trialErr.message);
  }

  // 3. ลบข้อมูลลูกในทุกตารางที่ผูก shop_id ก่อนเสมอ
  for (const table of CHILD_TABLES_BY_SHOP_ID) {
    const { error: cleanupErr } = await supabase.from(table).delete().eq('shop_id', shopId);
    if (cleanupErr) console.error(`[deleteShopCompletely] cleanup ${table} failed (may not exist):`, cleanupErr.message);
  }

  // 4. ลบร้านจริง (แถวหลัก)
  const { error: deleteErr } = await supabase.from('shop_profiles').delete().eq('id', shopId);
  if (deleteErr) throw deleteErr;

  return { success: true, shopName: shop.shop_name, ownerLineId: shop.owner_line_id, stripeCancelWarning };
}
