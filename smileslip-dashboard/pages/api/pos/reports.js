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
 *
 * Tier E (2026-07-25): รายการที่เป็น transaction log ล้วนๆ (ขาย/ยืม/รับสินค้า/รายจ่าย/ออเดอร์จัดส่ง)
 * อ่านจาก Supabase (pos_sales/pos_loans/pos_receives/pos_expenses/pos_delivery_orders) แทน Sheets แล้ว
 * — **ยกเว้น** แค็ตตาล็อกสินค้าเต็มรูปแบบ (inventory, ต้นทุน/หมวดหมู่ใน topsellers/pl, รายชื่อสินค้า
 * หมุนเวียนใน cyclical) และรายชื่อผู้ติดต่อเต็มรูปแบบ (cyclical.customers) **ยังคงอ่านจาก Sheets ต่อไป
 * โดยเจตนา** เพราะ `pos_products`/`pos_contacts` เป็นตาราง "current state" ที่ไม่เคย backfill ข้อมูลเก่า
 * เลย (ตามธรรมเนียม migration นี้) ร้านจริงที่มีสินค้า/ผู้ติดต่อสะสมมานาน (เช่น D Gas 40 สินค้า/2,000+
 * ผู้ติดต่อ) จะเห็นแค็ตตาล็อกที่หายไปเกือบหมดทันทีถ้าตัดมาอ่าน Supabase ตอนนี้ — ต่างจากรายงาน log
 * (ยอดขาย/รายจ่าย ฯลฯ) ที่แค่เห็นประวัติสั้นลงเป็นที่ยอมรับได้ (ผู้ใช้อนุมัติแล้วสำหรับ Tier D/E)
 */
import { createClient } from '@supabase/supabase-js';
import { requirePermission } from '../../../lib/pos-auth';
import {
  getAccessToken, readSheet, ensureTabExists,
  rowToProduct, rowToContact, CONTACT_HEADERS,
} from '../../../lib/google-pos';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

async function getConfig(shopId) {
  const [{ data: pc }, { data: gc }, { data: sp }] = await Promise.all([
    supabase.from('pos_configs').select('pos_sheet_id').eq('shop_id', shopId).single(),
    supabase.from('shop_google_configs').select('google_refresh_token').eq('shop_id', shopId).single(),
    supabase.from('shop_profiles').select('shop_name, branch_name').eq('id', shopId).single(),
  ]);
  if (!pc?.pos_sheet_id) throw Object.assign(new Error('ยังไม่ได้ตั้งค่า POS'), { notSetup: true });
  if (!gc?.google_refresh_token) throw Object.assign(new Error('ยังไม่ได้เชื่อมต่อ Google'), { notConnected: true });
  return {
    sheetId: pc.pos_sheet_id,
    shopName: sp?.shop_name || '',
    branchName: sp?.branch_name || '',
    token: await getAccessToken(gc.google_refresh_token),
  };
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
async function fetchReceives(shopId) {
  const { data, error } = await supabase.from('pos_receives').select('*')
    .eq('shop_id', shopId).order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(receiveFromRow).filter(r => r.receive_no);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { shopId, type = 'sales', dateFrom, dateTo, branch, status } = req.query;
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });

  try {
    const { sheetId, token, branchName } = await getConfig(shopId);
    const from = dateFrom ? new Date(dateFrom) : null;
    const to   = dateTo   ? new Date(dateTo + 'T23:59:59') : null;

    // เรียกจากหน้าพนักงาน (pos-staff.js/แคชเชียร์ แนบ x-staff-session มาด้วย) — ต้องมีสิทธิ์ที่
    // เกี่ยวข้องถึงจะดูได้ (ตรวจผ่าน session ที่เซ็นชื่อ ไม่ใช่ staffId เปล่าๆ ใน query ที่ปลอมได้
    // แบบเดิม) — เจ้าของร้าน/แอดมิน (pos.js เรียกตรง ไม่มี session) ไม่ถูกกระทบเลย
    if (type === 'sales' || type === 'topsellers') {
      if (!(await requirePermission(req, res, shopId, 'perm_view_revenue'))) return;
    }
    if (type === 'pl') {
      if (!(await requirePermission(req, res, shopId, 'perm_view_pl'))) return;
    }

    // ── สินค้าคงเหลือ (ยังอ่านจาก Sheets — ดูเหตุผลที่หัวไฟล์) ────────────────
    if (type === 'inventory') {
      const prodRows = await readSheet(token, sheetId, 'สินค้า!A:R');
      const products = prodRows.slice(1)
        .map(r => rowToProduct(r))
        .filter(p => p.sku && p.is_active !== false);

      const totalValue = products.reduce((s, p) => s + p.cost * p.stock, 0);
      const totalRetail = products.reduce((s, p) => s + p.price * p.stock, 0);
      const lowStock = products.filter(p => p.type === 'นับสต็อค' && p.stock <= 5 && p.stock >= 0);

      return res.json({
        type: 'inventory',
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
      let sales = await fetchSales(shopId);

      if (branch) sales = sales.filter(s => s.branch === branch || (!s.branch && branch === branchName));
      sales = sales.filter(s => inRange(s.created_at, from, to));

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
    // ต้นทุนต่อ SKU ยังต้องอ่านจากแค็ตตาล็อกสินค้าเต็มรูปแบบใน Sheets (ดูเหตุผลที่หัวไฟล์)
    if (type === 'topsellers') {
      const allSales = await fetchSales(shopId);
      const sales = allSales
        .filter(s => s.bill_no && s.status !== 'ยกเลิก')
        .filter(s => inRange(s.created_at, from, to));

      const tally = {};
      for (const sale of sales) {
        for (const item of sale.items || []) {
          if (!tally[item.sku]) tally[item.sku] = { sku: item.sku, name: item.name, qty: 0, revenue: 0, bills: 0 };
          tally[item.sku].qty += item.qty;
          tally[item.sku].revenue += item.price * item.qty;
          tally[item.sku].bills += 1;
        }
      }

      // ดึงราคาทุนจาก products sheet
      const prodRows = await readSheet(token, sheetId, 'สินค้า!A:R');
      const costMap = {};
      prodRows.slice(1).forEach(r => { if (r[0]) costMap[r[0]] = parseFloat(r[4]) || 0; });

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
          total_revenue: sales.reduce((a, s) => a + s.total, 0),
          total_bills: sales.length,
          unique_products: Object.keys(tally).length,
        },
      });
    }

    // ── กำไรขาดทุน (P&L) ──────────────────────────────────────────────────
    // กำไรขั้นต้น (gross profit) คำนวณจากยอดขาย - ต้นทุนสินค้าต่อหมวดหมู่ ตามเดิม
    // net_profit หักค่าใช้จ่ายร้าน (จาก pos_expenses) ออกเพิ่มด้วย — ต้นทุน/หมวดหมู่สินค้ายังอ่านจาก
    // แค็ตตาล็อกเต็มรูปแบบใน Sheets (ดูเหตุผลที่หัวไฟล์)
    if (type === 'pl') {
      const [allSales, expenses, prodRows] = await Promise.all([
        fetchSales(shopId),
        fetchExpenses(shopId),
        readSheet(token, sheetId, 'สินค้า!A:R'),
      ]);

      const filteredExpenses = expenses.filter(e => inRange(e.created_at, from, to));
      const totalExpenses = filteredExpenses.reduce((a, e) => a + e.total, 0);

      const costMap = {};
      const catMap = {};
      prodRows.slice(1).forEach(r => {
        if (r[0]) { costMap[r[0]] = parseFloat(r[4]) || 0; catMap[r[0]] = r[2] || 'ไม่ระบุหมวด'; }
      });

      const sales = allSales
        .filter(s => s.bill_no && s.status !== 'ยกเลิก' && s.status !== 'ค้างชำระ')
        .filter(s => inRange(s.created_at, from, to));

      const byCategory = {};
      for (const sale of sales) {
        for (const item of sale.items || []) {
          const cat = catMap[item.sku] || 'ไม่ระบุหมวด';
          if (!byCategory[cat]) byCategory[cat] = { category: cat, revenue: 0, cost: 0, profit: 0 };
          const itemRevenue = item.price * item.qty;
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
      return res.json({
        type: 'pl',
        categories,
        expenses: filteredExpenses,
        summary: {
          total_revenue: totalRevenue,
          total_cost: totalCost,
          gross_profit: totalProfit,
          gross_margin: totalRevenue > 0 ? Math.round((totalProfit / totalRevenue) * 100) : 0,
          total_expenses: totalExpenses,
          net_profit: netProfit,
          net_margin: totalRevenue > 0 ? Math.round((netProfit / totalRevenue) * 100) : 0,
        },
      });
    }

    // ── สินค้าหมุนเวียน (ถัง/ขวด/ฯลฯ) ────────────────────────────────────────
    // รวม 3 มุม: (1) ใครถืออยู่กี่ชิ้น — จาก contact.cylinders (ยังอ่าน Sheets, ดูเหตุผลที่หัวไฟล์)
    // (2) ภาพรวมสต็อคจริงต่อสินค้า (ยังอ่าน Sheets เช่นกัน) (3) ต้นทุนรีฟิล/ซื้อใหม่ — จาก pos_receives แล้ว
    if (type === 'cyclical') {
      await ensureTabExists(token, sheetId, 'ผู้ติดต่อ', CONTACT_HEADERS);
      const [custRows, prodRows, receives] = await Promise.all([
        readSheet(token, sheetId, 'ผู้ติดต่อ!A:W'),
        readSheet(token, sheetId, 'สินค้า!A:S'),
        fetchReceives(shopId),
      ]);

      const customers = custRows.slice(1)
        .map(r => rowToContact(r))
        .filter(c => c.contact_id && (c.cylinders || 0) > 0)
        .map(c => ({ contact_id: c.contact_id, name: c.name, phone: c.phone, cylinders: c.cylinders }))
        .sort((a, b) => b.cylinders - a.cylinders);

      const allProducts = prodRows.slice(1).map(r => rowToProduct(r)).filter(p => p.sku);
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
          if (cyclicalSkus.has(item.sku)) refillCost += lineBase;
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
      const [allSales, allReceives, allExpenses] = await Promise.all([
        fetchSales(shopId), fetchReceives(shopId), fetchExpenses(shopId),
      ]);

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

    return res.status(400).json({ error: 'Unknown report type' });
  } catch (err) {
    console.error('[pos/reports]', err.message);
    if (err.notSetup)     return res.status(400).json({ error: err.message, notSetup: true });
    if (err.notConnected) return res.status(400).json({ error: err.message, notConnected: true });
    return res.status(500).json({ error: err.message });
  }
}
