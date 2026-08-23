/**
 * GET    /api/pos/expenses?shopId&date&dateFrom&dateTo&branch  → ประวัติรายจ่าย
 * POST   /api/pos/expenses { shopId, label, amount, vatType, payment_method, photo_url, notes, recordedBy, branch, payee }
 *   → บันทึกรายจ่ายของร้านที่ไม่เกี่ยวกับสต็อคสินค้า (ค่าเช่า/ค่าน้ำไฟ/ค่าแรง ฯลฯ) คนละระบบกับ "รับสินค้า"
 *   → amount คือยอดรวมที่จ่ายจริง (ตามที่กรอก) vatType กำหนดว่าจะแยก VAT กลับออกมายังไง
 *     ('รวม VAT แล้ว'/'ไม่รวม VAT'/'ไม่มี VAT' แบบเดียวกับ vat_type สินค้า/รับสินค้า)
 * DELETE /api/pos/expenses { shopId, expense_no }  → ลบรายการ (soft-delete)
 *
 * ข้อมูลเก็บสองที่:
 * 1. Supabase (pos_expenses) — รายละเอียด (VAT breakdown, รูปบิล/สลิป, สาขา ฯลฯ) — Phase 2
 *    (write-primary flip, 2026-07-29): เป็น primary/สมบูรณ์แล้ว ไม่ผ่าน Sheets อีกต่อไป
 * 2. Main shop Sheets (sheet ปี) — รายจ่ายเข้าบัญชีหลัก (ให้แสดงใน Dashboard Ledger/Analytics/#กำไรขาดทุน)
 *    — คนละระบบ (บอท LINE เอง) จงใจไม่แตะในรอบ migration นี้ (ดู CLAUDE.md Phase 2 Context) ยังเป็น
 *    best-effort เหมือนเดิม เปลี่ยนแค่ requirement ของ Google connection จากบังคับเป็น optional
 */
import { createClient } from '@supabase/supabase-js';
import { blockIfTrialExpired } from '../../../lib/shop-access';
import {
  getAccessToken, appendSheet, makeExpenseNo, expenseFromRow, resolveRecordDateTime,
} from '../../../lib/google-pos';
import { dualWrite, insertRow, LEDGER_TYPE } from '../../../lib/supabase-pos';
import { requirePermission } from '../../../lib/pos-auth';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

const VAT_RATE = 0.07;
const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

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

// Google connection ตอนนี้เป็น optional (แค่จำเป็นถ้าจะเขียนเข้าบัญชีหลักของบอทด้วย) — ไม่ throw
// ถ้ายังไม่ได้เชื่อมต่อ/ยังไม่ได้ตั้งค่า POS อีกต่อไป (products/contacts/expenses ไม่ต้องพึ่ง Sheets เลย)
async function getMainLedgerConfig(shopId) {
  const [{ data: gc }, { data: sp }, { data: pc }] = await Promise.all([
    supabase.from('shop_google_configs').select('google_refresh_token, google_sheet_id').eq('shop_id', shopId).maybeSingle(),
    supabase.from('shop_profiles').select('shop_name, branch_name').eq('id', shopId).maybeSingle(),
    supabase.from('pos_configs').select('vat_registered').eq('shop_id', shopId).maybeSingle(),
  ]);
  return {
    mainSheetId: gc?.google_sheet_id || null,
    refreshToken: gc?.google_refresh_token || null,
    shopName: sp?.shop_name || '',
    branchName: sp?.branch_name || '',
    vatRegistered: !!pc?.vat_registered,
  };
}

// เขียนรายจ่ายลง Sheets บัญชีหลัก (tab ปี ค.ศ.) ด้วย เพื่อให้แสดงในหน้ากราฟวิเคราะห์/Ledger ของ Dashboard
// และนับรวมใน #กำไรขาดทุน ของบอท LINE เหมือนกับที่ยอดขาย POS ทำอยู่แล้ว (writeToMainSheets ใน sales.js)
async function writeExpenseToMainSheets(refreshToken, mainSheetId, { shopId, total, label, payment_method, notes, shopName, branchName, recordedBy, transactionDate, expenseNo, vatAmount = 0 }) {
  if (!mainSheetId || !refreshToken) return;
  try {
    const token = await getAccessToken(refreshToken);
    const now = new Date();
    const thaiLocale = { timeZone: 'Asia/Bangkok' };
    const { thaiDate, thaiTime, isoYear: year } = resolveRecordDateTime(transactionDate);
    const todayISO = now.toLocaleDateString('en-CA', thaiLocale); // วันที่บันทึกจริง (recorded_at) — ไม่ backdate

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

    const noteText = [label, `เลขที่ ${expenseNo}`, notes].filter(Boolean).join(' | ');
    const paymentMethodFinal = payment_method === 'โอน' ? 'โอน' : 'เงินสด';

    // transaction_at ของ ledger_transactions ต้องเป็น timestamp จริง (ไม่ใช่สตริงไทย) — ประกอบจาก
    // transactionDate (ถ้า backdate) + เวลาปัจจุบัน กัน parity เพี้ยนแบบเดียวกับที่ Sheets เคยเจอ
    const txDate = transactionDate ? new Date(`${transactionDate}T00:00:00+07:00`) : now;
    const transactionAt = new Date(
      txDate.getFullYear(), txDate.getMonth(), txDate.getDate(),
      now.getHours(), now.getMinutes(), now.getSeconds()
    );

    await dualWrite({
      label: 'expenses-mainledger',
      primary: () => appendSheet(token, mainSheetId, year, [
        thaiDate, thaiTime, 'รายจ่าย', total,
        shopName,               // E ผู้โอน (ฝั่งจ่าย)
        label,                  // F ผู้รับ (รายการ/หมวดหมู่ ใช้แทนชื่อผู้รับเงินจริงเพราะไม่ได้เก็บ)
        noteText,               // G หมายเหตุ
        '', todayISO, branchName || shopName,
        // K-O เลขอ้างอิง/ภาษี — รายจ่ายทั่วไปไม่ผูกคู่ค้าที่มีเลขภาษีในระบบ (known gap: EXPENSE_HEADERS
        // ไม่มีช่องเลขภาษีคู่ค้า) แต่ร้านที่จด VAT ยังใส่ยอด VAT (N) ได้จาก vatType ที่กรอกไว้
        '', '', vatAmount > 0 ? vatAmount : '', '',
        label,                  // P หมวดหมู่
        paymentMethodFinal,     // Q วิธีรับ-จ่าย
        recordedBy || '',       // R ผู้บันทึก
      ]),
      secondary: () => insertRow('ledger_transactions', {
        shop_id: shopId, type: LEDGER_TYPE.EXPENSE, amount: total, category: label,
        note: noteText, sender_name: shopName, receiver_name: label,
        branch_name: branchName || shopName, payment_method: paymentMethodFinal,
        recorder_name: recordedBy || '', transaction_at: transactionAt.toISOString(),
        tax_amount: vatAmount > 0 ? vatAmount : null,
        raw_data: { source: 'pos-expenses', label, payment_method: paymentMethodFinal, notes, expense_no: expenseNo },
      }),
    });
  } catch (err) {
    console.error('[pos/expenses] writeExpenseToMainSheets error:', err.message);
  }
}

export default async function handler(req, res) {
  const shopId = req.query.shopId || req.body?.shopId;
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });

  // เขียนไม่ได้ถ้าทดลองใช้ 30 วันหมดอายุแล้ว (อ่าน/GET ยังทำได้ปกติเสมอ)
  if (req.method !== 'GET' && (await blockIfTrialExpired(req, res, shopId))) return;

  try {
    // ── GET ──────────────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      const { data, error } = await supabase.from('pos_expenses').select('*')
        .eq('shop_id', shopId).is('deleted_at', null);
      if (error) throw error;
      let expenses = (data || []).map(expenseFromRow).filter(e => e.expense_no);

      if (req.query.date) expenses = expenses.filter(e => e.created_at.startsWith(req.query.date));
      if (req.query.branch) expenses = expenses.filter(e => e.branch === req.query.branch);

      expenses.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      return res.json({
        expenses,
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
      if (!(await requirePermission(req, res, shopId, 'perm_manage_expenses'))) return;
      const {
        label = '', amount = 0, vatType = 'ไม่มี VAT', payment_method = 'เงินสด',
        photo_url = '', notes = '', recordedBy = '', branch = '', transactionDate = '', shift_no = '',
        payee = '',
      } = req.body;

      if (!label.trim()) return res.status(400).json({ error: 'กรุณาระบุรายการ/หมวดหมู่' });
      const numAmount = parseFloat(amount) || 0;
      if (numAmount <= 0) return res.status(400).json({ error: 'จำนวนเงินต้องมากกว่า 0' });

      const { base, vat } = splitVat(numAmount, vatType);
      const subtotal = Math.round(base * 100) / 100;
      const vatAmount = Math.round(vat * 100) / 100;
      const recordDT = resolveRecordDateTime(transactionDate); // วันที่ของรายจ่าย — backdate ได้ถ้าระบุ transactionDate
      const expenseNo = makeExpenseNo();

      const { error } = await supabase.from('pos_expenses').insert({
        shop_id: shopId, expense_no: expenseNo, transaction_at: recordDT.full,
        label: label.trim(), total: numAmount, vat_type: vatType, subtotal, vat_amount: vatAmount,
        payment_method, photo_url, notes, recorded_by: recordedBy, branch_name: branch, shift_no,
      });
      if (error) throw error;

      // payee (ผู้รับเงิน — ไม่บังคับ ใช้พิมพ์ใบสำคัญจ่าย) เป็นคอลัมน์ใหม่ — แยกเขียนต่างหาก
      // กันพังการบันทึกรายจ่ายหลักถ้ายังไม่ได้รัน SQL เพิ่มคอลัมน์ (pattern เดียวกับ shop/branches.js)
      if (payee?.trim()) {
        try {
          const { error: payeeErr } = await supabase.from('pos_expenses')
            .update({ payee: payee.trim() }).eq('shop_id', shopId).eq('expense_no', expenseNo);
          if (payeeErr) console.error('[pos/expenses] set payee failed (non-fatal):', payeeErr.message);
        } catch (payeeErr) {
          console.error('[pos/expenses] set payee failed (non-fatal):', payeeErr.message);
        }
      }

      // branch (สาขาที่เลือกไว้ในหน้า POS) ต้องมาก่อน branchName (ค่า default ของร้าน) เสมอ —
      // ไม่งั้นรายจ่ายทุกสาขาจะถูกนับรวมเป็นสาขาเดียวกันหมดในบัญชีหลัก/กราฟวิเคราะห์
      const { mainSheetId, refreshToken, shopName, branchName, vatRegistered } = await getMainLedgerConfig(shopId);
      await writeExpenseToMainSheets(refreshToken, mainSheetId, {
        shopId, total: numAmount, label: label.trim(), payment_method, notes, shopName,
        branchName: branch || branchName, recordedBy, transactionDate, expenseNo,
        vatAmount: vatRegistered ? vatAmount : 0,
      });

      return res.json({ ok: true, expenseNo, subtotal, vatAmount, total: numAmount });
    }

    // ── DELETE ───────────────────────────────────────────────────────────────
    if (req.method === 'DELETE') {
      if (!(await requirePermission(req, res, shopId, 'perm_manage_expenses'))) return;
      const { expense_no } = req.body;
      if (!expense_no) return res.status(400).json({ error: 'Missing expense_no' });

      const { data: existing, error: fetchErr } = await supabase.from('pos_expenses').select('expense_no')
        .eq('shop_id', shopId).eq('expense_no', expense_no).is('deleted_at', null).maybeSingle();
      if (fetchErr) throw fetchErr;
      if (!existing) return res.status(404).json({ error: 'ไม่พบรายการนี้' });

      const { error } = await supabase.from('pos_expenses')
        .update({ deleted_at: new Date().toISOString() })
        .eq('shop_id', shopId).eq('expense_no', expense_no);
      if (error) throw error;
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('[pos/expenses]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
