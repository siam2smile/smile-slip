/**
 * GET   /api/pos/cash-shifts?shopId                        → ประวัติกะทั้งหมด (ล่าสุดก่อน)
 * GET   /api/pos/cash-shifts?shopId&status=เปิดอยู่           → กะที่เปิดอยู่ตอนนี้ทั้งหมด
 * GET   /api/pos/cash-shifts?shopId&shift_no=xxx             → ดึงกะเดียว + คำนวณ "เงินสดที่ควรมีตอนนี้"
 *       สดๆ ถ้ากะยังเปิดอยู่ (ใช้พรีวิวก่อนกดปิดกะจริง — ค่านี้ไม่ผูกมัด คำนวณใหม่ตอน PATCH เสมอ)
 * POST  /api/pos/cash-shifts { shopId, staff_id, staff_name, branch, opening_cash } → เปิดกะใหม่
 *   → ผูกกับพนักงานคนเดียว (staff_id) ไม่ใช่สาขา/เครื่อง — พนักงาน 1 คนเปิดกะซ้อนกันไม่ได้
 *     (ต้องปิดกะเดิมก่อนถึงจะเปิดใหม่ได้) แต่หลายคนเปิดกะพร้อมกันบนเครื่องเดียวกันได้
 * PATCH /api/pos/cash-shifts { shopId, shift_no, counted_cash, notes, withdrawn_amount } → ปิดกะ
 *   → คำนวณ "เงินสดที่ควรมี" ใหม่จากข้อมูลจริงเสมอ (เงินสดตั้งต้น + ขายเงินสด − รายจ่ายเงินสด
 *     ที่ผูกกับกะนี้) ไม่เชื่อค่าที่ client ส่งมา — ถ้ายอดไม่ตรง (ส่วนต่าง ≠ 0) ต้องมีหมายเหตุ
 *     เสมอ (ไม่บล็อคการปิดกะ แค่บังคับอธิบาย) + push LINE แจ้งเจ้าของร้านอัตโนมัติถ้ามีส่วนต่าง
 */
import { createClient } from '@supabase/supabase-js';
import { blockIfTrialExpired } from '../../../lib/shop-access';
import {
  getAccessToken, readSheet, appendSheet, updateSheetRow, ensureTabExists,
  makeShiftNo, rowToCashShift, CASH_SHIFT_HEADERS,
  rowToSale, SALE_HEADERS, rowToExpense, EXPENSE_HEADERS,
} from '../../../lib/google-pos';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

// บังคับเก็บเป็นข้อความเสมอ กัน Sheets USER_ENTERED ตีความสตริงวันที่ไทย (มีปี พ.ศ.) เป็นเลข
// serial ผิดเพี้ยน ~543 ปี (บั๊กเดียวกับที่เจอซ้ำหลายจุดในโปรเจกต์นี้ — ดู CLAUDE.md ข้อ 19/27)
function asText(v) {
  if (v === '' || v == null) return v;
  return `'${v}`;
}

async function getConfig(shopId) {
  const [{ data: pc }, { data: gc }, { data: sp }] = await Promise.all([
    supabase.from('pos_configs').select('pos_sheet_id').eq('shop_id', shopId).single(),
    supabase.from('shop_google_configs').select('google_refresh_token').eq('shop_id', shopId).single(),
    supabase.from('shop_profiles').select('owner_line_id, shop_name').eq('id', shopId).single(),
  ]);
  if (!pc?.pos_sheet_id) throw Object.assign(new Error('ยังไม่ได้ตั้งค่า POS'), { notSetup: true });
  if (!gc?.google_refresh_token) throw Object.assign(new Error('ยังไม่ได้เชื่อมต่อ Google'), { notConnected: true });
  return {
    sheetId: pc.pos_sheet_id,
    ownerLineId: sp?.owner_line_id || '',
    shopName: sp?.shop_name || '',
    token: await getAccessToken(gc.google_refresh_token),
  };
}

async function pushLineMessage(lineId, message) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token || !lineId) return;
  try {
    await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: lineId, messages: [message] }),
    });
  } catch (err) {
    console.error('[cash-shifts] pushLineMessage error:', err.message);
  }
}

// คำนวณ "เงินสดที่ควรมี" ของกะนี้จากข้อมูลจริง — เงินสดตั้งต้น + ขายเงินสดที่ผูกกะนี้ − รายจ่ายเงินสดที่ผูกกะนี้
// (payment_method='เงินสด' เท่านั้น — โอน/เชื่อไม่กระทบเงินสดในลิ้นชัก) ใช้ `total` ของบิลตรงๆ
// (เงินทอนหักรวมอยู่ในนั้นแล้ว: รับ 500 ทอน 120 = สุทธิ 380 = total พอดี ไม่ต้องแยกคำนวณเงินทอนเอง
async function computeExpectedCash(token, sheetId, shift) {
  await ensureTabExists(token, sheetId, 'ยอดขาย', SALE_HEADERS);
  await ensureTabExists(token, sheetId, 'รายจ่าย', EXPENSE_HEADERS);
  const [saleRows, expenseRows] = await Promise.all([
    readSheet(token, sheetId, 'ยอดขาย!A:S'),
    readSheet(token, sheetId, 'รายจ่าย!A:M'),
  ]);
  const cashSales = saleRows.slice(1).map(rowToSale)
    .filter(s => s.bill_no && s.shift_no === shift.shift_no && s.payment_method === 'เงินสด' && s.status !== 'ยกเลิก');
  const cashExpenses = expenseRows.slice(1).map(rowToExpense)
    .filter(e => e.expense_no && e.shift_no === shift.shift_no && e.payment_method === 'เงินสด');
  const totalCashIn = cashSales.reduce((s, x) => s + x.total, 0);
  const totalCashOut = cashExpenses.reduce((s, x) => s + x.total, 0);
  const expected = Math.round((shift.opening_cash + totalCashIn - totalCashOut) * 100) / 100;
  return { expected, cashSalesCount: cashSales.length, cashExpensesCount: cashExpenses.length, totalCashIn, totalCashOut };
}

export default async function handler(req, res) {
  const shopId = req.query.shopId || req.body?.shopId;
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });

  // เขียนไม่ได้ถ้าทดลองใช้ 30 วันหมดอายุแล้ว (อ่าน/GET ยังทำได้ปกติเสมอ)
  if (req.method !== 'GET' && (await blockIfTrialExpired(req, res, shopId))) return;

  try {
    const { sheetId, token, ownerLineId, shopName } = await getConfig(shopId);
    await ensureTabExists(token, sheetId, 'กะเงินสด', CASH_SHIFT_HEADERS);

    // ── GET ──────────────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      const rows = await readSheet(token, sheetId, 'กะเงินสด!A:N');
      const shifts = rows.slice(1).map(rowToCashShift).filter(s => s.shift_no);

      if (req.query.shift_no) {
        const shift = shifts.find(s => s.shift_no === req.query.shift_no);
        if (!shift) return res.status(404).json({ error: 'ไม่พบกะ' });
        if (shift.status === 'เปิดอยู่') {
          const preview = await computeExpectedCash(token, sheetId, shift);
          return res.json({ shift: { ...shift, expected_cash: preview.expected } });
        }
        return res.json({ shift });
      }

      let filtered = shifts;
      if (req.query.status) filtered = filtered.filter(s => s.status === req.query.status);
      if (req.query.staffId) filtered = filtered.filter(s => s.staff_id === req.query.staffId);
      return res.json({ shifts: filtered.reverse() });
    }

    // ── POST (เปิดกะ) ────────────────────────────────────────────────────────
    if (req.method === 'POST') {
      const { staff_id = '', staff_name = '', branch = '', opening_cash = 0 } = req.body;
      if (!staff_id || !staff_name) return res.status(400).json({ error: 'ต้องระบุพนักงานที่เปิดกะ' });
      if (parseFloat(opening_cash) < 0) return res.status(400).json({ error: 'เงินสดตั้งต้นต้องไม่ติดลบ' });

      const rows = await readSheet(token, sheetId, 'กะเงินสด!A:N');
      const existingOpen = rows.slice(1).map(rowToCashShift)
        .find(s => s.shift_no && s.staff_id === staff_id && s.status === 'เปิดอยู่');
      if (existingOpen) {
        return res.status(400).json({ error: `${staff_name} มีกะที่ยังเปิดอยู่แล้ว (${existingOpen.shift_no}) กรุณาปิดกะเดิมก่อน`, shift_no: existingOpen.shift_no });
      }

      const shift_no = makeShiftNo();
      const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
      await appendSheet(token, sheetId, 'กะเงินสด', [
        shift_no, staff_id, staff_name, branch,
        asText(now), parseFloat(opening_cash) || 0,
        '', '', '', '', '', '', '', 'เปิดอยู่',
      ]);
      return res.json({ ok: true, shift_no, staff_name, opening_cash: parseFloat(opening_cash) || 0, opened_at: now });
    }

    // ── PATCH (ปิดกะ) ────────────────────────────────────────────────────────
    if (req.method === 'PATCH') {
      const { shift_no, counted_cash, notes = '', withdrawn_amount = 0 } = req.body;
      if (!shift_no) return res.status(400).json({ error: 'Missing shift_no' });
      if (counted_cash === undefined || parseFloat(counted_cash) < 0) {
        return res.status(400).json({ error: 'กรุณาระบุยอดเงินสดที่นับได้จริง (ต้องไม่ติดลบ)' });
      }
      if (parseFloat(withdrawn_amount) < 0) return res.status(400).json({ error: 'ยอดเก็บออกไปต้องไม่ติดลบ' });

      const rows = await readSheet(token, sheetId, 'กะเงินสด!A:N');
      const dataRows = rows.slice(1);
      const idx = dataRows.findIndex(r => r[0] === shift_no);
      if (idx === -1) return res.status(404).json({ error: 'ไม่พบกะ' });

      const shift = rowToCashShift(dataRows[idx]);
      if (shift.status !== 'เปิดอยู่') return res.status(400).json({ error: 'กะนี้ปิดไปแล้ว' });

      const { expected } = await computeExpectedCash(token, sheetId, shift);
      const counted = parseFloat(counted_cash) || 0;
      const variance = Math.round((counted - expected) * 100) / 100;

      if (variance !== 0 && !notes.trim()) {
        return res.status(400).json({ error: 'ยอดเงินสดไม่ตรงกับที่ระบบคำนวณ กรุณาระบุหมายเหตุก่อนปิดกะ', expected_cash: expected, variance });
      }

      const withdrawn = Math.min(counted, Math.max(0, parseFloat(withdrawn_amount) || 0));
      const carriedForward = Math.round((counted - withdrawn) * 100) / 100;
      const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });

      const existing = [...dataRows[idx]];
      while (existing.length < 14) existing.push('');
      existing[6]  = asText(now);       // ปิดกะเมื่อ
      existing[7]  = expected;          // เงินสดที่ควรมี
      existing[8]  = counted;           // เงินสดที่นับได้จริง
      existing[9]  = variance;          // ส่วนต่าง
      existing[10] = notes;             // หมายเหตุ
      existing[11] = withdrawn;         // ยอดเก็บออกไป
      existing[12] = carriedForward;    // ยอดยกไปกะถัดไป
      existing[13] = 'ปิดแล้ว';        // สถานะ
      await updateSheetRow(token, sheetId, 'กะเงินสด', idx + 2, existing);

      // แจ้งเจ้าของร้านทาง LINE ถ้ายอดไม่ตรง (ไม่บล็อคการปิดกะ แค่แจ้งเตือน)
      if (variance !== 0 && ownerLineId) {
        const overShort = variance > 0 ? 'เงินเกิน' : 'เงินขาด';
        await pushLineMessage(ownerLineId, {
          type: 'text',
          text: `⚠️ ปิดกะไม่ตรงยอด — ${shopName}\nพนักงาน: ${shift.staff_name}\nเงินที่ควรมี: ฿${expected.toLocaleString()}\nนับได้จริง: ฿${counted.toLocaleString()}\n${overShort}: ฿${Math.abs(variance).toLocaleString()}\nหมายเหตุ: ${notes}`,
        });
      }

      return res.json({ ok: true, shift_no, expected_cash: expected, counted_cash: counted, variance, withdrawn_amount: withdrawn, carried_forward: carriedForward, notified_owner: variance !== 0 && !!ownerLineId });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('[pos/cash-shifts]', err.message);
    if (err.notSetup) return res.status(400).json({ error: err.message, notSetup: true });
    if (err.notConnected) return res.status(400).json({ error: err.message, notConnected: true });
    return res.status(500).json({ error: err.message });
  }
}
