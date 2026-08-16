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

// เดือนที่เก็บข้อมูลไว้หลังกด "ลบร้าน" ก่อนจะถูกล้างถาวรจริงโดย cron (ผู้ใช้ยืนยัน 2026-08-16)
export const RETENTION_MONTHS = 6;

/**
 * "ลบร้าน" ที่ผู้ใช้เห็น (ปุ่มในหน้าเว็บ) — ตั้งแต่ 2026-08-16 เป็น soft-delete เสมอ ไม่ใช่ลบถาวร
 * ทันทีอีกต่อไป — ยกเลิก Stripe subscription ทันที + บันทึก trial_used_line_ids เหมือนเดิม แต่
 * "ไม่แตะข้อมูลลูกเลยสักตาราง" แค่ตั้ง deleted_at บน shop_profiles เอง (เหตุผล: ยกเลิก subscription
 * รายเดือนมีปุ่มแยกอยู่แล้ว — "ลบร้าน" ควรมีไว้สำหรับกรณีอยากเลิกใช้จริงๆ ซึ่งควรมีช่วงกันพลาด)
 * ร้านจะ "หายไป" ทันทีจากมุมมองผู้ใช้ (login/POS/บอทหยุดรู้จักร้านนี้ — ดู getRolesForLineId()/
 * findShopBySource() ที่กรอง deleted_at ออก) แต่ข้อมูลจริงยังอยู่ครบจนกว่า cron
 * (api/cron/purge-deleted-shops.js) จะไล่ล้างถาวรหลังผ่านไป RETENTION_MONTHS เดือน
 *
 * @returns {{notFound:true}|{alreadyDeleted:true}|{success:true, shopName:string, ownerLineId:string, stripeCancelWarning:string|null}}
 */
export async function softDeleteShop(shopId) {
  const { data: shop, error: fetchErr } = await supabase
    .from('shop_profiles')
    .select('id, shop_name, owner_line_id, trial_started_at, stripe_subscription_id, deleted_at')
    .eq('id', shopId)
    .maybeSingle();

  if (fetchErr) throw fetchErr;
  if (!shop) return { notFound: true };
  if (shop.deleted_at) return { alreadyDeleted: true };

  let stripeCancelWarning = null;
  if (shop.stripe_subscription_id && stripe) {
    try {
      await stripe.subscriptions.cancel(shop.stripe_subscription_id);
    } catch (stripeErr) {
      console.error('[softDeleteShop] Stripe cancel failed:', stripeErr.message);
      stripeCancelWarning = `ยกเลิก Stripe subscription ไม่สำเร็จ (${stripeErr.message}) — กรุณาตรวจสอบและยกเลิกด้วยมือใน Stripe Dashboard`;
    }
  }

  if (shop.trial_started_at && shop.owner_line_id) {
    const { error: trialErr } = await supabase
      .from('trial_used_line_ids')
      .upsert({ line_user_id: shop.owner_line_id }, { onConflict: 'line_user_id', ignoreDuplicates: true });
    if (trialErr) console.error('[softDeleteShop] trial_used_line_ids upsert failed:', trialErr.message);
  }

  const { error: updateErr } = await supabase.from('shop_profiles')
    .update({ deleted_at: new Date().toISOString() }).eq('id', shopId);
  if (updateErr) throw updateErr;

  return { success: true, shopName: shop.shop_name, ownerLineId: shop.owner_line_id, stripeCancelWarning };
}

/**
 * กู้คืนร้านที่ถูก soft-delete กลับมาใช้งานได้ทันที (เจ้าของ LINE ID เดิมสมัครใหม่ภายใน
 * RETENTION_MONTHS แล้วเลือก "ใช้ข้อมูลเดิม") — ไม่มีอะไรต้องกู้คืนนอกจาก deleted_at เพราะ
 * ข้อมูลลูกไม่เคยถูกแตะเลยตั้งแต่ softDeleteShop() — ไม่คืน Stripe subscription ให้อัตโนมัติ
 * (ต้องสมัครแพ็กเกจใหม่เองถ้าต้องการ, tier จะกลับเป็น normal/trial-expired ตามที่ค้างไว้ตอนลบ)
 */
export async function restoreShopFromRetention(shopId) {
  const { data: shop, error: fetchErr } = await supabase
    .from('shop_profiles').select('id, deleted_at').eq('id', shopId).maybeSingle();
  if (fetchErr) throw fetchErr;
  if (!shop || !shop.deleted_at) return { notFound: true };
  const { error } = await supabase.from('shop_profiles').update({ deleted_at: null }).eq('id', shopId);
  if (error) throw error;
  return { success: true };
}

/**
 * ลบร้านแบบถาวร (hard delete) พร้อมล้างข้อมูลลูกทุกตารางที่ผูก shop_id — ใช้ 2 ที่เท่านั้น: (1)
 * cron รายวัน (api/cron/purge-deleted-shops.js) ไล่ล้างร้านที่ soft-delete ไว้เกิน RETENTION_MONTHS
 * เดือนแล้ว (2) หน้า register.js's "เริ่มระบบใหม่หมด" — เจ้าของร้านเดิมเลือกทิ้งข้อมูลเก่าที่ soft-delete
 * ไว้ทันทีโดยไม่ต้องรอครบ 6 เดือน — ไม่ใช้กับปุ่ม "ลบร้าน" ที่ผู้ใช้กดเองอีกต่อไป (เปลี่ยนเป็น
 * softDeleteShop() ด้านบนแล้ว ดูเหตุผลที่นั่น) ทั้งสองจุดเรียกฟังก์ชันนี้ "หลัง" ยกเลิก Stripe/บันทึก
 * trial_used_line_ids ไปแล้วครั้งเดียวตอน soft-delete ก่อนหน้านี้ (ไม่ต้องทำซ้ำ เพราะ shop.stripe_subscription_id
 * ถูกยกเลิกไปแล้วตั้งแต่ตอนนั้น และ trial_used_line_ids upsert แบบ ignoreDuplicates ก็ปลอดภัยถ้าเรียกซ้ำ)
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
