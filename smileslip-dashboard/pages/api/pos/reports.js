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
 */
import { createClient } from '@supabase/supabase-js';
import {
  getAccessToken, readSheet, ensureTabExists,
  rowToSale, rowToProduct, rowToLoan, rowToOrder,
  SALE_HEADERS, LOAN_HEADERS, ORDER_HEADERS,
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

function parseThaiBEDate(str) {
  if (!str) return null;
  try {
    const [datePart] = str.split(',');
    const [d, m, by] = datePart.trim().split('/').map(Number);
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

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { shopId, type = 'sales', dateFrom, dateTo, branch, status } = req.query;
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });

  try {
    const { sheetId, token, shopName, branchName } = await getConfig(shopId);
    const from = dateFrom ? new Date(dateFrom) : null;
    const to   = dateTo   ? new Date(dateTo + 'T23:59:59') : null;

    // ── สินค้าคงเหลือ ──────────────────────────────────────────────────────
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
      await ensureTabExists(token, sheetId, 'ยอดขาย', SALE_HEADERS);
      const saleRows = await readSheet(token, sheetId, 'ยอดขาย!A:P');
      let sales = saleRows.slice(1).map(r => rowToSale(r)).filter(s => s.bill_no);

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
    // (ออเดอร์จัดส่ง, payment_method=ค้างจ่าย) — เดิมรายงานนี้อ่านแค่ขายหน้าร้านอย่างเดียว
    // ทำให้ยอดค้างจากฝั่งจัดส่งไม่โผล่ในรายงานนี้เลย (พึ่งพา contact.debt แยกไปคนละทาง)
    if (type === 'credit') {
      await ensureTabExists(token, sheetId, 'ยอดขาย', SALE_HEADERS);
      const saleRows = await readSheet(token, sheetId, 'ยอดขาย!A:P');
      let posCredits = saleRows.slice(1)
        .map(r => rowToSale(r))
        .filter(s => s.bill_no && s.payment_method === 'เชื่อ')
        .map(s => ({ ...s, source: 'pos' }));

      await ensureTabExists(token, sheetId, 'ออเดอร์จัดส่ง', ORDER_HEADERS);
      const orderRows = await readSheet(token, sheetId, 'ออเดอร์จัดส่ง!A:U');
      let deliveryCredits = orderRows.slice(1)
        .map(r => rowToOrder(r))
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
      await ensureTabExists(token, sheetId, 'ยืมสินค้า', LOAN_HEADERS);
      const loanRows = await readSheet(token, sheetId, 'ยืมสินค้า!A:K');
      let loans = loanRows.slice(1).map(r => rowToLoan(r)).filter(l => l.loan_no);

      if (status && status !== 'ทั้งหมด') loans = loans.filter(l => l.status === status);
      if (branch) loans = loans.filter(l => l.branch === branch);
      loans = loans.filter(l => inRange(l.created_at, from, to));

      const overdue = loans.filter(l => l.status === 'ยืมอยู่' && l.due_date && new Date(l.due_date) < new Date());
      return res.json({
        type: 'loans',
        loans: loans.reverse(),
        summary: {
          total: loans.length,
          active: loans.filter(l => l.status === 'ยืมอยู่').length,
          returned: loans.filter(l => l.status === 'คืนแล้ว').length,
          overdue: overdue.length,
        },
        overdue,
      });
    }

    // ── สินค้าขายดี (Top Sellers) ─────────────────────────────────────────
    if (type === 'topsellers') {
      await ensureTabExists(token, sheetId, 'ยอดขาย', SALE_HEADERS);
      const saleRows = await readSheet(token, sheetId, 'ยอดขาย!A:P');
      const sales = saleRows.slice(1)
        .map(r => rowToSale(r))
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
    if (type === 'pl') {
      await ensureTabExists(token, sheetId, 'ยอดขาย', SALE_HEADERS);
      const [saleRows, prodRows] = await Promise.all([
        readSheet(token, sheetId, 'ยอดขาย!A:P'),
        readSheet(token, sheetId, 'สินค้า!A:R'),
      ]);

      const costMap = {};
      const catMap = {};
      prodRows.slice(1).forEach(r => {
        if (r[0]) { costMap[r[0]] = parseFloat(r[4]) || 0; catMap[r[0]] = r[2] || 'ไม่ระบุหมวด'; }
      });

      const sales = saleRows.slice(1)
        .map(r => rowToSale(r))
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

      return res.json({
        type: 'pl',
        categories,
        summary: {
          total_revenue: totalRevenue,
          total_cost: totalCost,
          gross_profit: totalProfit,
          gross_margin: totalRevenue > 0 ? Math.round((totalProfit / totalRevenue) * 100) : 0,
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
