/**
 * GET /api/pos/export?shopId&dateFrom&dateTo&branch&types=sales,inventory,credit,loans,topsellers,pl
 * → ดาวน์โหลด Excel (.xlsx) หลาย sheet ในไฟล์เดียว
 */
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import {
  getAccessToken, readSheet, ensureTabExists,
  rowToSale, rowToProduct, rowToLoan,
  SALE_HEADERS, LOAN_HEADERS,
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
  if (!pc?.pos_sheet_id) throw new Error('ยังไม่ได้ตั้งค่า POS');
  if (!gc?.google_refresh_token) throw new Error('ยังไม่ได้เชื่อมต่อ Google');
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

function thb(n) { return parseFloat(n || 0); }
function fmt(n) { return Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { shopId, dateFrom, dateTo, branch, types = 'sales,inventory,credit,loans,topsellers,pl' } = req.query;
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });

  try {
    const { sheetId, token, shopName, branchName } = await getConfig(shopId);
    const from = dateFrom ? new Date(dateFrom) : null;
    const to   = dateTo   ? new Date(dateTo + 'T23:59:59') : null;
    const typeList = types.split(',').map(t => t.trim());
    const wb = XLSX.utils.book_new();

    const periodLabel = dateFrom && dateTo ? `${dateFrom} ถึง ${dateTo}` : dateFrom ? `ตั้งแต่ ${dateFrom}` : 'ทั้งหมด';
    const branchLabel = branch || branchName || shopName;

    // ── ยอดขาย (bank-statement) ──────────────────────────────────────────
    if (typeList.includes('sales')) {
      await ensureTabExists(token, sheetId, 'ยอดขาย', SALE_HEADERS);
      const rows = await readSheet(token, sheetId, 'ยอดขาย!A:P');
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
      const rows = await readSheet(token, sheetId, 'ยอดขาย!A:P');
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
        readSheet(token, sheetId, 'ยอดขาย!A:P'),
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
        readSheet(token, sheetId, 'ยอดขาย!A:P'),
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
