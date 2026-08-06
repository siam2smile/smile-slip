import { supabase } from './supabase-pos';

/**
 * โอนย้ายสต็อกข้ามสาขา Phase 0 — จุดเดียว (choke point) สำหรับอ่าน/ปรับสต็อกที่แยกตามสาขา
 * (`pos_product_stock`) แทนที่การเขียน `pos_products.stock/at_customer/empty_waiting` ตรงๆ
 * ที่กระจายอยู่ ~13 จุดทั่วโปรเจกต์เดิม (sales.js, receives.js, products.js, delivery.js,
 * collections.js, loans.js)
 *
 * branch_name = '' (สตริงว่าง) หมายถึง "ยังไม่ระบุสาขา/กองกลาง" — ตรงกับที่ pos.js ส่ง
 * `selectedBranch?.branch_name || ''` มาตลอดอยู่แล้ว ร้านสาขาเดียว (ไม่มีแถวใน shop_branches
 * เลย — ส่วนใหญ่ของระบบ เพราะ tier normal/pro จำกัดแค่ 1 สาขา) จะใช้แถว '' นี้แถวเดียวตลอดไป
 *
 * pos_products.stock/at_customer/empty_waiting ยังคงอยู่เป็น "cache" ผลรวม (SUM) ข้ามทุกสาขา
 * ของ SKU นั้น เพื่อให้จุดที่อ่านอย่างเดียว (reports.js, export.js, customer-orders.js,
 * รายการสินค้าหน้าขาย ฯลฯ) ไม่ต้องแก้อะไรเลย — ยังอ่านตัวเลขรวมถูกต้องเหมือนเดิม
 *
 * ตั้งใจ "ไม่" ใช้ Postgres trigger sync cache อัตโนมัติ — ระหว่างที่ยังแก้ไม่ครบทุกจุดที่เขียน
 * สต็อก (rollout เป็นเฟส) trigger จะ SUM จาก pos_product_stock ที่จุดที่ยังไม่ถูกแก้ไม่รู้จัก
 * แล้วเขียนทับตัวเลขที่จุดนั้นเพิ่งเขียนไปเงียบๆ — sync cache ในฟังก์ชันนี้แทน (app-level,
 * เกิดพร้อมกับการเขียนแถว branch เสมอในคำเรียกเดียวกัน) จุดที่ยังไม่ถูกแก้ให้เรียกฟังก์ชันนี้
 * ก็แค่ยังเขียน pos_products ตรงๆ แบบเดิมทุกประการ ไม่มีอะไรมาเขียนทับระหว่าง rollout
 */

/** อ่านสต็อกของ SKU ที่สาขาหนึ่งๆ — คืน 0 ทั้งหมดถ้ายังไม่เคยมีแถว (ไม่ throw) */
export async function getBranchStock(shopId, sku, branchName) {
  const bn = branchName || '';
  const { data, error } = await supabase.from('pos_product_stock').select('*')
    .eq('shop_id', shopId).eq('sku', sku).eq('branch_name', bn).maybeSingle();
  if (error) throw error;
  return {
    qty: Number(data?.qty) || 0,
    at_customer: Number(data?.at_customer) || 0,
    empty_waiting: Number(data?.empty_waiting) || 0,
  };
}

/** สต็อกของ SKU หนึ่งแยกตามทุกสาขาที่เคยมีการเคลื่อนไหว (ไม่รวมสาขาที่ยังไม่เคยมีแถวเลย = 0 โดยปริยาย) */
export async function getStockBreakdown(shopId, sku) {
  const { data, error } = await supabase.from('pos_product_stock').select('*')
    .eq('shop_id', shopId).eq('sku', sku);
  if (error) throw error;
  return (data || []).map(r => ({
    branch_name: r.branch_name,
    qty: Number(r.qty) || 0,
    at_customer: Number(r.at_customer) || 0,
    empty_waiting: Number(r.empty_waiting) || 0,
  }));
}

/**
 * คำนวณผลรวม (SUM) ของทุกสาขาของ SKU หนึ่ง แล้วเขียนกลับเป็น cache ที่ `pos_products` —
 * เรียกจาก `adjustBranchStock()` เสมอในตัว ปกติไม่ต้องเรียกตรงๆ เอง (มีไว้สำหรับ
 * sync ซ้ำหลัง backfill หรือ debug เท่านั้น)
 */
export async function syncProductCache(shopId, sku) {
  const rows = await getStockBreakdown(shopId, sku);
  const totals = rows.reduce((acc, r) => ({
    stock: acc.stock + r.qty,
    at_customer: acc.at_customer + r.at_customer,
    empty_waiting: acc.empty_waiting + r.empty_waiting,
  }), { stock: 0, at_customer: 0, empty_waiting: 0 });

  const { error } = await supabase.from('pos_products').update({
    stock: totals.stock, at_customer: totals.at_customer, empty_waiting: totals.empty_waiting,
  }).eq('shop_id', shopId).eq('sku', sku);
  if (error) throw error;
  return totals;
}

/**
 * ปรับสต็อกของ SKU ที่สาขาหนึ่งๆ ด้วยผลต่าง (delta, บวกหรือลบก็ได้) — clamp ไม่ให้ติดลบ
 * (`Math.max(0,...)` เหมือนโค้ดเดิมทุกจุดที่เคยเขียน pos_products ตรงๆ) แล้ว sync cache
 * กลับ pos_products ให้เสร็จในคำเรียกเดียวกันเสมอ
 *
 * @param {string} shopId
 * @param {string} sku
 * @param {string} branchName - '' = ยังไม่ระบุสาขา/กองกลาง
 * @param {{qtyDelta?:number, atCustomerDelta?:number, emptyWaitingDelta?:number}} deltas
 * @returns {Promise<{qty:number, at_customer:number, empty_waiting:number}>} ค่าที่สาขานั้นหลังปรับ
 */
export async function adjustBranchStock(shopId, sku, branchName, deltas = {}) {
  const bn = branchName || '';
  const { qtyDelta = 0, atCustomerDelta = 0, emptyWaitingDelta = 0 } = deltas;

  const { data: existing, error: fetchErr } = await supabase.from('pos_product_stock').select('*')
    .eq('shop_id', shopId).eq('sku', sku).eq('branch_name', bn).maybeSingle();
  if (fetchErr) throw fetchErr;

  const newQty = Math.max(0, (Number(existing?.qty) || 0) + qtyDelta);
  const newAtCustomer = Math.max(0, (Number(existing?.at_customer) || 0) + atCustomerDelta);
  const newEmptyWaiting = Math.max(0, (Number(existing?.empty_waiting) || 0) + emptyWaitingDelta);

  const { error: upsertErr } = await supabase.from('pos_product_stock').upsert({
    shop_id: shopId, sku, branch_name: bn,
    qty: newQty, at_customer: newAtCustomer, empty_waiting: newEmptyWaiting,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'shop_id,sku,branch_name' });
  if (upsertErr) throw upsertErr;

  await syncProductCache(shopId, sku);

  return { qty: newQty, at_customer: newAtCustomer, empty_waiting: newEmptyWaiting };
}
