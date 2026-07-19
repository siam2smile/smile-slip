/**
 * GET    /api/pos/expenses?shopId&date&dateFrom&dateTo&branch  → ประวัติรายจ่าย
 * POST   /api/pos/expenses { shopId, label, amount, vatType, payment_method, photo_url, notes, recordedBy, branch }
 *   → บันทึกรายจ่ายของร้านที่ไม่เกี่ยวกับสต็อคสินค้า (ค่าเช่า/ค่าน้ำไฟ/ค่าแรง ฯลฯ) คนละระบบกับ "รับสินค้า"
 *   → amount คือยอดรวมที่จ่ายจริง (ตามที่กรอก) vatType กำหนดว่าจะแยก VAT กลับออกมายังไง
 *     ('รวม VAT แล้ว'/'ไม่รวม VAT'/'ไม่มี VAT' แบบเดียวกับ vat_type สินค้า/รับสินค้า)
 * DELETE /api/pos/expenses { shopId, expense_no }  → ลบรายการ (blank แถวทิ้ง แบบเดียวกับ products/contacts)
 *
 * ข้อมูลเก็บสองที่ (แบบเดียวกับ api/pos/sales.js):
 * 1. POS Sheets tab "รายจ่าย" — รายละเอียด (VAT breakdown, รูปบิล/สลิป, สาขา ฯลฯ)
 * 2. Main shop Sheets (sheet ปี) — รายจ่ายเข้าบัญชีหลัก (ให้แสดงใน Dashboard Ledger/Analytics/#กำไรขาดทุน)
 */
import { createClient } from '@supabase/supabase-js';
import {
  getAccessToken, readSheet, appendSheet, updateSheetRow, ensureTabExists,
  makeExpenseNo, rowToExpense, EXPENSE_HEADERS,
} from '../../../lib/google-pos';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

const VAT_RATE = 0.07;

// บังคับเก็บเป็นข้อความเสมอ กัน Sheets USER_ENTERED ตีความสตริงวันที่ไทย (มีปี พ.ศ.) เป็นเลข serial
// ผิดเพี้ยน ~543 ปี (พิสูจน์แล้วว่าเกิดขึ้นจริงกับ tab ใหม่ที่ไม่เคยมีข้อมูล/format มาก่อน)
function asText(v) {
  if (v === '' || v == null) return v;
  return `'${v}`;
}

function splitVat(amount, vatType) {
  if (vatType === 'รวม VAT แล้ว') {
    const base = amount / (1 + VAT_RATE);
    return { base, vat: amount - base };
  }
  if (vatType === 'ไม่รวม VAT') {
    return { base: amount, vat: amount * VAT_RATE };
  }
  return { base: amount, vat: 0 };
}

async function getConfig(shopId) {
  const [{ data: pc }, { data: gc }, { data: sp }] = await Promise.all([
    supabase.from('pos_configs').select('pos_sheet_id').eq('shop_id', shopId).single(),
    supabase.from('shop_google_configs').select('google_refresh_token, google_sheet_id').eq('shop_id', shopId).single(),
    supabase.from('shop_profiles').select('shop_name, branch_name').eq('id', shopId).single(),
  ]);
  if (!pc?.pos_sheet_id) throw Object.assign(new Error('ยังไม่ได้ตั้งค่า POS'), { notSetup: true });
  if (!gc?.google_refresh_token) throw Object.assign(new Error('ยังไม่ได้เชื่อมต่อ Google'), { notConnected: true });
  return {
    sheetId: pc.pos_sheet_id,
    mainSheetId: gc.google_sheet_id || null,
    shopName: sp?.shop_name || '',
    branchName: sp?.branch_name || '',
    token: await getAccessToken(gc.google_refresh_token),
  };
}

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

// เขียนรายจ่ายลง Sheets บัญชีหลัก (tab ปี ค.ศ.) ด้วย เพื่อให้แสดงในหน้ากราฟวิเคราะห์/Ledger ของ Dashboard
// และนับรวมใน #กำไรขาดทุน ของบอท LINE เหมือนกับที่ยอดขาย POS ทำอยู่แล้ว (writeToMainSheets ใน sales.js)
async function writeExpenseToMainSheets(token, mainSheetId, { total, label, payment_method, notes, shopName, branchName, recordedBy }) {
  if (!mainSheetId) return;
  try {
    const now = new Date();
    const year = now.getFullYear().toString();
    const thaiLocale = { timeZone: 'Asia/Bangkok' };
    const thaiDate = now.toLocaleDateString('th-TH', { ...thaiLocale, day: '2-digit', month: '2-digit', year: 'numeric' });
    const thaiTime = now.toLocaleTimeString('th-TH', thaiLocale);
    const todayISO = now.toLocaleDateString('en-CA', thaiLocale); // YYYY-MM-DD

    const metaRes = await fetch(`${SHEETS_BASE}/${mainSheetId}`, { headers: { Authorization: `Bearer ${token}` } });
    const meta = await metaRes.json();
    const yearTabExists = meta.sheets?.some(s => s.properties.title === year);
    if (!yearTabExists) {
      await fetch(`${SHEETS_BASE}/${mainSheetId}:batchUpdate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests: [{ addSheet: { properties: { title: year } } }] }),
      });
      const mainHeaders = [
        'วันที่สลิป','เวลา','ประเภท (รายรับ/รายจ่าย)','จำนวนเงิน (บาท)',
        'ผู้โอน','ผู้รับ','หมายเหตุ','ลิงก์สลิป (Drive)','วันที่บันทึก (recorded_at)',
        'ชื่อสาขา','เลขอ้างอิง/Hash','เลขภาษี','ชื่อผู้เสียภาษี','ยอดภาษี (บาท)',
        'ที่อยู่ผู้เสียภาษี','หมวดหมู่','วิธีรับ-จ่าย (โอน/เงินสด)','ผู้บันทึก',
      ];
      await appendSheet(token, mainSheetId, year, mainHeaders);
    }

    const noteText = ['รายจ่าย POS', notes].filter(Boolean).join(' | ');

    await appendSheet(token, mainSheetId, year, [
      thaiDate, thaiTime, 'รายจ่าย', total,
      shopName,               // E ผู้โอน (ฝั่งจ่าย)
      label,                  // F ผู้รับ (รายการ/หมวดหมู่ ใช้แทนชื่อผู้รับเงินจริงเพราะไม่ได้เก็บ)
      noteText,               // G หมายเหตุ
      '', todayISO, branchName || shopName,
      '', '', '', '', '',     // K-O เลขอ้างอิง/ภาษี — ไม่เกี่ยวกับรายจ่ายทั่วไปนี้
      label,                  // P หมวดหมู่
      payment_method === 'โอน' ? 'โอน' : 'เงินสด', // Q วิธีรับ-จ่าย
      recordedBy || '',       // R ผู้บันทึก
    ]);
  } catch (err) {
    console.error('[pos/expenses] writeExpenseToMainSheets error:', err.message);
  }
}

export default async function handler(req, res) {
  const shopId = req.query.shopId || req.body?.shopId;
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });

  try {
    const { sheetId, mainSheetId, shopName, branchName, token } = await getConfig(shopId);
    await ensureTabExists(token, sheetId, 'รายจ่าย', EXPENSE_HEADERS);

    // ── GET ──────────────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      const rows = await readSheet(token, sheetId, 'รายจ่าย!A:L');
      let expenses = rows.slice(1)
        .map((r, i) => ({ ...rowToExpense(r), _row: i + 2 }))
        .filter(e => e.expense_no);

      if (req.query.date) expenses = expenses.filter(e => e.created_at.startsWith(req.query.date));
      if (req.query.branch) expenses = expenses.filter(e => e.branch === req.query.branch);

      return res.json({
        expenses: expenses.reverse(),
        summary: {
          count: expenses.length,
          total: expenses.reduce((s, e) => s + e.total, 0),
          subtotal: expenses.reduce((s, e) => s + e.subtotal, 0),
          vat: expenses.reduce((s, e) => s + e.vat_amount, 0),
        },
      });
    }

    // ── POST ─────────────────────────────────────────────────────────────────
    if (req.method === 'POST') {
      const {
        label = '', amount = 0, vatType = 'ไม่มี VAT', payment_method = 'เงินสด',
        photo_url = '', notes = '', recordedBy = '', branch = '',
      } = req.body;

      if (!label.trim()) return res.status(400).json({ error: 'กรุณาระบุรายการ/หมวดหมู่' });
      const numAmount = parseFloat(amount) || 0;
      if (numAmount <= 0) return res.status(400).json({ error: 'จำนวนเงินต้องมากกว่า 0' });

      const { base, vat } = splitVat(numAmount, vatType);
      const subtotal = Math.round(base * 100) / 100;
      const vatAmount = Math.round(vat * 100) / 100;
      const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
      const expenseNo = makeExpenseNo();

      await appendSheet(token, sheetId, 'รายจ่าย', [
        expenseNo, asText(now), label.trim(), numAmount,
        vatType, subtotal, vatAmount, payment_method,
        photo_url, notes, recordedBy, branch,
      ]);

      // branch (สาขาที่เลือกไว้ในหน้า POS) ต้องมาก่อน branchName (ค่า default ของร้าน) เสมอ —
      // ไม่งั้นรายจ่ายทุกสาขาจะถูกนับรวมเป็นสาขาเดียวกันหมดในบัญชีหลัก/กราฟวิเคราะห์
      await writeExpenseToMainSheets(token, mainSheetId, {
        total: numAmount, label: label.trim(), payment_method, notes, shopName,
        branchName: branch || branchName, recordedBy,
      });

      return res.json({ ok: true, expenseNo, subtotal, vatAmount, total: numAmount });
    }

    // ── DELETE ───────────────────────────────────────────────────────────────
    if (req.method === 'DELETE') {
      const { expense_no } = req.body;
      if (!expense_no) return res.status(400).json({ error: 'Missing expense_no' });

      const rows = await readSheet(token, sheetId, 'รายจ่าย!A:L');
      const dataRows = rows.slice(1);
      const idx = dataRows.findIndex(r => r[0] === expense_no);
      if (idx === -1) return res.status(404).json({ error: 'ไม่พบรายการนี้' });

      await updateSheetRow(token, sheetId, 'รายจ่าย', idx + 2, Array(12).fill(''));
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('[pos/expenses]', err.message);
    if (err.notSetup) return res.status(400).json({ error: err.message, notSetup: true });
    if (err.notConnected) return res.status(400).json({ error: err.message, notConnected: true });
    return res.status(500).json({ error: err.message });
  }
}
