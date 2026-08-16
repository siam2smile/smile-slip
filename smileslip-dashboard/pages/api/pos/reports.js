/**
 * GET /api/pos/reports?shopId&type=sales|inventory|credit|loans|topsellers|pl&dateFrom&dateTo&branch&status
 *
 * type:
 *   sales      → รายการขายแบบ bank-statement พร้อม running balance
 *   inventory  → สินค้าคงเหลือ + มูลค่าสต็อค
 *   credit     → ยอดขายที่ค้างชำระ (payment_method=เชื่อ, status=ค้างชำระ)
 *   loans      → รายการยืมสินค้า
 *   topsellers → สินค้าขายดี (top 20 by qty + revenue)
 *   pl         → กำไรขาดทุนรายหมวดหมู่
 *   cyclical   → สถานะสินค้าหมุนเวียน (ถัง/ขวด/ฯลฯ) — ใครถืออยู่กี่ชิ้น + สรุปสต็อค เต็ม/กับลูกค้า/เปล่ารอรีฟิล
 *   vat        → ภาษีขาย (จากยอดขาย แยกตามสาขา) vs ภาษีซื้อ (จากรับสินค้า+รายจ่าย ยังไม่แยกสาขา) + ยอด VAT สุทธิที่ต้องนำส่ง
 *   expenses   → รายจ่ายที่ไม่เกี่ยวกับสต็อคสินค้า (ค่าเช่า/ค่าน้ำไฟ ฯลฯ) — รายการ + สรุปยอดรวม/VAT
 *   annual_tax → ประมาณการณ์ภาษีเงินได้ปลายปี (Phase 3, &year=YYYY) — นิติบุคคล/บุคคลธรรมดา ตาม
 *                shop_profiles.user_type ดูคำเตือนเรื่องความแม่นยำใน lib/tax-estimate.js
 *   customer_rfm → Customer 360/RFM ของสมาชิกร้าน (pos_contacts เท่านั้น — ไม่ใช่ sender_name
 *                จากสลิป, งานกลยุทธ์ "6P Data Matrix" ข้อ 89) — Enterprise เท่านั้น
 *   price_tier → ช่วงราคาบิลที่ลูกค้าจ่ายบ่อย (terciles ต่ำ/กลาง/สูง แบบ quantile ไม่ hardcode
 *                ช่วงบาท) + สินค้าที่ขายดีคู่กันในบิลเดียวกัน (งานกลยุทธ์ "6P Data Matrix" ข้อ 89
 *                Phase 2/3) — ทุก tier ใช้ได้ ไม่ล็อกพิเศษ
 *
 * Tier E (2026-07-25): รายการที่เป็น transaction log ล้วนๆ (ขาย/ยืม/รับสินค้า/รายจ่าย/ออเดอร์จัดส่ง)
 * อ่านจาก Supabase (pos_sales/pos_loans/pos_receives/pos_expenses/pos_delivery_orders) แทน Sheets แล้ว
 *
 * Phase 2 Tier 142 (write-primary flip, 2026-07-29): แค็ตตาล็อกสินค้า/ผู้ติดต่อ (inventory, ต้นทุน/
 * หมวดหมู่ใน topsellers/pl, รายชื่อสินค้าหมุนเวียน+ผู้ถือใน cyclical) ตัดมาอ่าน Supabase
 * (pos_products/pos_contacts) ด้วยแล้ว — เดิม Tier E จงใจคงอ่าน Sheets ไว้เพราะกลัวแค็ตตาล็อกเก่า
 * (ไม่เคย backfill) หายไปกะทันหัน แต่ตอนนี้ products.js/contacts.js (Tier 138) ตัด Sheets ออกไปแล้ว
 * เช่นกัน ทำให้ Sheets ไม่ใช่ source of truth ของสองตารางนี้อีกต่อไป (ข้อมูลจะค้าง/นิ่งตายตัวถ้ายังอ่านต่อ)
 */
import { createClient } from '@supabase/supabase-js';
import { requirePermission } from '../../../lib/pos-auth';
import { productFromRow, contactFromRow } from '../../../lib/google-pos';
import { getBranchStockMap } from '../../../lib/pos-stock';
import { estimateAnnualTax } from '../../../lib/tax-estimate';
import { hasFeature, upgradeMessage } from '../../../lib/tier-features';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

// ยอด VAT ไม่ใช่รายได้/รายจ่ายของกิจการ (แค่เก็บแทนกรมสรรพากรแล้วส่งต่อ) — รายงาน pl/topsellers
// ต้องคำนวณจากฐานราคาก่อน VAT เสมอสำหรับร้านที่จดทะเบียน VAT ไม่งั้นกำไรที่โชว์จะพองเกินจริง
// (เดิมไม่เคยแยกเลย ใช้ item.price*qty ตรงๆ ซึ่งรวม VAT อยู่แล้วถ้าสินค้าตั้งราคาแบบ "รวม VAT แล้ว")
// ตรรกะเดียวกับ computeVatBreakdown() ใน google-pos.js เป๊ะ แค่ทำต่อรายการเดียวแทนอาเรย์รวม
const VAT_RATE = 0.07;
function lineRevenueBase(price, qty, vatType) {
  const lineTotal = (parseFloat(price) || 0) * (parseFloat(qty) || 0);
  if (vatType === 'รวม VAT แล้ว') return lineTotal / (1 + VAT_RATE);
  return lineTotal; // 'ไม่รวม VAT'/'ไม่มี VAT' — ราคาที่บันทึกไม่มี VAT ปนอยู่แล้ว
}
// lineRevenueBase() อย่างเดียวไม่พอสำหรับรายงานภาษีที่ต้องการยอด VAT จริง — สินค้าประเภท "ไม่รวม
// VAT" (ราคาที่ตั้งไม่มี VAT ปนอยู่ ต้องบวก VAT เพิ่มต่างหากตอนขาย) ให้ฐานรายได้เท่ากับ "ไม่มี VAT"
// (ถูกต้องแล้วสำหรับ revenue) แต่ vat ต้องไม่ใช่ 0 — ตรรกะเดียวกับ computeVatBreakdown() ใน
// lib/google-pos.js เป๊ะ แค่ทำต่อรายการเดียวแทนอาเรย์รวม
function lineVatBreakdown(price, qty, vatType) {
  const lineTotal = (parseFloat(price) || 0) * (parseFloat(qty) || 0);
  if (vatType === 'รวม VAT แล้ว') {
    const base = lineTotal / (1 + VAT_RATE);
    return { base, vat: lineTotal - base };
  }
  if (vatType === 'ไม่รวม VAT') return { base: lineTotal, vat: lineTotal * VAT_RATE };
  return { base: lineTotal, vat: 0 }; // ไม่มี VAT
}
async function getVatRegistered(shopId) {
  const { data } = await supabase.from('pos_configs').select('vat_registered').eq('shop_id', shopId).maybeSingle();
  return !!data?.vat_registered;
}

async function getBranchName(shopId) {
  const { data: sp } = await supabase.from('shop_profiles').select('branch_name').eq('id', shopId).maybeSingle();
  return sp?.branch_name || '';
}

// รองรับทั้ง "D/M/BE, H:MM:SS" (มี comma) และ "D/M/BE H:MM:SS" (คั่นด้วยวรรค ไม่มี comma —
// รูปแบบจริงที่ resolveRecordDateTime().full/toLocaleString('th-TH') ใช้อยู่ทั่วโปรเจกต์) — เดิม
// split(',') อย่างเดียวทำให้ datePart กลายเป็นสตริงทั้งก้อน (รวมเวลา) แล้ว parse เป็น Invalid Date
// เงียบๆ (ตัวกรอง dateFrom/dateTo จึงไม่มีผลอะไรเลยมาตลอด เพราะเทียบกับ Invalid Date เสมอเป็น false)
function parseThaiBEDate(str) {
  if (!str) return null;
  try {
    const datePart = str.split(/[, ]/)[0];
    const [d, m, by] = datePart.trim().split('/').map(Number);
    if (!d || !m || !by) return null;
    const year = by > 2400 ? by - 543 : by;
    return new Date(year, m - 1, d);
  } catch { return null; }
}

function inRange(dateStr, from, to) {
  const d = parseThaiBEDate(dateStr);
  if (!d) return true;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

// pos_loans ไม่มีคอลัมน์ transaction_at แยก (ไม่รองรับ backdate) ใช้ created_at (timestamptz จริง)
// ของ Supabase เองแทน — เทียบแบบ Date ตรงๆ ไม่ผ่าน parseThaiBEDate (ซึ่งพึ่ง string รูปแบบไทยเท่านั้น)
function inRangeISO(isoStr, from, to) {
  if (!isoStr) return true;
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return true;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

// ── Supabase row → object shape เดียวกับ rowToX() เดิมทุกฟิลด์ ให้ logic เดิมด้านล่างไม่ต้องแก้ ──
function saleFromRow(r) {
  return {
    bill_no: r.bill_no || '', created_at: r.transaction_at || '', items: r.items || [],
    subtotal: Number(r.subtotal) || 0, discount: Number(r.discount) || 0, total: Number(r.total) || 0,
    payment_method: r.payment_method || '', cash_received: Number(r.cash_received) || 0,
    change: Number(r.change_amount) || 0, cashier: r.cashier || '', notes: r.notes || '',
    status: r.status || 'ชำระแล้ว', customer_id: r.customer_id || '', customer_name: r.customer_name || '',
    paid_at: r.paid_at || '', branch: r.branch_name || '', vat_subtotal: Number(r.vat_subtotal) || 0,
    vat_amount: Number(r.vat_amount) || 0, shift_no: r.shift_no || '',
  };
}
function orderFromRow(r) {
  return {
    order_no: r.order_no || '', created_at: r.transaction_at || '', customer_id: r.customer_id || '',
    customer_name: r.customer_name || '', items: r.items || [], total: Number(r.total) || 0,
    payment_method: r.payment_method || '', status: r.status || 'รอจัดส่ง',
    credit_settled: !!r.credit_settled,
  };
}

// แปลงออเดอร์จัดส่งที่ "ยืนยันจัดส่งสำเร็จแล้ว" ให้อยู่ในรูปเดียวกับยอดขายหน้าร้าน (pos_sales) — ใช้
// รวมเข้ารายงานยอดขาย/กำไรขาดทุน เพราะเดิม type='sales'/'pl' อ่านแค่ pos_sales อย่างเดียว ทำให้
// ร้านที่ขายผ่านช่องทางจัดส่งเป็นหลัก (ไม่มีขายหน้าร้านเลย) เห็นรายงานว่างเปล่าตลอด ทั้งที่มียอดขาย
// จริงจากออเดอร์จัดส่งอยู่ — ยังไม่นับออเดอร์ที่ "รอจัดส่ง" (ยังไม่เกิดรายได้จริง จนกว่าจะยืนยัน)
// vocabulary ของ status/payment_method map ให้ตรงกับที่ pos_sales ใช้ (ตรงกับ type='credit' ที่ทำ
// การแปลงแบบเดียวกันนี้อยู่แล้วสำหรับรายงานเงินเชื่อ)
function deliveryOrderToSaleShape(o) {
  const payment_method =
    o.payment_method === 'เก็บปลายทาง' ? 'เงินสด' :
    o.payment_method === 'โอนแล้ว' ? 'โอน' :
    o.payment_method === 'ค้างจ่าย' ? 'เชื่อ' :
    (o.payment_method || 'เงินสด');
  const status = payment_method === 'เชื่อ' ? (o.credit_settled ? 'ชำระแล้ว' : 'ค้างชำระ') : 'ชำระแล้ว';
  return {
    bill_no: o.order_no, created_at: o.created_at, items: o.items, total: o.total,
    payment_method, status, customer_id: o.customer_id, customer_name: o.customer_name,
    branch: '', source: 'delivery',
  };
}
function loanFromRow(r) {
  const dt = r.created_at ? new Date(r.created_at) : null;
  return {
    loan_no: r.loan_no || '',
    created_at: dt && !isNaN(dt.getTime()) ? dt.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) : '',
    _createdAtRaw: r.created_at,
    due_date: r.due_date || '', contact_id: r.contact_id || '', contact_name: r.contact_name || '',
    contact_phone: r.contact_phone || '', items: r.items || [], notes: r.notes || '',
    status: r.status || 'ยืมอยู่', returned_at: r.returned_at || '', branch: r.branch_name || '',
  };
}
function expenseFromRow(r) {
  return {
    expense_no: r.expense_no || '', created_at: r.transaction_at || '', label: r.label || '',
    total: Number(r.total) || 0, vat_type: r.vat_type || 'ไม่มี VAT', subtotal: Number(r.subtotal) || 0,
    vat_amount: Number(r.vat_amount) || 0, payment_method: r.payment_method || '',
    photo_url: r.photo_url || '', notes: r.notes || '', recorded_by: r.recorded_by || '',
    branch: r.branch_name || '', shift_no: r.shift_no || '',
  };
}
function receiveFromRow(r) {
  return {
    receive_no: r.receive_no || '', created_at: r.transaction_at || '', supplier: r.supplier || '',
    items: r.items || [], total_cost: Number(r.total_cost) || 0, notes: r.notes || '',
    supplier_id: r.supplier_id || '', subtotal: Number(r.subtotal) || 0,
    vat_total: Number(r.vat_total) || 0, photo_url: r.photo_url || '',
  };
}

async function fetchSales(shopId) {
  const { data, error } = await supabase.from('pos_sales').select('*')
    .eq('shop_id', shopId).is('deleted_at', null).order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(saleFromRow).filter(s => s.bill_no);
}
async function fetchDeliveryOrders(shopId) {
  const { data, error } = await supabase.from('pos_delivery_orders').select('*')
    .eq('shop_id', shopId).is('deleted_at', null).order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(orderFromRow).filter(o => o.order_no);
}
async function fetchLoans(shopId) {
  const { data, error } = await supabase.from('pos_loans').select('*')
    .eq('shop_id', shopId).order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(loanFromRow).filter(l => l.loan_no);
}
async function fetchExpenses(shopId) {
  const { data, error } = await supabase.from('pos_expenses').select('*')
    .eq('shop_id', shopId).is('deleted_at', null).order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(expenseFromRow).filter(e => e.expense_no);
}
// เงินเดือน (Phase 2) — ต้นทุนรวมที่บริษัทจ่ายออกจริงต่อรอบ = gross_pay + sso_employer (ไม่ใช่แค่
// net_pay ที่พนักงานได้รับ) ใช้ paid_at (timestamptz จริง) กรองช่วงวันที่ผ่าน inRangeISO ไม่ใช่ inRange
async function fetchPayrollRuns(shopId) {
  const { data, error } = await supabase.from('pos_payroll_runs').select('*')
    .eq('shop_id', shopId).is('deleted_at', null);
  if (error) throw error;
  return data || [];
}
async function fetchReceives(shopId) {
  const { data, error } = await supabase.from('pos_receives').select('*')
    .eq('shop_id', shopId).order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(receiveFromRow).filter(r => r.receive_no);
}
// เจอบั๊กจริงระหว่างทดสอบ customer_rfm (ข้อ 89): PostgREST คืนสูงสุด 1,000 แถวเสมอถ้าไม่ระบุ
// .range() เอง — ไม่ error ให้เห็นเลย แค่ตัดข้อมูลทิ้งเงียบๆ (บั๊กแบบเดียวกับที่เจอใน
// pages/api/pos/contacts.js มาก่อนแล้วในข้อ 85 แค่คนละไฟล์ — ฟังก์ชันนี้ duplicate กันตาม
// ธรรมเนียมโปรเจกต์ ไม่ได้ share code เลยไม่เคยถูกแก้ไปด้วยตอนนั้น) — D Gas มีผู้ติดต่อจริง
// 2,181 คน (>1,000) ทำให้ fetchContacts() เดิมเห็นแค่ 1,000 คนแรกมาตลอด กระทบทุก report type
// ในไฟล์นี้ที่เรียกฟังก์ชันนี้ (credit/cyclical/customer_rfm) ไม่ใช่แค่ customer_rfm ที่เพิ่งเพิ่ม
async function fetchAllPaginated(table, filterFn) {
  const PAGE = 1000;
  let all = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await filterFn(supabase.from(table).select('*'))
      .order('created_at', { ascending: true }).order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    all = all.concat(data || []);
    if (!data || data.length < PAGE) break;
  }
  return all;
}
async function fetchProducts(shopId) {
  const data = await fetchAllPaginated('pos_products', q => q.eq('shop_id', shopId).is('deleted_at', null));
  return data.map(productFromRow).filter(p => p.sku);
}
async function fetchContacts(shopId) {
  const data = await fetchAllPaginated('pos_contacts', q => q.eq('shop_id', shopId).is('deleted_at', null));
  return data.map(contactFromRow).filter(c => c.contact_id);
}

// คำนวณกำไรขาดทุนของช่วงเวลาที่กำหนด — ใช้ร่วมกันทั้ง type=pl (รายเดือน/ตามช่วงที่เลือก) และ
// type=annual_tax (ทั้งปี, Phase 3) กันตรรกะเพี้ยนกันระหว่าง 2 endpoint — ดูเหตุผลเรื่อง VAT
// exclusion ที่หัวไฟล์คอมเมนต์ของ type=pl เดิม (Phase 1)
async function computePL(shopId, from, to) {
  const [posSales, deliveryOrders, expenses, products, payrollRuns, vatRegistered] = await Promise.all([
    fetchSales(shopId), fetchDeliveryOrders(shopId), fetchExpenses(shopId),
    fetchProducts(shopId), fetchPayrollRuns(shopId), getVatRegistered(shopId),
  ]);
  const deliverySales = deliveryOrders.filter(o => o.status === 'ส่งแล้ว').map(deliveryOrderToSaleShape);
  const allSales = [...posSales, ...deliverySales];

  const filteredExpenses = expenses.filter(e => inRange(e.created_at, from, to));
  const expensesCost = filteredExpenses.reduce((a, e) => a + (vatRegistered ? e.subtotal : e.total), 0);

  // เงินเดือน (Phase 2) — ต้นทุนแรงงานที่แท้จริง ไม่เคยถูกนับรวมใน P&L มาก่อนตั้งแต่สร้างระบบเงินเดือน
  // (payroll-runs.js เขียนเข้า ledger_transactions ตรงๆ ไม่ผ่าน pos_expenses) ทำให้ net_profit เดิม
  // สูงเกินจริงถ้าร้านมีพนักงานประจำ — แก้ตอนนี้พร้อมกับ Phase 3
  const filteredPayroll = payrollRuns.filter(r => inRangeISO(r.paid_at, from, to));
  const payrollCost = filteredPayroll.reduce((a, r) => a + (Number(r.gross_pay) || 0) + (Number(r.sso_employer) || 0), 0);

  const totalExpenses = expensesCost + payrollCost;

  const costMap = {};
  const catMap = {};
  const vatTypeMap = {};
  products.forEach(p => { costMap[p.sku] = p.cost; catMap[p.sku] = p.category || 'ไม่ระบุหมวด'; vatTypeMap[p.sku] = p.vat_type; });

  const sales = allSales
    .filter(s => s.bill_no && s.status !== 'ยกเลิก' && s.status !== 'ค้างชำระ')
    .filter(s => inRange(s.created_at, from, to));

  const byCategory = {};
  for (const sale of sales) {
    for (const item of sale.items || []) {
      const cat = catMap[item.sku] || 'ไม่ระบุหมวด';
      if (!byCategory[cat]) byCategory[cat] = { category: cat, revenue: 0, cost: 0, profit: 0 };
      const itemRevenue = vatRegistered ? lineRevenueBase(item.price, item.qty, vatTypeMap[item.sku]) : item.price * item.qty;
      const itemCost = (costMap[item.sku] || 0) * item.qty;
      byCategory[cat].revenue += itemRevenue;
      byCategory[cat].cost += itemCost;
      byCategory[cat].profit += itemRevenue - itemCost;
    }
  }

  const categories = Object.values(byCategory)
    .map(c => ({ ...c, margin: c.revenue > 0 ? Math.round((c.profit / c.revenue) * 100) : 0 }))
    .sort((a, b) => b.revenue - a.revenue);

  const totalRevenue = categories.reduce((a, c) => a + c.revenue, 0);
  const totalCost    = categories.reduce((a, c) => a + c.cost, 0);
  const totalProfit  = categories.reduce((a, c) => a + c.profit, 0);
  const netProfit = totalProfit - totalExpenses;

  return {
    categories, filteredExpenses, filteredPayroll, expensesCost, payrollCost,
    totalRevenue, totalCost, totalProfit, totalExpenses, netProfit,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { shopId, type = 'sales', dateFrom, dateTo, branch, status } = req.query;
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });

  try {
    const branchName = await getBranchName(shopId);
    const from = dateFrom ? new Date(dateFrom) : null;
    const to   = dateTo   ? new Date(dateTo + 'T23:59:59') : null;

    // เรียกจากหน้าพนักงาน (pos-staff.js/แคชเชียร์ แนบ x-staff-session มาด้วย) — ต้องมีสิทธิ์ที่
    // เกี่ยวข้องถึงจะดูได้ (ตรวจผ่าน session ที่เซ็นชื่อ ไม่ใช่ staffId เปล่าๆ ใน query ที่ปลอมได้
    // แบบเดิม) — เจ้าของร้าน/แอดมิน (pos.js เรียกตรง ไม่มี session) ไม่ถูกกระทบเลย
    if (type === 'sales' || type === 'topsellers' || type === 'price_tier') {
      if (!(await requirePermission(req, res, shopId, 'perm_view_revenue'))) return;
    }
    if (type === 'pl') {
      if (!(await requirePermission(req, res, shopId, 'perm_view_pl'))) return;
    }

    // ── สินค้าคงเหลือ ────────────────────────────────────────────────────────
    if (type === 'inventory') {
      let products = (await fetchProducts(shopId)).filter(p => p.is_active !== false);

      // โอนย้ายสต็อกข้ามสาขา Phase 4 — ถ้าระบุ `branch` (รวมสตริงว่าง = กองกลาง/ไม่ระบุสาขา)
      // แสดงยอดคงเหลือของสาขานั้นเท่านั้น (จาก pos_product_stock) แทนยอดรวมทั้งร้าน — ไม่ระบุ
      // `branch` เลย = พฤติกรรมเดิมทุกประการ (ยอดรวมทั้งร้าน จาก pos_products cache)
      if (branch !== undefined) {
        const branchMap = await getBranchStockMap(shopId, branch);
        products = products.map(p => {
          const b = branchMap.get(p.sku);
          return { ...p, shop_total_stock: p.stock, stock: b ? b.qty : 0, at_customer: b ? b.at_customer : 0, empty_waiting: b ? b.empty_waiting : 0 };
        });
      }

      const totalValue = products.reduce((s, p) => s + p.cost * p.stock, 0);
      const totalRetail = products.reduce((s, p) => s + p.price * p.stock, 0);
      const lowStock = products.filter(p => p.type === 'นับสต็อค' && p.stock <= 5 && p.stock >= 0);

      return res.json({
        type: 'inventory',
        branch: branch !== undefined ? branch : null,
        products: products.sort((a, b) => a.name.localeCompare(b.name, 'th')),
        summary: {
          total_products: products.length,
          total_cost_value: totalValue,
          total_retail_value: totalRetail,
          low_stock_count: lowStock.length,
          out_of_stock: products.filter(p => p.type === 'นับสต็อค' && p.stock <= 0).length,
        },
        low_stock: lowStock,
      });
    }

    // ── ยอดขาย (bank-statement format) ────────────────────────────────────
    if (type === 'sales') {
      const [posSales, deliveryOrders] = await Promise.all([fetchSales(shopId), fetchDeliveryOrders(shopId)]);
      const deliverySales = deliveryOrders.filter(o => o.status === 'ส่งแล้ว').map(deliveryOrderToSaleShape);
      let sales = [...posSales, ...deliverySales];

      if (branch) sales = sales.filter(s => s.branch === branch || (!s.branch && branch === branchName));
      sales = sales.filter(s => inRange(s.created_at, from, to));
      sales.sort((a, b) => (parseThaiBEDate(a.created_at) || 0) - (parseThaiBEDate(b.created_at) || 0));

      // running balance (bank statement style)
      let balance = 0;
      const statement = sales.map(s => {
        const income = ['ชำระแล้ว', 'โอนแล้ว'].includes(s.status) ? s.total : 0;
        balance += income;
        return { ...s, income, balance };
      });

      const totalIncome = sales.filter(s => s.status === 'ชำระแล้ว' || s.status === 'โอนแล้ว').reduce((a, s) => a + s.total, 0);
      return res.json({
        type: 'sales',
        statement,
        summary: {
          count: sales.length,
          total_income: totalIncome,
          cash: sales.filter(s => s.payment_method === 'เงินสด').reduce((a, s) => a + s.total, 0),
          transfer: sales.filter(s => s.payment_method === 'โอน').reduce((a, s) => a + s.total, 0),
          credit: sales.filter(s => s.payment_method === 'เชื่อ').reduce((a, s) => a + s.total, 0),
          pending: sales.filter(s => s.status === 'รอยืนยัน' || s.status === 'ค้างชำระ').reduce((a, s) => a + s.total, 0),
        },
      });
    }

    // ── เงินเชื่อ (Accounts Receivable) ───────────────────────────────────
    // รวม 2 แหล่ง: ขายเชื่อหน้าร้าน (ยอดขาย, payment_method=เชื่อ) + ออเดอร์จัดส่งค้างจ่าย
    // (ออเดอร์จัดส่ง, payment_method=ค้างจ่าย)
    if (type === 'credit') {
      const allSales = await fetchSales(shopId);
      let posCredits = allSales
        .filter(s => s.bill_no && s.payment_method === 'เชื่อ')
        .map(s => ({ ...s, source: 'pos' }));

      const allOrders = await fetchDeliveryOrders(shopId);
      let deliveryCredits = allOrders
        .filter(o => o.order_no && o.payment_method === 'ค้างจ่าย')
        .map(o => ({
          bill_no: o.order_no, created_at: o.created_at, items: o.items, total: o.total,
          payment_method: 'เชื่อ', status: o.credit_settled ? 'ชำระแล้ว' : 'ค้างชำระ',
          customer_id: o.customer_id, customer_name: o.customer_name, branch: '',
          source: 'delivery',
        }));

      if (status === 'ค้างชำระ') { posCredits = posCredits.filter(s => s.status === 'ค้างชำระ'); deliveryCredits = deliveryCredits.filter(s => s.status === 'ค้างชำระ'); }
      if (status === 'ชำระแล้ว') { posCredits = posCredits.filter(s => s.status === 'ชำระแล้ว'); deliveryCredits = deliveryCredits.filter(s => s.status === 'ชำระแล้ว'); }
      if (branch) posCredits = posCredits.filter(s => s.branch === branch);
      posCredits = posCredits.filter(s => inRange(s.created_at, from, to));
      deliveryCredits = deliveryCredits.filter(s => inRange(s.created_at, from, to));

      const credits = [...posCredits, ...deliveryCredits];

      // จัดกลุ่มตามลูกค้า
      const byCustomer = {};
      for (const s of credits) {
        const key = s.customer_name || s.customer_id || 'ไม่ระบุ';
        if (!byCustomer[key]) byCustomer[key] = { customer_name: key, customer_id: s.customer_id, total: 0, paid: 0, outstanding: 0, bills: [] };
        byCustomer[key].total += s.total;
        if (s.status === 'ชำระแล้ว') byCustomer[key].paid += s.total;
        else byCustomer[key].outstanding += s.total;
        byCustomer[key].bills.push(s);
      }

      const customerList = Object.values(byCustomer).sort((a, b) => b.outstanding - a.outstanding);
      return res.json({
        type: 'credit',
        credits: credits.reverse(),
        customers: customerList,
        summary: {
          total_bills: credits.length,
          total_amount: credits.reduce((a, s) => a + s.total, 0),
          outstanding: credits.filter(s => s.status === 'ค้างชำระ').reduce((a, s) => a + s.total, 0),
          paid: credits.filter(s => s.status === 'ชำระแล้ว').reduce((a, s) => a + s.total, 0),
          customer_count: customerList.length,
        },
      });
    }

    // ── ยืมสินค้า ──────────────────────────────────────────────────────────
    if (type === 'loans') {
      let loans = await fetchLoans(shopId);

      if (status && status !== 'ทั้งหมด') loans = loans.filter(l => l.status === status);
      if (branch) loans = loans.filter(l => l.branch === branch);
      loans = loans.filter(l => inRangeISO(l._createdAtRaw, from, to));

      const overdue = loans.filter(l => l.status === 'ยืมอยู่' && l.due_date && new Date(l.due_date) < new Date());
      return res.json({
        type: 'loans',
        loans: loans.reverse().map(({ _createdAtRaw, ...rest }) => rest),
        summary: {
          total: loans.length,
          active: loans.filter(l => l.status === 'ยืมอยู่').length,
          returned: loans.filter(l => l.status === 'คืนแล้ว').length,
          overdue: overdue.length,
        },
        overdue: overdue.map(({ _createdAtRaw, ...rest }) => rest),
      });
    }

    // ── สินค้าขายดี (Top Sellers) ─────────────────────────────────────────
    if (type === 'topsellers') {
      const [posSales, deliveryOrders, products, vatRegistered] = await Promise.all([
        fetchSales(shopId), fetchDeliveryOrders(shopId), fetchProducts(shopId), getVatRegistered(shopId),
      ]);
      const deliverySales = deliveryOrders.filter(o => o.status === 'ส่งแล้ว').map(deliveryOrderToSaleShape);
      const allSales = [...posSales, ...deliverySales];
      const sales = allSales
        .filter(s => s.bill_no && s.status !== 'ยกเลิก')
        .filter(s => inRange(s.created_at, from, to));

      const costMap = {};
      const vatTypeMap = {};
      products.forEach(p => { costMap[p.sku] = p.cost; vatTypeMap[p.sku] = p.vat_type; });

      // ยอดขาย/รายได้รวมคำนวณจากฐานก่อน VAT เสมอถ้าร้านจด VAT (ดูเหตุผลบน lineRevenueBase ด้านบน)
      let totalRevenueExVat = 0;
      const tally = {};
      for (const sale of sales) {
        for (const item of sale.items || []) {
          if (!tally[item.sku]) tally[item.sku] = { sku: item.sku, name: item.name, qty: 0, revenue: 0, bills: 0 };
          const revenue = vatRegistered ? lineRevenueBase(item.price, item.qty, vatTypeMap[item.sku]) : item.price * item.qty;
          tally[item.sku].qty += item.qty;
          tally[item.sku].revenue += revenue;
          tally[item.sku].bills += 1;
          totalRevenueExVat += revenue;
        }
      }

      const topSellers = Object.values(tally)
        .map(t => ({
          ...t,
          cost: costMap[t.sku] || 0,
          profit: t.revenue - (costMap[t.sku] || 0) * t.qty,
          margin: t.revenue > 0 ? Math.round(((t.revenue - (costMap[t.sku] || 0) * t.qty) / t.revenue) * 100) : 0,
        }))
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 30);

      return res.json({
        type: 'topsellers',
        top_sellers: topSellers,
        summary: {
          total_revenue: vatRegistered ? totalRevenueExVat : sales.reduce((a, s) => a + s.total, 0),
          total_bills: sales.length,
          unique_products: Object.keys(tally).length,
        },
      });
    }

    // ── กำไรขาดทุน (P&L) ──────────────────────────────────────────────────
    // กำไรขั้นต้น (gross profit) คำนวณจากยอดขาย - ต้นทุนสินค้าต่อหมวดหมู่ ตามเดิม
    // net_profit หักค่าใช้จ่ายร้าน (จาก pos_expenses) + ต้นทุนเงินเดือน (Phase 2) ออกเพิ่มด้วย
    //
    // VAT ไม่ใช่รายได้/รายจ่ายของกิจการ (แค่เก็บแทนกรมสรรพากรแล้วส่งต่อ ไม่ใช่กำไร/ขาดทุนจริง) —
    // ร้านที่จดทะเบียน VAT ต้องคำนวณรายรับ/ต้นทุน/ค่าใช้จ่ายจากฐานก่อน VAT เสมอ (ดูรายละเอียดใน
    // computePL() ด้านบน — logic ย้ายไปรวมศูนย์ที่นั่นแล้ว ใช้ร่วมกับ type=annual_tax ด้วย)
    if (type === 'pl') {
      const pl = await computePL(shopId, from, to);
      return res.json({
        type: 'pl',
        categories: pl.categories,
        expenses: pl.filteredExpenses,
        summary: {
          total_revenue: pl.totalRevenue,
          total_cost: pl.totalCost,
          gross_profit: pl.totalProfit,
          gross_margin: pl.totalRevenue > 0 ? Math.round((pl.totalProfit / pl.totalRevenue) * 100) : 0,
          total_expenses: pl.totalExpenses,
          total_payroll: pl.payrollCost,
          net_profit: pl.netProfit,
          net_margin: pl.totalRevenue > 0 ? Math.round((pl.netProfit / pl.totalRevenue) * 100) : 0,
        },
      });
    }

    // ── ประมาณการณ์ภาษีเงินได้ปลายปี (Phase 3) ────────────────────────────
    // สรุปกำไรขาดทุนทั้งปี (ใช้ตรรกะเดียวกับ type=pl เป๊ะ ผ่าน computePL()) แล้วคำนวณภาษีตามประเภท
    // นิติบุคคลที่ร้านลงทะเบียนไว้ (shop_profiles.user_type) — ดูคำเตือนเรื่องความแม่นยำใน
    // lib/tax-estimate.js (ตัวประมาณการณ์สำหรับวางแผนเท่านั้น ไม่ใช่เครื่องมือยื่นภาษีที่แม่นยำ 100%)
    if (type === 'annual_tax') {
      if (!(await requirePermission(req, res, shopId, 'perm_view_pl'))) return;
      const year = parseInt(req.query.year, 10) || new Date().getFullYear();
      const yearFrom = new Date(year, 0, 1);
      const yearTo = new Date(year, 11, 31, 23, 59, 59);

      const [pl, { data: shop }] = await Promise.all([
        computePL(shopId, yearFrom, yearTo),
        supabase.from('shop_profiles').select('user_type, shop_name').eq('id', shopId).maybeSingle(),
      ]);
      const userType = shop?.user_type === 'corporate' ? 'corporate' : 'individual';
      const taxEstimate = estimateAnnualTax(userType, pl.netProfit);

      return res.json({
        type: 'annual_tax',
        year,
        userType,
        shopName: shop?.shop_name || '',
        summary: {
          total_revenue: pl.totalRevenue,
          total_cost: pl.totalCost,
          gross_profit: pl.totalProfit,
          total_expenses: pl.expensesCost,
          total_payroll: pl.payrollCost,
          net_profit: pl.netProfit,
        },
        payrollCount: pl.filteredPayroll.length,
        expenseCount: pl.filteredExpenses.length,
        taxEstimate,
      });
    }

    // ── สินค้าหมุนเวียน (ถัง/ขวด/ฯลฯ) ────────────────────────────────────────
    // รวม 3 มุม: (1) ใครถืออยู่กี่ชิ้น — จาก contact.cylinders (2) ภาพรวมสต็อคจริงต่อสินค้า
    // (3) ต้นทุนรีฟิล/ซื้อใหม่ — จาก pos_receives
    if (type === 'cyclical') {
      const [allContacts, allProducts, receives] = await Promise.all([
        fetchContacts(shopId),
        fetchProducts(shopId),
        fetchReceives(shopId),
      ]);

      const customers = allContacts
        .filter(c => (c.cylinders || 0) > 0)
        .map(c => ({ contact_id: c.contact_id, name: c.name, phone: c.phone, cylinders: c.cylinders }))
        .sort((a, b) => b.cylinders - a.cylinders);

      const cyclicalSkus = new Set(allProducts.filter(p => p.type === 'หมุนเวียน').map(p => p.sku));

      const products = allProducts
        .filter(p => p.type === 'หมุนเวียน')
        .map(p => ({
          sku: p.sku, name: p.name, unit: p.unit, stock: p.stock,
          at_customer: p.at_customer, empty_waiting: p.empty_waiting,
          empty_ceiling: p.empty_ceiling,
          over_ceiling: p.empty_ceiling > 0 && p.empty_waiting > p.empty_ceiling,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, 'th'));

      // ต้นทุนรีฟิล (สินค้าหมุนเวียน) vs ต้นทุนซื้อสินค้าใหม่ (ประเภทอื่น) จากใบรับสินค้าในช่วงวันที่เลือก
      const filteredReceives = receives.filter(r => inRange(r.created_at, from, to));

      let refillCost = 0, newPurchaseCost = 0;
      for (const rec of filteredReceives) {
        for (const item of rec.items || []) {
          const lineBase = (parseFloat(item.qty) || 0) * (parseFloat(item.unitCost) || 0);
          // สินค้าหมุนเวียนที่รับเข้าไม่ได้แปลว่าเป็นการรีฟิลเสมอไป (อาจเป็นซื้อของใหม่เพิ่มก็ได้ —
          // ดูตัวเลือก isRefill ตอนรับสินค้า) ใบรับสินค้าเก่าก่อนมีตัวเลือกนี้ไม่มีฟิลด์ isRefill เก็บไว้
          // เลย ถือว่าเป็นรีฟิลตามพฤติกรรมเดิม (fallback true) กันตัวเลขย้อนหลังเปลี่ยนไปจากเดิม
          const countsAsRefill = cyclicalSkus.has(item.sku) && item.isRefill !== false;
          if (countsAsRefill) refillCost += lineBase;
          else newPurchaseCost += lineBase;
        }
      }

      return res.json({
        type: 'cyclical',
        customers,
        products,
        summary: {
          customer_count: customers.length,
          total_with_customers: customers.reduce((s, c) => s + c.cylinders, 0),
          product_types: products.length,
          total_stock: products.reduce((s, p) => s + p.stock, 0),
          total_at_customer: products.reduce((s, p) => s + p.at_customer, 0),
          total_empty_waiting: products.reduce((s, p) => s + p.empty_waiting, 0),
          over_ceiling_count: products.filter(p => p.over_ceiling).length,
          refill_cost: Math.round(refillCost * 100) / 100,
          new_purchase_cost: Math.round(newPurchaseCost * 100) / 100,
        },
      });
    }

    // ── รายงาน VAT (ภาษีขาย/ภาษีซื้อ) ────────────────────────────────────────
    // ภาษีขาย (output VAT) มาจากยอดขาย — แยกตามสาขาได้ (คอลัมน์ "สาขา" ของยอดขาย)
    // ภาษีซื้อ (input VAT) รวม 2 แหล่ง: ใบรับสินค้า (ซื้อเข้าสต็อค) + รายจ่าย (ค่าใช้จ่ายร้านที่มี VAT)
    // ทั้งคู่ยังไม่มีคอลัมน์สาขา (ไม่ได้ผูกกับสาขาที่ขาย) จึงรวมเป็นยอดเดียวของทั้งร้าน ไม่แยกสาขาในเวอร์ชันนี้
    if (type === 'vat') {
      // เดิมอ่านแค่ pos_sales ไม่เคยรวมยอดขายจากออเดอร์จัดส่งเลย (ต่างจาก type=pl/topsellers ที่แก้
      // ไปแล้ว) เพราะ pos_delivery_orders ไม่มีคอลัมน์ vat_subtotal/vat_amount ของตัวเอง — แก้โดย
      // คำนวณ VAT ต่อรายการสดจาก vat_type ของสินค้าแทน (pattern เดียวกับ type=pl/topsellers) แล้ว
      // ผนวกกลับเข้า sale object เป็น vat_subtotal/vat_amount ก่อนเข้า loop เดิมทั้งหมด (ทั้งสอง
      // ฟิลด์นี้ต้องมีค่าเสมอไม่ว่า sale จะมาจาก pos_sales หรือออเดอร์จัดส่ง ไม่งั้น byBranch จะได้
      // NaN จากการบวก undefined)
      const [allSalesRaw, deliveryOrdersForVat, allReceives, allExpenses, productsForVat, vatRegisteredForVat] = await Promise.all([
        fetchSales(shopId), fetchDeliveryOrders(shopId), fetchReceives(shopId), fetchExpenses(shopId),
        fetchProducts(shopId), getVatRegistered(shopId),
      ]);
      const vatTypeMapForVat = {};
      productsForVat.forEach(p => { vatTypeMapForVat[p.sku] = p.vat_type; });
      const deliverySalesForVat = deliveryOrdersForVat.filter(o => o.status === 'ส่งแล้ว').map(deliveryOrderToSaleShape);
      const allSales = [...allSalesRaw, ...deliverySalesForVat].map(s => {
        let subtotal = 0, vat = 0;
        if (vatRegisteredForVat) {
          for (const item of s.items || []) {
            const { base, vat: lineVat } = lineVatBreakdown(item.price, item.qty, vatTypeMapForVat[item.sku]);
            subtotal += base;
            vat += lineVat;
          }
        }
        return { ...s, vat_subtotal: subtotal, vat_amount: vat };
      });

      let sales = allSales
        .filter(s => s.bill_no && s.status !== 'ยกเลิก' && s.status !== 'ค้างชำระ')
        .filter(s => inRange(s.created_at, from, to));

      let receives = allReceives
        .filter(r => r.receive_no)
        .filter(r => inRange(r.created_at, from, to));

      let expenses = allExpenses
        .filter(e => e.expense_no)
        .filter(e => inRange(e.created_at, from, to));

      // ── ภาษีขาย แยกตามสาขา ───────────────────────────────────────────────
      const byBranch = {};
      for (const s of sales) {
        const key = s.branch || branchName || 'ไม่ระบุสาขา';
        if (!byBranch[key]) byBranch[key] = { branch: key, sales_subtotal: 0, sales_vat: 0, sales_count: 0 };
        byBranch[key].sales_subtotal += s.vat_subtotal;
        byBranch[key].sales_vat += s.vat_amount;
        byBranch[key].sales_count += 1;
      }
      const branchBreakdown = Object.values(byBranch).sort((a, b) => b.sales_vat - a.sales_vat);

      const outputVatSubtotal = sales.reduce((a, s) => a + s.vat_subtotal, 0);
      const outputVat = sales.reduce((a, s) => a + s.vat_amount, 0);
      const inputVatSubtotalReceives = receives.reduce((a, r) => a + r.subtotal, 0);
      const inputVatReceives = receives.reduce((a, r) => a + r.vat_total, 0);
      const inputVatSubtotalExpenses = expenses.reduce((a, e) => a + e.subtotal, 0);
      const inputVatExpenses = expenses.reduce((a, e) => a + e.vat_amount, 0);
      const inputVatSubtotal = inputVatSubtotalReceives + inputVatSubtotalExpenses;
      const inputVat = inputVatReceives + inputVatExpenses;

      return res.json({
        type: 'vat',
        branch_breakdown: branchBreakdown,
        sales_with_vat: sales.filter(s => s.vat_amount > 0).reverse(),
        receives_with_vat: receives.filter(r => r.vat_total > 0).reverse(),
        expenses_with_vat: expenses.filter(e => e.vat_amount > 0).reverse(),
        summary: {
          output_vat_subtotal: Math.round(outputVatSubtotal * 100) / 100,
          output_vat: Math.round(outputVat * 100) / 100,
          input_vat_subtotal: Math.round(inputVatSubtotal * 100) / 100,
          input_vat: Math.round(inputVat * 100) / 100,
          input_vat_receives: Math.round(inputVatReceives * 100) / 100,
          input_vat_expenses: Math.round(inputVatExpenses * 100) / 100,
          net_vat_payable: Math.round((outputVat - inputVat) * 100) / 100,
          sales_count: sales.length,
          receives_count: receives.length,
          expenses_count: expenses.length,
        },
      });
    }

    // ── รายจ่าย (ไม่เกี่ยวกับสต็อคสินค้า) ────────────────────────────────────
    if (type === 'expenses') {
      let expenses = await fetchExpenses(shopId);
      expenses = expenses.filter(e => inRange(e.created_at, from, to));

      if (branch) expenses = expenses.filter(e => e.branch === branch);

      // สรุปยอดรวมต่อหมวดหมู่ (label) เรียงมากไปน้อย — ให้เห็นว่ารายจ่ายอะไรเยอะสุด
      const byCategory = {};
      for (const e of expenses) {
        const key = e.label.trim() || 'ไม่ระบุ';
        byCategory[key] = (byCategory[key] || 0) + e.total;
      }
      const categoryBreakdown = Object.entries(byCategory)
        .map(([label, total]) => ({ label, total: Math.round(total * 100) / 100 }))
        .sort((a, b) => b.total - a.total);

      return res.json({
        type: 'expenses',
        expenses: expenses.reverse(),
        category_breakdown: categoryBreakdown,
        summary: {
          count: expenses.length,
          total: expenses.reduce((a, e) => a + e.total, 0),
          subtotal: expenses.reduce((a, e) => a + e.subtotal, 0),
          vat: expenses.reduce((a, e) => a + e.vat_amount, 0),
        },
      });
    }

    // ── Price Tier + สินค้าขายดีคู่กัน — งานกลยุทธ์ "6P Data Matrix" ข้อ 89 Phase 2/3 ──────
    // "ราคายอดโอน" ในเอกสารเสนอ = ยอดรวมต่อบิลที่ลูกค้าจ่ายจริง (gross รวม VAT) ไม่ใช่ราคาต่อ
    // ชิ้นสินค้า/ฐานก่อน VAT แบบ pl/topsellers — เพราะโจทย์คือ "ลูกค้ายอมจ่ายช่วงราคาไหนบ่อยสุด"
    // (พฤติกรรมการจ่ายเงินจริง ไม่ใช่กำไร) จึงใช้ s.total ดิบตรงๆ
    if (type === 'price_tier') {
      const [posSales, deliveryOrders, products] = await Promise.all([
        fetchSales(shopId), fetchDeliveryOrders(shopId), fetchProducts(shopId),
      ]);
      const deliverySales = deliveryOrders.filter(o => o.status === 'ส่งแล้ว').map(deliveryOrderToSaleShape);
      let bills = [...posSales, ...deliverySales]
        .filter(s => s.bill_no && s.status !== 'ยกเลิก' && s.status !== 'ค้างชำระ');
      if (branch) bills = bills.filter(s => s.branch === branch || (!s.branch && branch === branchName));
      bills = bills.filter(s => inRange(s.created_at, from, to));

      // terciles แบบ quantile (แบ่งตามลำดับ ไม่ใช่ช่วงบาทตายตัว) — ร้านแต่ละแบบราคาต่างกันมาก
      // (ร้านแก๊ส ฿30-3000 vs ร้านอื่น) hardcode ช่วงบาทจะใช้ไม่ได้ข้ามประเภทร้าน
      const sorted = [...bills].sort((a, b) => a.total - b.total);
      const n = sorted.length;
      const lowEnd = Math.floor(n / 3);
      const midEnd = Math.floor((2 * n) / 3);
      const tierGroups = { low: sorted.slice(0, lowEnd), mid: sorted.slice(lowEnd, midEnd), high: sorted.slice(midEnd, n) };
      const tierLabel = { low: 'ต่ำ', mid: 'กลาง', high: 'สูง' };
      const tiers = Object.entries(tierGroups).map(([key, group]) => {
        const totalRevenue = group.reduce((a, b) => a + b.total, 0);
        return {
          tier: key, label: tierLabel[key], count: group.length,
          total_revenue: Math.round(totalRevenue * 100) / 100,
          avg_bill: group.length ? Math.round((totalRevenue / group.length) * 100) / 100 : 0,
          min: group.length ? group[0].total : 0, max: group.length ? group[group.length - 1].total : 0,
        };
      });

      // สินค้าขายดีคู่กัน — นับคู่ SKU ที่ปรากฏร่วมกันในบิลเดียวกัน (market-basket แบบง่าย)
      const nameMap = {};
      products.forEach(p => { nameMap[p.sku] = p.name; });
      const pairCounts = {};
      for (const bill of bills) {
        const skus = [...new Set((bill.items || []).map(i => i.sku).filter(Boolean))];
        for (let i = 0; i < skus.length; i++) {
          for (let j = i + 1; j < skus.length; j++) {
            const key = [skus[i], skus[j]].sort().join('|');
            pairCounts[key] = (pairCounts[key] || 0) + 1;
          }
        }
      }
      const pairs = Object.entries(pairCounts)
        .sort((a, b) => b[1] - a[1]).slice(0, 15)
        .map(([key, count]) => {
          const [skuA, skuB] = key.split('|');
          return { skuA, nameA: nameMap[skuA] || skuA, skuB, nameB: nameMap[skuB] || skuB, count };
        });

      return res.json({
        type: 'price_tier', tiers, pairs,
        summary: { total_bills: n, total_revenue: Math.round(sorted.reduce((a, b) => a + b.total, 0) * 100) / 100 },
      });
    }

    // ── Customer 360 / RFM (สมาชิกร้าน) — งานกลยุทธ์ "6P Data Matrix" ข้อ 89 ──────────────
    // ใช้ pos_contacts เท่านั้น (ลูกค้าที่สมัครเป็นสมาชิกร้านโดยตรง ให้เบอร์โทรด้วยความยินยอม
    // เพื่อร้านนำไปทำการตลาดของร้านเอง) — ไม่ใช่ sender_name จากสลิปโอนเงินที่เป็นบุคคลภายนอก
    // ไม่เคยยินยอมอะไรเลย (คนละเรื่องกับ Marketing Intelligence เดิมใน shop/heatmap.js ที่ใช้
    // sender_profiles/hash โดยเจตนา — ไฟล์นี้ไม่แตะ/ไม่ผสมข้อมูลจากตารางนั้นเลย)
    if (type === 'customer_rfm') {
      if (!(await requirePermission(req, res, shopId, 'perm_view_revenue'))) return;

      const { data: shopRow } = await supabase.from('shop_profiles')
        .select('subscription_tier').eq('id', shopId).maybeSingle();
      const tier = (shopRow?.subscription_tier || 'normal').toLowerCase();
      if (!hasFeature(tier, 'customer_360_rfm')) {
        return res.status(403).json({ error: upgradeMessage('customer_360_rfm'), featureLocked: true });
      }

      const [contacts, posSales, deliveryOrders] = await Promise.all([
        fetchContacts(shopId), fetchSales(shopId), fetchDeliveryOrders(shopId),
      ]);
      const deliverySales = deliveryOrders.filter(o => o.status === 'ส่งแล้ว').map(deliveryOrderToSaleShape);
      // นับเฉพาะบิลที่จ่ายจริงแล้ว (ไม่นับที่ยกเลิก/ยังค้างชำระ — สอดคล้องกับที่ type=vat/topsellers ใช้)
      const paidSales = [...posSales, ...deliverySales]
        .filter(s => s.customer_id && s.status !== 'ยกเลิก' && s.status !== 'ค้างชำระ');

      const byCustomer = {};
      for (const s of paidSales) {
        if (!byCustomer[s.customer_id]) byCustomer[s.customer_id] = { total_spent: 0, purchase_count: 0, last_purchase_at: null };
        const bucket = byCustomer[s.customer_id];
        bucket.total_spent += s.total;
        bucket.purchase_count += 1;
        // s.created_at เป็นสตริงวันที่ไทย (D/M/BE H:MM:SS เช่น "8/8/2569 18:13:42") ไม่ใช่ ISO
        // timestamp — เจอบั๊กจริงตอนทดสอบ: new Date(s.created_at) เดิมพัง "543 ปี" แบบเดียวกับที่
        // เจอซ้ำหลายรอบทั่วโปรเจกต์ (JS แปลง "2569" เป็นปี ค.ศ. ตรงๆ ไม่ลบ 543 ก่อน) ต้องใช้
        // parseThaiBEDate() ของไฟล์นี้เอง (ที่ sales/pl/vat ทุก type ใช้อยู่แล้ว) แทนเสมอ
        const parsed = parseThaiBEDate(s.created_at);
        const t = parsed ? parsed.getTime() : NaN;
        if (!isNaN(t) && (!bucket.last_purchase_at || t > bucket.last_purchase_at)) bucket.last_purchase_at = t;
      }

      const now = Date.now();
      const eligibleContacts = contacts.filter(c => c.contact_type === 'ลูกค้า' || c.contact_type === 'ทั้งคู่');
      const scored = eligibleContacts
        .filter(c => byCustomer[c.contact_id]) // เฉพาะที่มีประวัติซื้อจริงอย่างน้อย 1 ครั้ง
        .map(c => {
          const b = byCustomer[c.contact_id];
          const daysSince = Math.floor((now - b.last_purchase_at) / 86400000);
          const tx = b.purchase_count;
          // R/F threshold เดียวกับ shop/heatmap.js's RFM เป๊ะ (ความสอดคล้องของศัพท์ทั้งระบบ) —
          // M เป็นยอดเงินจริง (total_spent) ไม่ bucket เพราะข้อมูลนี้ไม่ได้ anonymized
          const R = daysSince <= 7 ? 5 : daysSince <= 30 ? 4 : daysSince <= 60 ? 3 : daysSince <= 90 ? 2 : 1;
          const F = tx >= 20 ? 5 : tx >= 10 ? 4 : tx >= 5 ? 3 : tx >= 2 ? 2 : 1;
          let segment;
          if (R >= 4 && F >= 4)       segment = 'champions';
          else if (R >= 4 && F >= 2)  segment = 'loyal';
          else if (R >= 4 && F === 1) segment = 'new';
          else if (R >= 3 && F >= 1)  segment = 'regular';
          else if (R <= 2 && F >= 3)  segment = 'at_risk';
          else if (R === 1)           segment = 'lost';
          else                         segment = 'dormant';
          return {
            contact_id: c.contact_id, name: c.name, phone: c.phone,
            total_spent: Math.round(b.total_spent * 100) / 100, purchase_count: tx,
            days_since_purchase: daysSince, segment, R, F,
          };
        })
        .sort((a, b) => b.total_spent - a.total_spent);

      const seg = (name) => scored.filter(s => s.segment === name).length;
      return res.json({
        type: 'customer_rfm',
        customers: scored,
        summary: {
          total_scored: scored.length,
          total_contacts: eligibleContacts.length,
          champions: seg('champions'), loyal: seg('loyal'), new: seg('new'),
          regular: seg('regular'), at_risk: seg('at_risk'), lost: seg('lost'), dormant: seg('dormant'),
        },
      });
    }

    return res.status(400).json({ error: 'Unknown report type' });
  } catch (err) {
    console.error('[pos/reports]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
