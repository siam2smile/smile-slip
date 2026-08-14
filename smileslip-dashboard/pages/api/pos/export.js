/**
 * GET /api/pos/export?shopId&dateFrom&dateTo&branch&types=sales,inventory,credit,loans,topsellers,pl,expenses,vat
 * → ดาวน์โหลด Excel (.xlsx) หลาย sheet ในไฟล์เดียว
 *
 * Phase 2 Tier 142 (write-primary flip, 2026-07-29): แค็ตตาล็อกสินค้า/ผู้ติดต่อ (inventory,
 * ต้นทุน/หมวดหมู่ใน topsellers/pl, vat30 ผู้จำหน่าย/ผู้ติดต่อ, cyclical_inventory) ตัดมาอ่าน
 * Supabase (pos_products/pos_contacts) แล้ว แทน Sheets — ดูเหตุผลเต็มในหัวไฟล์ reports.js
 */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import { productFromRow, contactFromRow } from '../../../lib/google-pos';
import { hasFeature, upgradeMessage } from '../../../lib/tier-features';
import { sanitizeFilenamePart } from '../../../lib/branding';
import { requirePermission } from '../../../lib/pos-auth';
import { getBranchStockMap } from '../../../lib/pos-stock';

// รายงาน 3 แม่แบบใหม่ (vat30/sales_by_branch/cyclical_inventory) + custom เฉพาะร้าน — Business+ เท่านั้น
// (รายงานเดิม 8 ประเภทด้านบนยังไม่ล็อก tier ตามที่เป็นมาแต่เดิม ไม่ได้แก้ย้อนหลังในรอบนี้)
const GATED_TYPES = new Set(['vat30', 'sales_by_branch', 'cyclical_inventory', 'custom']);

// โหลด "รายงานกำหนดเองเฉพาะร้าน" ถ้ามีไฟล์ lib/custom-templates/{shopId}.js อยู่จริง — ยังไม่มีลูกค้า
// รายใดต้องใช้จริงตอนนี้ (2026-07-21) แค่เตรียมโครงสร้างไว้รอ ไม่มีไฟล์ตัวอย่างจริงเพื่อกัน error
// ถ้ามีคนเผลอ import ทับ — ดูรูปแบบที่ต้อง export ในคอมเมนต์ท้ายไฟล์นี้
function loadCustomTemplate(shopId) {
  try {
    const filePath = path.join(process.cwd(), 'lib', 'custom-templates', `${shopId}.js`);
    if (!fs.existsSync(filePath)) return null;
    delete require.cache[require.resolve(filePath)];
    // eslint-disable-next-line global-require, import/no-dynamic-require
    return require(filePath);
  } catch (err) {
    console.error('[pos/export] loadCustomTemplate error:', err.message);
    return null;
  }
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

async function getConfig(shopId) {
  const { data: sp } = await supabase.from('shop_profiles')
    .select('shop_name, branch_name, subscription_tier').eq('id', shopId).single();
  return {
    shopName: sp?.shop_name || '',
    branchName: sp?.branch_name || '',
    tier: sp?.subscription_tier || 'normal',
  };
}

// รองรับทั้ง "D/M/BE, H:MM:SS" (มี comma) และ "D/M/BE H:MM:SS" (คั่นด้วยวรรค ไม่มี comma — รูปแบบจริง
// ที่ toLocaleString('th-TH')/resolveRecordDateTime().full ใช้อยู่ทั่วโปรเจกต์) — เดิม split(',')
// อย่างเดียวทำให้ parse เพี้ยนเป็น Invalid Date เงียบๆ เมื่อไม่มี comma (ตัวกรอง dateFrom/dateTo
// จึงไม่มีผลอะไรเลยมาตลอด เพราะเทียบกับ Invalid Date เสมอเป็น false)
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

function thb(n) { return parseFloat(n || 0); }
function fmt(n) { return Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

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

// VAT ไม่ใช่รายได้ของกิจการ — คำนวณรายได้จากฐานราคาก่อน VAT เสมอสำหรับร้านที่จดทะเบียน VAT
// (เดิม export.js ไม่เคยแยกเลย ใช้ item.price*qty ตรงๆ ต่างจาก reports.js ที่แก้ไปแล้ว) —
// ตรรกะเดียวกับ lineRevenueBase() ใน reports.js/computeVatBreakdown() ใน google-pos.js เป๊ะ
const VAT_RATE = 0.07;
function lineRevenueBase(price, qty, vatType) {
  const lineTotal = (parseFloat(price) || 0) * (parseFloat(qty) || 0);
  if (vatType === 'รวม VAT แล้ว') return lineTotal / (1 + VAT_RATE);
  return lineTotal;
}
// lineRevenueBase() อย่างเดียวไม่พอสำหรับ sheet ภาษี VAT ที่ต้องการยอด VAT จริง — สินค้าประเภท
// "ไม่รวม VAT" ให้ฐานรายได้เท่ากับ "ไม่มี VAT" (ถูกต้องแล้วสำหรับ revenue) แต่ vat ต้องไม่ใช่ 0 —
// ตรรกะเดียวกับ computeVatBreakdown() ใน lib/google-pos.js เป๊ะ แค่ทำต่อรายการเดียว
function lineVatBreakdown(price, qty, vatType) {
  const lineTotal = (parseFloat(price) || 0) * (parseFloat(qty) || 0);
  if (vatType === 'รวม VAT แล้ว') {
    const base = lineTotal / (1 + VAT_RATE);
    return { base, vat: lineTotal - base };
  }
  if (vatType === 'ไม่รวม VAT') return { base: lineTotal, vat: lineTotal * VAT_RATE };
  return { base: lineTotal, vat: 0 };
}
async function getVatRegistered(shopId) {
  const { data } = await supabase.from('pos_configs').select('vat_registered').eq('shop_id', shopId).maybeSingle();
  return !!data?.vat_registered;
}

// ── Tier E: อ่าน transaction log จาก Supabase แทน Sheets — adapter แปลง row → shape เดียวกับ
// rowToX() เดิมทุกฟิลด์ (ดูเหตุผลเต็มในหัวไฟล์ reports.js ซึ่งใช้ pattern เดียวกันนี้) ──────────
function saleFromRow(r) {
  return {
    bill_no: r.bill_no || '', created_at: r.transaction_at || '', items: r.items || [],
    subtotal: Number(r.subtotal) || 0, discount: Number(r.discount) || 0, total: Number(r.total) || 0,
    payment_method: r.payment_method || '', cashier: r.cashier || '', notes: r.notes || '',
    status: r.status || 'ชำระแล้ว', customer_id: r.customer_id || '', customer_name: r.customer_name || '',
    paid_at: r.paid_at || '', branch: r.branch_name || '', vat_subtotal: Number(r.vat_subtotal) || 0,
    vat_amount: Number(r.vat_amount) || 0,
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
// แปลงออเดอร์จัดส่งที่ "ยืนยันจัดส่งสำเร็จแล้ว" ให้อยู่ในรูปเดียวกับยอดขายหน้าร้าน — export.js เดิม
// ไม่เคยรวมยอดขายจากออเดอร์จัดส่งเข้ารายงานเลย (ช่องว่างเดียวกับที่ reports.js แก้ไปแล้ว ข้อ 72/74
// แต่ยังไม่ได้ไล่แก้ไฟล์นี้จนกระทั่งตอนนี้) — ยังไม่นับออเดอร์ที่ "รอจัดส่ง" (ยังไม่เกิดรายได้จริง)
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
    total: Number(r.total) || 0, subtotal: Number(r.subtotal) || 0, vat_amount: Number(r.vat_amount) || 0,
    payment_method: r.payment_method || '', notes: r.notes || '', branch: r.branch_name || '',
  };
}
function receiveFromRow(r) {
  return {
    receive_no: r.receive_no || '', created_at: r.transaction_at || '', supplier: r.supplier || '',
    items: r.items || [], total_cost: Number(r.total_cost) || 0, supplier_id: r.supplier_id || '',
    subtotal: Number(r.subtotal) || 0, vat_total: Number(r.vat_total) || 0,
  };
}
function taxInvoiceFromRow(r) {
  return {
    invoice_no: r.invoice_no || '', issued_at: r.issued_at || '', ref_bill_no: r.ref_bill_no || '',
    customer_id: r.customer_id || '', buyer_name: r.buyer_name || '', buyer_tax_id: r.buyer_tax_id || '',
    subtotal: Number(r.subtotal) || 0, vat: Number(r.vat) || 0, total: Number(r.total) || 0,
  };
}

async function fetchSales(supabase, shopId) {
  const { data, error } = await supabase.from('pos_sales').select('*')
    .eq('shop_id', shopId).is('deleted_at', null).order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(saleFromRow).filter(s => s.bill_no);
}
async function fetchDeliveryOrders(supabase, shopId) {
  const { data, error } = await supabase.from('pos_delivery_orders').select('*')
    .eq('shop_id', shopId).is('deleted_at', null).order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(orderFromRow).filter(o => o.order_no);
}
async function fetchLoans(supabase, shopId) {
  const { data, error } = await supabase.from('pos_loans').select('*')
    .eq('shop_id', shopId).order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(loanFromRow).filter(l => l.loan_no);
}
async function fetchExpenses(supabase, shopId) {
  const { data, error } = await supabase.from('pos_expenses').select('*')
    .eq('shop_id', shopId).is('deleted_at', null).order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(expenseFromRow).filter(e => e.expense_no);
}
async function fetchReceives(supabase, shopId) {
  const { data, error } = await supabase.from('pos_receives').select('*')
    .eq('shop_id', shopId).order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(receiveFromRow).filter(r => r.receive_no);
}
async function fetchTaxInvoices(supabase, shopId) {
  const { data, error } = await supabase.from('pos_tax_invoices').select('*')
    .eq('shop_id', shopId).order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(taxInvoiceFromRow).filter(v => v.invoice_no);
}
async function fetchProducts(supabase, shopId) {
  const { data, error } = await supabase.from('pos_products').select('*')
    .eq('shop_id', shopId).is('deleted_at', null);
  if (error) throw error;
  return (data || []).map(productFromRow).filter(p => p.sku);
}
async function fetchContacts(supabase, shopId) {
  const { data, error } = await supabase.from('pos_contacts').select('*')
    .eq('shop_id', shopId).is('deleted_at', null);
  if (error) throw error;
  return (data || []).map(contactFromRow).filter(c => c.contact_id);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { shopId, dateFrom, dateTo, branch, types = 'sales,inventory,credit,loans,topsellers,pl,expenses,vat' } = req.query;
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });

  try {
    const { shopName, branchName, tier } = await getConfig(shopId);
    const from = dateFrom ? new Date(dateFrom) : null;
    const to   = dateTo   ? new Date(dateTo + 'T23:59:59') : null;
    const typeList = types.split(',').map(t => t.trim());

    const lockedType = typeList.find(t => GATED_TYPES.has(t) && !hasFeature(tier, 'excel_report_templates'));
    if (lockedType) {
      return res.status(403).json({ error: upgradeMessage('excel_report_templates'), featureLocked: true });
    }

    // เรียกจากหน้าพนักงาน (pos-staff.js/แคชเชียร์ แนบ session ผ่าน query `?session=` เพราะเป็น
    // การดาวน์โหลดไฟล์ผ่าน window.open ตรงๆ แนบ custom header ไม่ได้) — ต้องมีสิทธิ์ "export
    // รายงาน VAT" ถึงจะดึงได้ — เจ้าของร้าน/แอดมิน (pos.js เรียกตรง ไม่มี session) ไม่ถูกกระทบเลย
    if (typeList.includes('vat') || typeList.includes('vat30')) {
      if (!(await requirePermission(req, res, shopId, 'perm_export_vat'))) return;
    }

    const wb = XLSX.utils.book_new();

    const periodLabel = dateFrom && dateTo ? `${dateFrom} ถึง ${dateTo}` : dateFrom ? `ตั้งแต่ ${dateFrom}` : 'ทั้งหมด';
    const branchLabel = branch || branchName || shopName;

    // ── ยอดขาย (bank-statement) ──────────────────────────────────────────
    if (typeList.includes('sales')) {
      const [posSalesForSheet, deliveryOrdersForSheet] = await Promise.all([
        fetchSales(supabase, shopId), fetchDeliveryOrders(supabase, shopId),
      ]);
      const deliverySalesForSheet = deliveryOrdersForSheet.filter(o => o.status === 'ส่งแล้ว').map(deliveryOrderToSaleShape);
      let sales = [...posSalesForSheet, ...deliverySalesForSheet];
      if (branch) sales = sales.filter(s => s.branch === branch || (!s.branch && branch === branchName));
      sales = sales.filter(s => inRange(s.created_at, from, to));

      let balance = 0;
      const headers = ['วันที่', 'เลขบิล', 'รายการสินค้า', 'ลูกค้า', 'รายรับ (฿)', 'วิธีชำระ', 'สถานะ', 'ยอดสะสม (฿)'];
      const data = [
        [shopName, '', '', '', '', '', '', ''],
        [`สาขา: ${branchLabel}`, '', '', '', '', '', '', ''],
        [`ช่วงเวลา: ${periodLabel}`, '', '', '', '', '', '', ''],
        [],
        headers,
      ];
      for (const s of sales) {
        const income = (s.status === 'ชำระแล้ว' || s.status === 'โอนแล้ว') ? s.total : 0;
        balance += income;
        const itemSummary = (s.items || []).map(i => `${i.name}×${i.qty}`).join(', ');
        data.push([s.created_at, s.bill_no, itemSummary, s.customer_name || '', fmt(income), s.payment_method, s.status, fmt(balance)]);
      }
      data.push([]);
      const totalIncome = sales.filter(s => s.status === 'ชำระแล้ว' || s.status === 'โอนแล้ว').reduce((a, s) => a + s.total, 0);
      data.push(['', '', '', 'รวมรายรับ', fmt(totalIncome), '', '', '']);
      data.push(['', '', '', 'บิลทั้งหมด', sales.length + ' บิล', '', '', '']);

      const ws = XLSX.utils.aoa_to_sheet(data);
      ws['!cols'] = [{ wch: 22 }, { wch: 22 }, { wch: 35 }, { wch: 18 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 14 }];
      XLSX.utils.book_append_sheet(wb, ws, 'ยอดขาย');
    }

    // ── สินค้าคงเหลือ ────────────────────────────────────────────────────
    if (typeList.includes('inventory')) {
      let products = await fetchProducts(supabase, shopId);

      // โอนย้ายสต็อกข้ามสาขา Phase 4 — ถ้าระบุ `branch` แสดงยอดคงเหลือของสาขานั้นโดยเฉพาะ
      // (จาก pos_product_stock) แทนยอดรวมทั้งร้าน ให้ตรงกับ "สาขา: {branchLabel}" ที่หัวชีตบอกไว้
      // จริงๆ (เดิม label บอกสาขาแต่ตัวเลขเป็นยอดรวมทั้งร้านเสมอ ไม่ตรงกัน) — ไม่ระบุ branch เลย =
      // พฤติกรรมเดิมทุกประการ (ยอดรวมทั้งร้าน)
      if (branch !== undefined) {
        const branchMap = await getBranchStockMap(shopId, branch);
        products = products.map(p => {
          const b = branchMap.get(p.sku);
          return { ...p, stock: b ? b.qty : 0 };
        });
      }

      const headers = ['รหัสสินค้า', 'ชื่อสินค้า', 'หมวดหมู่', 'สต็อคคงเหลือ', 'หน่วย', 'ราคาทุน (฿)', 'ราคาขาย (฿)', 'มูลค่าสต็อค (฿)', 'สถานะ'];
      const data = [
        [shopName], [`สาขา: ${branchLabel}`], [`ณ วันที่: ${new Date().toLocaleDateString('th-TH')}`], [], headers,
      ];
      let totalValue = 0;
      for (const p of products) {
        const val = p.cost * p.stock;
        totalValue += val;
        const status = p.stock <= 0 ? '⚠️ หมด' : p.stock <= 5 ? '🟡 ใกล้หมด' : '✅ ปกติ';
        data.push([p.sku, p.name, p.category, p.stock, p.unit, fmt(p.cost), fmt(p.price), fmt(val), status]);
      }
      data.push([], ['', '', '', '', '', 'รวมมูลค่าสต็อค', '', fmt(totalValue), '']);

      const ws = XLSX.utils.aoa_to_sheet(data);
      ws['!cols'] = [{ wch: 16 }, { wch: 28 }, { wch: 16 }, { wch: 14 }, { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 12 }];
      XLSX.utils.book_append_sheet(wb, ws, 'สินค้าคงเหลือ');
    }

    // ── เงินเชื่อ ─────────────────────────────────────────────────────────
    if (typeList.includes('credit')) {
      // รวม 2 แหล่ง: ขายเชื่อหน้าร้าน (pos_sales, payment_method=เชื่อ) + ออเดอร์จัดส่งค้างจ่าย
      // (pos_delivery_orders, payment_method=ค้างจ่าย) — เดิมไฟล์นี้อ่านแค่ pos_sales เท่านั้น
      // (ต่างจาก reports.js's type=credit ที่รวมทั้งสองแหล่งมาตั้งแต่ข้อ 22 แล้ว)
      const [allSalesForCredit, allOrdersForCredit] = await Promise.all([
        fetchSales(supabase, shopId), fetchDeliveryOrders(supabase, shopId),
      ]);
      const posCreditsForSheet = allSalesForCredit.filter(s => s.bill_no && s.payment_method === 'เชื่อ');
      const deliveryCreditsForSheet = allOrdersForCredit
        .filter(o => o.order_no && o.payment_method === 'ค้างจ่าย')
        .map(o => ({
          bill_no: o.order_no, created_at: o.created_at, items: o.items, total: o.total,
          status: o.credit_settled ? 'ชำระแล้ว' : 'ค้างชำระ',
          customer_id: o.customer_id, customer_name: o.customer_name, branch: '',
        }));
      let credits = [...posCreditsForSheet, ...deliveryCreditsForSheet];
      if (branch) credits = credits.filter(s => s.branch === branch);
      credits = credits.filter(s => inRange(s.created_at, from, to));

      const headers = ['วันที่', 'เลขบิล', 'ลูกค้า', 'รายการ', 'ยอด (฿)', 'สถานะ', 'วันที่ชำระ', 'สาขา'];
      const data = [
        [shopName], [`สาขา: ${branchLabel}`], [`ช่วงเวลา: ${periodLabel}`], [], headers,
      ];
      for (const s of credits) {
        const itemSummary = (s.items || []).map(i => `${i.name}×${i.qty}`).join(', ');
        data.push([s.created_at, s.bill_no, s.customer_name || '', itemSummary, fmt(s.total), s.status, s.paid_at || '', s.branch || '']);
      }
      const outstanding = credits.filter(s => s.status === 'ค้างชำระ').reduce((a, s) => a + s.total, 0);
      data.push([], ['', '', 'ยอดค้างชำระรวม', '', fmt(outstanding), '', '', '']);

      const ws = XLSX.utils.aoa_to_sheet(data);
      ws['!cols'] = [{ wch: 22 }, { wch: 22 }, { wch: 20 }, { wch: 35 }, { wch: 14 }, { wch: 12 }, { wch: 22 }, { wch: 16 }];
      XLSX.utils.book_append_sheet(wb, ws, 'เงินเชื่อ');
    }

    // ── ยืมสินค้า ─────────────────────────────────────────────────────────
    if (typeList.includes('loans')) {
      let loans = await fetchLoans(supabase, shopId);
      if (branch) loans = loans.filter(l => l.branch === branch);
      loans = loans.filter(l => inRangeISO(l._createdAtRaw, from, to)).map(({ _createdAtRaw, ...rest }) => rest);

      const headers = ['เลขที่ยืม', 'วันที่ยืม', 'กำหนดคืน', 'ชื่อผู้ยืม', 'เบอร์โทร', 'รายการ', 'สถานะ', 'วันที่คืน', 'หมายเหตุ', 'สาขา'];
      const data = [
        [shopName], [`สาขา: ${branchLabel}`], [`ช่วงเวลา: ${periodLabel}`], [], headers,
      ];
      for (const l of loans) {
        const itemSummary = (l.items || []).map(i => `${i.name}×${i.qty}${i.unit || ''}`).join(', ');
        const isOverdue = l.status === 'ยืมอยู่' && l.due_date && new Date(l.due_date) < new Date();
        data.push([l.loan_no, l.created_at, l.due_date, l.contact_name, l.contact_phone, itemSummary, isOverdue ? '⚠️ เกินกำหนด' : l.status, l.returned_at || '', l.notes, l.branch]);
      }
      data.push([], ['ยืมอยู่', loans.filter(l => l.status === 'ยืมอยู่').length + ' รายการ']);

      const ws = XLSX.utils.aoa_to_sheet(data);
      ws['!cols'] = [{ wch: 20 }, { wch: 22 }, { wch: 14 }, { wch: 20 }, { wch: 14 }, { wch: 35 }, { wch: 14 }, { wch: 22 }, { wch: 24 }, { wch: 16 }];
      XLSX.utils.book_append_sheet(wb, ws, 'ยืมสินค้า');
    }

    // ── สินค้าขายดี ──────────────────────────────────────────────────────
    if (typeList.includes('topsellers')) {
      const [posSalesForTop, deliveryOrdersForTop, products, vatRegisteredForTop] = await Promise.all([
        fetchSales(supabase, shopId), fetchDeliveryOrders(supabase, shopId),
        fetchProducts(supabase, shopId), getVatRegistered(shopId),
      ]);
      const deliverySalesForTop = deliveryOrdersForTop.filter(o => o.status === 'ส่งแล้ว').map(deliveryOrderToSaleShape);
      const allSalesForTop = [...posSalesForTop, ...deliverySalesForTop];
      const costMap = {}, vatTypeMapForTop = {};
      products.forEach(p => { costMap[p.sku] = p.cost; vatTypeMapForTop[p.sku] = p.vat_type; });

      let sales = allSalesForTop.filter(s => s.bill_no && s.status !== 'ยกเลิก');
      if (branch) sales = sales.filter(s => s.branch === branch);
      sales = sales.filter(s => inRange(s.created_at, from, to));

      const tally = {};
      for (const s of sales) {
        for (const item of s.items || []) {
          if (!tally[item.sku]) tally[item.sku] = { rank: 0, sku: item.sku, name: item.name, qty: 0, revenue: 0 };
          tally[item.sku].qty += item.qty;
          tally[item.sku].revenue += vatRegisteredForTop ? lineRevenueBase(item.price, item.qty, vatTypeMapForTop[item.sku]) : item.price * item.qty;
        }
      }
      const topSellers = Object.values(tally).sort((a, b) => b.qty - a.qty).slice(0, 30).map((t, i) => ({ ...t, rank: i + 1, profit: t.revenue - (costMap[t.sku] || 0) * t.qty }));

      const headers = ['อันดับ', 'รหัสสินค้า', 'ชื่อสินค้า', 'จำนวนขาย', 'ยอดขาย (฿)', 'กำไร (฿)', 'กำไร %'];
      const data = [
        [shopName], [`ช่วงเวลา: ${periodLabel}`], [], headers,
        ...topSellers.map(t => [t.rank, t.sku, t.name, t.qty, fmt(t.revenue), fmt(t.profit), t.revenue > 0 ? Math.round((t.profit / t.revenue) * 100) + '%' : '0%']),
      ];

      const ws = XLSX.utils.aoa_to_sheet(data);
      ws['!cols'] = [{ wch: 8 }, { wch: 16 }, { wch: 28 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 10 }];
      XLSX.utils.book_append_sheet(wb, ws, 'สินค้าขายดี');
    }

    // ── กำไรขาดทุน ────────────────────────────────────────────────────────
    if (typeList.includes('pl')) {
      const [posSalesForPl, deliveryOrdersForPl, products, vatRegisteredForPl] = await Promise.all([
        fetchSales(supabase, shopId), fetchDeliveryOrders(supabase, shopId),
        fetchProducts(supabase, shopId), getVatRegistered(shopId),
      ]);
      const deliverySalesForPl = deliveryOrdersForPl.filter(o => o.status === 'ส่งแล้ว').map(deliveryOrderToSaleShape);
      const allSalesForPl = [...posSalesForPl, ...deliverySalesForPl];
      const costMap = {}, catMap = {}, vatTypeMapForPl = {};
      products.forEach(p => { costMap[p.sku] = p.cost; catMap[p.sku] = p.category || 'ไม่ระบุ'; vatTypeMapForPl[p.sku] = p.vat_type; });

      let sales = allSalesForPl.filter(s => s.bill_no && s.status !== 'ยกเลิก' && s.status !== 'ค้างชำระ');
      if (branch) sales = sales.filter(s => s.branch === branch);
      sales = sales.filter(s => inRange(s.created_at, from, to));

      const byCategory = {};
      for (const s of sales) {
        for (const item of s.items || []) {
          const cat = catMap[item.sku] || 'ไม่ระบุ';
          if (!byCategory[cat]) byCategory[cat] = { category: cat, revenue: 0, cost: 0, profit: 0 };
          const itemRevenue = vatRegisteredForPl ? lineRevenueBase(item.price, item.qty, vatTypeMapForPl[item.sku]) : item.price * item.qty;
          const itemCost = (costMap[item.sku] || 0) * item.qty;
          byCategory[cat].revenue += itemRevenue;
          byCategory[cat].cost += itemCost;
          byCategory[cat].profit += itemRevenue - itemCost;
        }
      }
      const cats = Object.values(byCategory).sort((a, b) => b.revenue - a.revenue);
      const totalRev = cats.reduce((a, c) => a + c.revenue, 0);
      const totalCost = cats.reduce((a, c) => a + c.cost, 0);
      const totalProfit = cats.reduce((a, c) => a + c.profit, 0);

      const headers = ['หมวดหมู่', 'ยอดขาย (฿)', 'ต้นทุน (฿)', 'กำไรขั้นต้น (฿)', 'อัตรากำไร %'];
      const data = [
        [shopName], [`ช่วงเวลา: ${periodLabel}`], [], headers,
        ...cats.map(c => [c.category, fmt(c.revenue), fmt(c.cost), fmt(c.profit), c.revenue > 0 ? Math.round((c.profit / c.revenue) * 100) + '%' : '0%']),
        [],
        ['รวม', fmt(totalRev), fmt(totalCost), fmt(totalProfit), totalRev > 0 ? Math.round((totalProfit / totalRev) * 100) + '%' : '0%'],
      ];

      const ws = XLSX.utils.aoa_to_sheet(data);
      ws['!cols'] = [{ wch: 20 }, { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 14 }];
      XLSX.utils.book_append_sheet(wb, ws, 'กำไรขาดทุน');
    }

    // ── รายจ่าย (ไม่เกี่ยวกับสต็อคสินค้า) ────────────────────────────────────
    if (typeList.includes('expenses')) {
      let expenses = await fetchExpenses(supabase, shopId);
      if (branch) expenses = expenses.filter(e => e.branch === branch);
      expenses = expenses.filter(e => inRange(e.created_at, from, to));

      const headers = ['วันที่', 'รายการ/หมวดหมู่', 'ยอดรวม (฿)', 'ยอดก่อน VAT (฿)', 'VAT (฿)', 'วิธีชำระ', 'สาขา', 'หมายเหตุ'];
      const data = [
        [shopName], [`สาขา: ${branchLabel}`], [`ช่วงเวลา: ${periodLabel}`], [], headers,
        ...expenses.map(e => [e.created_at, e.label, fmt(e.total), fmt(e.subtotal), fmt(e.vat_amount), e.payment_method, e.branch, e.notes]),
      ];
      const totalExpense = expenses.reduce((a, e) => a + e.total, 0);
      data.push([], ['', 'รวมรายจ่าย', fmt(totalExpense), '', '', '', '', '']);

      const ws = XLSX.utils.aoa_to_sheet(data);
      ws['!cols'] = [{ wch: 22 }, { wch: 28 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 30 }];
      XLSX.utils.book_append_sheet(wb, ws, 'รายจ่าย');
    }

    // ── ภาษี VAT (ภาษีขายแยกสาขา + ภาษีซื้อจากรับสินค้า+รายจ่าย) ────────────────
    // เดิม sheet นี้อ่านแค่ pos_sales (ใช้ vat_subtotal/vat_amount ที่ dual-write ไว้แล้วตอนขาย)
    // ไม่เคยรวมยอดขายจากออเดอร์จัดส่งเลย (ต่างจาก sales/topsellers/pl/sales_by_branch ที่แก้ไปแล้ว
    // ในข้อ 72/74) เพราะ pos_delivery_orders ไม่มีคอลัมน์ vat_subtotal/vat_amount ของตัวเอง — แก้โดย
    // คำนวณ VAT ต่อรายการสดจาก vat_type ของสินค้าแทน (pattern เดียวกับที่ pl/topsellers ใช้อยู่แล้ว
    // ในไฟล์นี้ — ใช้วิธีเดียวกันทั้ง pos_sales และออเดอร์จัดส่ง เพื่อความสม่ำเสมอ ไม่ผสมค่าที่เก็บไว้
    // ล่วงหน้ากับค่าที่คำนวณสด)
    if (typeList.includes('vat')) {
      const [allSalesForVat, deliveryOrdersForVat, allReceivesForVat, allExpensesForVat, productsForVat, vatRegisteredForVat] = await Promise.all([
        fetchSales(supabase, shopId), fetchDeliveryOrders(supabase, shopId),
        fetchReceives(supabase, shopId), fetchExpenses(supabase, shopId),
        fetchProducts(supabase, shopId), getVatRegistered(shopId),
      ]);
      const deliverySalesForVat = deliveryOrdersForVat.filter(o => o.status === 'ส่งแล้ว').map(deliveryOrderToSaleShape);
      const vatTypeMapForVat = {};
      productsForVat.forEach(p => { vatTypeMapForVat[p.sku] = p.vat_type; });

      let sales = [...allSalesForVat, ...deliverySalesForVat].filter(s => s.bill_no && s.status !== 'ยกเลิก' && s.status !== 'ค้างชำระ');
      sales = sales.filter(s => inRange(s.created_at, from, to));
      let receives = allReceivesForVat.filter(r => r.receive_no);
      receives = receives.filter(r => inRange(r.created_at, from, to));
      let expensesForVat = allExpensesForVat.filter(e => e.expense_no);
      expensesForVat = expensesForVat.filter(e => inRange(e.created_at, from, to));

      const byBranch = {};
      for (const s of sales) {
        const key = s.branch || branchName || 'ไม่ระบุสาขา';
        if (!byBranch[key]) byBranch[key] = { branch: key, subtotal: 0, vat: 0, count: 0 };
        let saleSubtotal = 0, saleVat = 0;
        if (vatRegisteredForVat) {
          for (const item of s.items || []) {
            const { base, vat: lineVat } = lineVatBreakdown(item.price, item.qty, vatTypeMapForVat[item.sku]);
            saleSubtotal += base;
            saleVat += lineVat;
          }
        }
        byBranch[key].subtotal += saleSubtotal;
        byBranch[key].vat += saleVat;
        byBranch[key].count += 1;
      }
      const branchRows = Object.values(byBranch).sort((a, b) => b.vat - a.vat);

      const outputVat = branchRows.reduce((a, b) => a + b.vat, 0);
      const outputVatSubtotal = branchRows.reduce((a, b) => a + b.subtotal, 0);
      const inputVatReceives = receives.reduce((a, r) => a + r.vat_total, 0);
      const inputVatExpenses = expensesForVat.reduce((a, e) => a + e.vat_amount, 0);
      const inputVat = inputVatReceives + inputVatExpenses;

      const headers = ['สาขา', 'จำนวนบิล', 'ยอดก่อน VAT (฿)', 'ภาษีขาย (฿)'];
      const data = [
        [shopName], [`ช่วงเวลา: ${periodLabel}`], [],
        ['สรุปภาษี VAT'], [],
        ['ภาษีขายรวม (฿)', fmt(outputVat)],
        ['ภาษีซื้อรวม (฿)', fmt(inputVat)],
        ['  - จากใบรับสินค้า (฿)', fmt(inputVatReceives)],
        ['  - จากรายจ่าย (฿)', fmt(inputVatExpenses)],
        ['VAT สุทธิที่ต้องนำส่ง/ขอคืนได้ (฿)', fmt(outputVat - inputVat)],
        [],
        ['ภาษีขายแยกตามสาขา'], [],
        headers,
        ...branchRows.map(b => [b.branch, b.count, fmt(b.subtotal), fmt(b.vat)]),
      ];

      const ws = XLSX.utils.aoa_to_sheet(data);
      ws['!cols'] = [{ wch: 30 }, { wch: 14 }, { wch: 18 }, { wch: 16 }];
      XLSX.utils.book_append_sheet(wb, ws, 'ภาษี VAT');
    }

    // ── แม่แบบ 1: รายงานภาษีซื้อ-ขาย ระดับรายการ (ภ.พ.30) — Business+ ──────────
    // ภาษีขาย: จากใบกำกับภาษีที่ออกจริงเท่านั้น (มีเลขภาษีผู้ซื้อครบ ต่างจาก type=vat ที่รวมทุกบิลขาย)
    // ภาษีซื้อ: จากรับสินค้า (มีรหัสผู้จำหน่าย → คืนเลขภาษีจากผู้ติดต่อได้) + รายจ่าย (ไม่มีเลขภาษีคู่ค้าเก็บไว้
    // ในระบบตอนนี้ — โชว์ "-" แทนตามจริง ไม่ใช่บั๊ก เป็น known gap ที่ EXPENSE_HEADERS ไม่มีช่องนี้)
    if (typeList.includes('vat30')) {
      const [contacts, allInvoices, allReceivesForVat30, allExpensesForVat30] = await Promise.all([
        fetchContacts(supabase, shopId),
        fetchTaxInvoices(supabase, shopId),
        fetchReceives(supabase, shopId),
        fetchExpenses(supabase, shopId),
      ]);
      const contactTaxId = {};
      contacts.forEach(c => { contactTaxId[c.contact_id] = c.tax_id || ''; });

      let invoices = allInvoices.filter(v => inRange(v.issued_at, from, to));
      let receives = allReceivesForVat30.filter(r => r.receive_no);
      receives = receives.filter(r => inRange(r.created_at, from, to));
      let expensesForVat30 = allExpensesForVat30.filter(e => e.expense_no && e.vat_amount > 0);
      expensesForVat30 = expensesForVat30.filter(e => inRange(e.created_at, from, to));

      const outputRows = invoices.map(v => [v.issued_at, v.invoice_no, v.buyer_name, v.buyer_tax_id || '-', fmt(v.subtotal), fmt(v.vat), fmt(v.total)]);
      const inputRows = [
        ...receives.filter(r => r.vat_total > 0).map(r => [r.created_at, r.receive_no, r.supplier, contactTaxId[r.supplier_id] || '-', fmt(r.subtotal), fmt(r.vat_total), fmt(r.subtotal + r.vat_total), 'ใบรับสินค้า']),
        ...expensesForVat30.map(e => [e.created_at, e.expense_no, e.label, '-', fmt(e.subtotal), fmt(e.vat_amount), fmt(e.total), 'รายจ่าย']),
      ];
      const totalOutputVat = invoices.reduce((a, v) => a + v.vat, 0);
      const totalInputVatReal = receives.filter(r => r.vat_total > 0).reduce((a, r) => a + r.vat_total, 0) + expensesForVat30.reduce((a, e) => a + e.vat_amount, 0);

      const summaryWs = XLSX.utils.aoa_to_sheet([
        [shopName], [`ช่วงเวลา: ${periodLabel}`], [], ['สรุปรายงานภาษีมูลค่าเพิ่ม (ภ.พ.30)'], [],
        ['ภาษีขายรวม (฿)', fmt(totalOutputVat)],
        ['ภาษีซื้อรวม (฿)', fmt(totalInputVatReal)],
        ['ภาษีสุทธิที่ต้องนำส่ง/ขอคืนได้ (฿)', fmt(totalOutputVat - totalInputVatReal)],
        [], ['หมายเหตุ: ภาษีขายนับเฉพาะบิลที่ออกใบกำกับภาษีจริงแล้วเท่านั้น (ไม่รวมยอดขายทั่วไปที่ไม่ได้ออกใบกำกับภาษี)'],
      ]);
      summaryWs['!cols'] = [{ wch: 40 }, { wch: 16 }];
      XLSX.utils.book_append_sheet(wb, summaryWs, 'สรุปภาษี');

      const outHeaders = ['วันที่ออก', 'เลขที่ใบกำกับภาษี', 'ชื่อผู้ซื้อ', 'เลขภาษีผู้ซื้อ', 'ยอดก่อน VAT (฿)', 'VAT (฿)', 'ยอดรวม (฿)'];
      const outWs = XLSX.utils.aoa_to_sheet([[shopName], [`ช่วงเวลา: ${periodLabel}`], [], outHeaders, ...outputRows]);
      outWs['!cols'] = [{ wch: 14 }, { wch: 18 }, { wch: 24 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 16 }];
      XLSX.utils.book_append_sheet(wb, outWs, 'ภาษีขาย');

      const inHeaders = ['วันที่', 'เลขที่เอกสาร', 'ผู้จำหน่าย/ผู้รับเงิน', 'เลขภาษีคู่ค้า', 'ยอดก่อน VAT (฿)', 'VAT (฿)', 'ยอดรวม (฿)', 'ประเภทเอกสาร'];
      const inWs = XLSX.utils.aoa_to_sheet([[shopName], [`ช่วงเวลา: ${periodLabel}`], [], inHeaders, ...inputRows]);
      inWs['!cols'] = [{ wch: 14 }, { wch: 18 }, { wch: 24 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 16 }, { wch: 14 }];
      XLSX.utils.book_append_sheet(wb, inWs, 'ภาษีซื้อ');
    }

    // ── แม่แบบ 2: สรุปยอดขายแยกสาขา + วิธีชำระเงิน — Business+ ────────────────
    if (typeList.includes('sales_by_branch')) {
      const [posSalesForBranch, deliveryOrdersForBranch] = await Promise.all([
        fetchSales(supabase, shopId), fetchDeliveryOrders(supabase, shopId),
      ]);
      const deliverySalesForBranch = deliveryOrdersForBranch.filter(o => o.status === 'ส่งแล้ว').map(deliveryOrderToSaleShape);
      const allSalesForBranch = [...posSalesForBranch, ...deliverySalesForBranch];
      let sales = allSalesForBranch.filter(s => s.bill_no && s.status !== 'ยกเลิก' && s.status !== 'ค้างชำระ');
      sales = sales.filter(s => inRange(s.created_at, from, to));

      const methods = ['เงินสด', 'โอน', 'เชื่อ'];
      const byBranch2 = {};
      for (const s of sales) {
        const key = s.branch || branchName || 'ไม่ระบุสาขา';
        if (!byBranch2[key]) byBranch2[key] = { branch: key, 'เงินสด': 0, 'โอน': 0, 'เชื่อ': 0, total: 0, count: 0 };
        const m = methods.includes(s.payment_method) ? s.payment_method : 'โอน';
        byBranch2[key][m] += s.total;
        byBranch2[key].total += s.total;
        byBranch2[key].count += 1;
      }
      const branch2Rows = Object.values(byBranch2).sort((a, b) => b.total - a.total);
      const grand = { 'เงินสด': 0, 'โอน': 0, 'เชื่อ': 0, total: 0, count: 0 };
      branch2Rows.forEach(b => { grand['เงินสด'] += b['เงินสด']; grand['โอน'] += b['โอน']; grand['เชื่อ'] += b['เชื่อ']; grand.total += b.total; grand.count += b.count; });

      const headers2 = ['สาขา', 'จำนวนบิล', 'เงินสด (฿)', 'โอน (฿)', 'เชื่อ (฿)', 'รวม (฿)'];
      const data2 = [
        [shopName], [`ช่วงเวลา: ${periodLabel}`], [], headers2,
        ...branch2Rows.map(b => [b.branch, b.count, fmt(b['เงินสด']), fmt(b['โอน']), fmt(b['เชื่อ']), fmt(b.total)]),
        [],
        ['รวมทุกสาขา', grand.count, fmt(grand['เงินสด']), fmt(grand['โอน']), fmt(grand['เชื่อ']), fmt(grand.total)],
      ];
      const ws2 = XLSX.utils.aoa_to_sheet(data2);
      ws2['!cols'] = [{ wch: 22 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 16 }];
      XLSX.utils.book_append_sheet(wb, ws2, 'สรุปยอดขายแยกสาขา');
    }

    // ── แม่แบบ 3: คลังสินค้าหมุนเวียนคงเหลือ + มูลค่าสินทรัพย์ — Business+ ───────
    if (typeList.includes('cyclical_inventory')) {
      const [allProducts3, contacts3All] = await Promise.all([
        fetchProducts(supabase, shopId),
        fetchContacts(supabase, shopId),
      ]);
      const cyclicalProducts = allProducts3.filter(p => p.type === 'หมุนเวียน');
      const contacts3 = contacts3All.filter(c => c.cylinders > 0);

      const prodHeaders = ['รหัสสินค้า', 'ชื่อสินค้า', 'หน่วย', 'เต็มพร้อมขาย', 'อยู่กับลูกค้า', 'เปล่ารอรีฟิล', 'รวมจำนวน', 'ราคาทุน/หน่วย (฿)', 'มูลค่าสินทรัพย์รวม (฿)'];
      let totalAssetValue = 0;
      const prodDataRows = cyclicalProducts.map(p => {
        const totalQty = p.stock + p.at_customer + p.empty_waiting;
        const assetValue = totalQty * p.cost;
        totalAssetValue += assetValue;
        return [p.sku, p.name, p.unit, p.stock, p.at_customer, p.empty_waiting, totalQty, fmt(p.cost), fmt(assetValue)];
      });

      const custHeaders = ['ชื่อลูกค้า', 'เบอร์โทร', 'จำนวนที่ถืออยู่'];
      const custDataRows = contacts3.sort((a, b) => b.cylinders - a.cylinders).map(c => [c.name, c.phone, c.cylinders]);

      const data3 = [
        [shopName], [`ณ วันที่: ${new Date().toLocaleDateString('th-TH')}`], [],
        ['สต็อคสินค้าหมุนเวียนต่อชนิด'], [], prodHeaders,
        ...prodDataRows,
        [], ['มูลค่าสินทรัพย์หมุนเวียนรวมทั้งหมด (฿)', '', '', '', '', '', '', '', fmt(totalAssetValue)],
        [], [], ['ลูกค้าที่ถือสินค้าหมุนเวียนอยู่'], [], custHeaders,
        ...custDataRows,
      ];
      const ws3 = XLSX.utils.aoa_to_sheet(data3);
      ws3['!cols'] = [{ wch: 16 }, { wch: 26 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 16 }, { wch: 18 }];
      XLSX.utils.book_append_sheet(wb, ws3, 'คลังสินค้าหมุนเวียน');
    }

    // ── รายงานกำหนดเองเฉพาะร้าน (Business+) ────────────────────────────────
    // ยังไม่มีร้านไหนใช้จริง (2026-07-21) — เตรียมโครงสร้างไว้รอ ดูรูปแบบไฟล์ที่ต้องสร้างใน
    // lib/custom-templates/README.md
    if (typeList.includes('custom')) {
      const customModule = loadCustomTemplate(shopId);
      if (customModule?.buildCustomReport) {
        try {
          const sheets = await customModule.buildCustomReport({ shopId, shopName, branchName, from, to, XLSX });
          for (const { name, data } of (sheets || [])) {
            const wsC = XLSX.utils.aoa_to_sheet(data);
            XLSX.utils.book_append_sheet(wb, wsC, name.slice(0, 31));
          }
        } catch (err) {
          console.error('[pos/export] custom template error:', err.message);
          XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['เกิดข้อผิดพลาดในรายงานกำหนดเอง: ' + err.message]]), 'รายงานกำหนดเอง');
        }
      } else {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['ร้านนี้ยังไม่มีรายงานกำหนดเองที่ตั้งค่าไว้ — ติดต่อทีมงานเพื่อขอตั้งค่า']]), 'รายงานกำหนดเอง');
      }
    }

    if (wb.SheetNames.length === 0) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['ไม่มีข้อมูล']]), 'รายงาน');
    }

    // White-Label (Enterprise): ตัดคำนำหน้า "SmileSlip_" ออก ใช้ชื่อสาขา (หรือชื่อร้านหลักถ้าไม่ได้กรองสาขา) แทน
    const fileName = hasFeature(tier, 'white_label')
      ? `${sanitizeFilenamePart(branchLabel)}_${dateFrom || 'all'}.xlsx`
      : `SmileSlip_POS_${sanitizeFilenamePart(shopName)}_${dateFrom || 'all'}.xlsx`;
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    return res.send(buf);
  } catch (err) {
    console.error('[pos/export]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
