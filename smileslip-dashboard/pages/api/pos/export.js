/**
 * GET /api/pos/export?shopId&dateFrom&dateTo&branch&types=sales,inventory,credit,loans,topsellers,pl,expenses,vat
 * → ดาวน์โหลด Excel (.xlsx) หลาย sheet ในไฟล์เดียว
 */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import {
  getAccessToken, readSheet, ensureTabExists,
  rowToSale, rowToProduct, rowToLoan, rowToExpense, rowToReceive, rowToContact, rowToTaxInvoice,
  SALE_HEADERS, LOAN_HEADERS, EXPENSE_HEADERS, RECEIVE_HEADERS, CONTACT_HEADERS, TAX_INVOICE_HEADERS,
  getStaffPermissions,
} from '../../../lib/google-pos';
import { hasFeature, upgradeMessage } from '../../../lib/tier-features';

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
  const [{ data: pc }, { data: gc }, { data: sp }] = await Promise.all([
    supabase.from('pos_configs').select('pos_sheet_id').eq('shop_id', shopId).single(),
    supabase.from('shop_google_configs').select('google_refresh_token').eq('shop_id', shopId).single(),
    supabase.from('shop_profiles').select('shop_name, branch_name, subscription_tier').eq('id', shopId).single(),
  ]);
  if (!pc?.pos_sheet_id) throw new Error('ยังไม่ได้ตั้งค่า POS');
  if (!gc?.google_refresh_token) throw new Error('ยังไม่ได้เชื่อมต่อ Google');
  return {
    sheetId: pc.pos_sheet_id,
    shopName: sp?.shop_name || '',
    branchName: sp?.branch_name || '',
    tier: sp?.subscription_tier || 'normal',
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

function thb(n) { return parseFloat(n || 0); }
function fmt(n) { return Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { shopId, dateFrom, dateTo, branch, staffId, types = 'sales,inventory,credit,loans,topsellers,pl,expenses,vat' } = req.query;
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });

  try {
    const { sheetId, token, shopName, branchName, tier } = await getConfig(shopId);
    const from = dateFrom ? new Date(dateFrom) : null;
    const to   = dateTo   ? new Date(dateTo + 'T23:59:59') : null;
    const typeList = types.split(',').map(t => t.trim());

    const lockedType = typeList.find(t => GATED_TYPES.has(t) && !hasFeature(tier, 'excel_report_templates'));
    if (lockedType) {
      return res.status(403).json({ error: upgradeMessage('excel_report_templates'), featureLocked: true });
    }

    // เรียกจากหน้าพนักงาน (pos-staff.js ส่ง staffId มาด้วย) — ต้องมีสิทธิ์ "export รายงาน VAT" ถึงจะดึงได้
    // เจ้าของร้าน/แอดมิน (pos.js เรียกตรง ไม่ส่ง staffId) ไม่ถูกกระทบเลย
    if (staffId && (typeList.includes('vat') || typeList.includes('vat30'))) {
      const perms = await getStaffPermissions(token, sheetId, staffId);
      if (!perms.perm_export_vat) return res.status(403).json({ error: 'ไม่มีสิทธิ์ export รายงาน VAT' });
    }

    const wb = XLSX.utils.book_new();

    const periodLabel = dateFrom && dateTo ? `${dateFrom} ถึง ${dateTo}` : dateFrom ? `ตั้งแต่ ${dateFrom}` : 'ทั้งหมด';
    const branchLabel = branch || branchName || shopName;

    // ── ยอดขาย (bank-statement) ──────────────────────────────────────────
    if (typeList.includes('sales')) {
      await ensureTabExists(token, sheetId, 'ยอดขาย', SALE_HEADERS);
      const rows = await readSheet(token, sheetId, 'ยอดขาย!A:R');
      let sales = rows.slice(1).map(r => rowToSale(r)).filter(s => s.bill_no);
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
      const prodRows = await readSheet(token, sheetId, 'สินค้า!A:R');
      const products = prodRows.slice(1).map(r => rowToProduct(r)).filter(p => p.sku);

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
      await ensureTabExists(token, sheetId, 'ยอดขาย', SALE_HEADERS);
      const rows = await readSheet(token, sheetId, 'ยอดขาย!A:R');
      let credits = rows.slice(1).map(r => rowToSale(r)).filter(s => s.bill_no && s.payment_method === 'เชื่อ');
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
      await ensureTabExists(token, sheetId, 'ยืมสินค้า', LOAN_HEADERS);
      const rows = await readSheet(token, sheetId, 'ยืมสินค้า!A:K');
      let loans = rows.slice(1).map(r => rowToLoan(r)).filter(l => l.loan_no);
      if (branch) loans = loans.filter(l => l.branch === branch);
      loans = loans.filter(l => inRange(l.created_at, from, to));

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

    // ── สินค้าขายดี ───────────────────────────────────────────────────────
    if (typeList.includes('topsellers')) {
      await ensureTabExists(token, sheetId, 'ยอดขาย', SALE_HEADERS);
      const [saleRows, prodRows] = await Promise.all([
        readSheet(token, sheetId, 'ยอดขาย!A:R'),
        readSheet(token, sheetId, 'สินค้า!A:R'),
      ]);
      const costMap = {};
      prodRows.slice(1).forEach(r => { if (r[0]) costMap[r[0]] = parseFloat(r[4]) || 0; });

      let sales = saleRows.slice(1).map(r => rowToSale(r)).filter(s => s.bill_no && s.status !== 'ยกเลิก');
      if (branch) sales = sales.filter(s => s.branch === branch);
      sales = sales.filter(s => inRange(s.created_at, from, to));

      const tally = {};
      for (const s of sales) {
        for (const item of s.items || []) {
          if (!tally[item.sku]) tally[item.sku] = { rank: 0, sku: item.sku, name: item.name, qty: 0, revenue: 0 };
          tally[item.sku].qty += item.qty;
          tally[item.sku].revenue += item.price * item.qty;
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
      await ensureTabExists(token, sheetId, 'ยอดขาย', SALE_HEADERS);
      const [saleRows, prodRows] = await Promise.all([
        readSheet(token, sheetId, 'ยอดขาย!A:R'),
        readSheet(token, sheetId, 'สินค้า!A:R'),
      ]);
      const costMap = {}, catMap = {};
      prodRows.slice(1).forEach(r => { if (r[0]) { costMap[r[0]] = parseFloat(r[4]) || 0; catMap[r[0]] = r[2] || 'ไม่ระบุ'; } });

      let sales = saleRows.slice(1).map(r => rowToSale(r)).filter(s => s.bill_no && s.status !== 'ยกเลิก' && s.status !== 'ค้างชำระ');
      if (branch) sales = sales.filter(s => s.branch === branch);
      sales = sales.filter(s => inRange(s.created_at, from, to));

      const byCategory = {};
      for (const s of sales) {
        for (const item of s.items || []) {
          const cat = catMap[item.sku] || 'ไม่ระบุ';
          if (!byCategory[cat]) byCategory[cat] = { category: cat, revenue: 0, cost: 0, profit: 0 };
          byCategory[cat].revenue += item.price * item.qty;
          byCategory[cat].cost += (costMap[item.sku] || 0) * item.qty;
          byCategory[cat].profit += item.price * item.qty - (costMap[item.sku] || 0) * item.qty;
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
      await ensureTabExists(token, sheetId, 'รายจ่าย', EXPENSE_HEADERS);
      const rows = await readSheet(token, sheetId, 'รายจ่าย!A:L');
      let expenses = rows.slice(1).map(r => rowToExpense(r)).filter(e => e.expense_no);
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
    if (typeList.includes('vat')) {
      await ensureTabExists(token, sheetId, 'ยอดขาย', SALE_HEADERS);
      await ensureTabExists(token, sheetId, 'รับสินค้า', RECEIVE_HEADERS);
      await ensureTabExists(token, sheetId, 'รายจ่าย', EXPENSE_HEADERS);
      const [saleRows, receiveRows, expenseRows] = await Promise.all([
        readSheet(token, sheetId, 'ยอดขาย!A:R'),
        readSheet(token, sheetId, 'รับสินค้า!A:I'),
        readSheet(token, sheetId, 'รายจ่าย!A:L'),
      ]);

      let sales = saleRows.slice(1).map(r => rowToSale(r)).filter(s => s.bill_no && s.status !== 'ยกเลิก' && s.status !== 'ค้างชำระ');
      sales = sales.filter(s => inRange(s.created_at, from, to));
      let receives = receiveRows.slice(1).map(r => rowToReceive(r)).filter(r => r.receive_no);
      receives = receives.filter(r => inRange(r.created_at, from, to));
      let expensesForVat = expenseRows.slice(1).map(r => rowToExpense(r)).filter(e => e.expense_no);
      expensesForVat = expensesForVat.filter(e => inRange(e.created_at, from, to));

      const byBranch = {};
      for (const s of sales) {
        const key = s.branch || branchName || 'ไม่ระบุสาขา';
        if (!byBranch[key]) byBranch[key] = { branch: key, subtotal: 0, vat: 0, count: 0 };
        byBranch[key].subtotal += s.vat_subtotal;
        byBranch[key].vat += s.vat_amount;
        byBranch[key].count += 1;
      }
      const branchRows = Object.values(byBranch).sort((a, b) => b.vat - a.vat);

      const outputVat = sales.reduce((a, s) => a + s.vat_amount, 0);
      const outputVatSubtotal = sales.reduce((a, s) => a + s.vat_subtotal, 0);
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
      await ensureTabExists(token, sheetId, 'ใบกำกับภาษี', TAX_INVOICE_HEADERS);
      await ensureTabExists(token, sheetId, 'รับสินค้า', RECEIVE_HEADERS);
      await ensureTabExists(token, sheetId, 'รายจ่าย', EXPENSE_HEADERS);
      await ensureTabExists(token, sheetId, 'ผู้ติดต่อ', CONTACT_HEADERS);
      const [invoiceRows, receiveRows, expenseRows, contactRows] = await Promise.all([
        readSheet(token, sheetId, 'ใบกำกับภาษี!A:P'),
        readSheet(token, sheetId, 'รับสินค้า!A:J'),
        readSheet(token, sheetId, 'รายจ่าย!A:L'),
        readSheet(token, sheetId, 'ผู้ติดต่อ!A:W'),
      ]);
      const contactTaxId = {};
      contactRows.slice(1).forEach(r => { if (r[0]) contactTaxId[r[0]] = r[10] || ''; });

      let invoices = invoiceRows.slice(1).map(rowToTaxInvoice).filter(v => v.invoice_no);
      invoices = invoices.filter(v => inRange(v.issued_at, from, to));
      let receives = receiveRows.slice(1).map(rowToReceive).filter(r => r.receive_no);
      receives = receives.filter(r => inRange(r.created_at, from, to));
      let expensesForVat30 = expenseRows.slice(1).map(rowToExpense).filter(e => e.expense_no && e.vat_amount > 0);
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
      await ensureTabExists(token, sheetId, 'ยอดขาย', SALE_HEADERS);
      const rows = await readSheet(token, sheetId, 'ยอดขาย!A:R');
      let sales = rows.slice(1).map(rowToSale).filter(s => s.bill_no && s.status !== 'ยกเลิก' && s.status !== 'ค้างชำระ');
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
      const [prodRows3, contactRows3] = await Promise.all([
        readSheet(token, sheetId, 'สินค้า!A:S'),
        readSheet(token, sheetId, 'ผู้ติดต่อ!A:W'),
      ]);
      const cyclicalProducts = prodRows3.slice(1).map(rowToProduct).filter(p => p.sku && p.type === 'หมุนเวียน');
      const contacts3 = contactRows3.slice(1).map(rowToContact).filter(c => c.contact_id && c.cylinders > 0);

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

    const fileName = `SmileSlip_POS_${shopName}_${dateFrom || 'all'}.xlsx`;
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    return res.send(buf);
  } catch (err) {
    console.error('[pos/export]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
