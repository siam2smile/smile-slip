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
 *
 * Phase 2 (write-primary flip, 2026-07-29): อ่าน/เขียนจาก Supabase (pos_cash_shifts/pos_sales/
 * pos_expenses) โดยตรงแล้ว ไม่ผ่าน Google Sheets/Google connection อีกต่อไป
 */
import { createClient } from '@supabase/supabase-js';
import { blockIfTrialExpired } from '../../../lib/shop-access';
import { makeShiftNo, cashShiftFromRow, saleFromRow, expenseFromRow, deliveryOrderFromRow } from '../../../lib/google-pos';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

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

// คำนวณ "เงินสดที่ควรมี" ของกะนี้จากข้อมูลจริง — เงินสดตั้งต้น + ขายเงินสดที่ผูกกะนี้ + เงินที่เก็บ
// ได้จากลูกหนี้เป็นเงินสดระหว่างกะนี้ (ขายเชื่อ/ค้างจ่ายที่เพิ่งชำระ) − รายจ่ายเงินสดที่ผูกกะนี้
// (payment_method='เงินสด' เท่านั้น — โอน/เชื่อที่ยังไม่ชำระไม่กระทบเงินสดในลิ้นชัก) ใช้ `total`
// ของบิลตรงๆ (เงินทอนหักรวมอยู่ในนั้นแล้ว: รับ 500 ทอน 120 = สุทธิ 380 = total พอดี ไม่ต้องแยก
// คำนวณเงินทอนเอง) — ส่วนเก็บเงินจากลูกหนี้ (collected_method/settled_shift_no) เป็นคอลัมน์ใหม่
// (แก้ known gap เดิม: เดิมกะเงินสดไม่เคยนับเงินที่เก็บจากรับชำระเงินเชื่อเลย เพราะ payment_method
// ของบิลเชื่อคงเป็น 'เชื่อ'/'ค้างจ่าย' ตลอดไปโดยตั้งใจ ไม่ผ่านตัวกรอง payment_method='เงินสด' ข้างบน
// — แยก query + กันพังถ้ายังไม่ได้รัน ALTER TABLE เพิ่มคอลัมน์เหล่านี้ ดู CLAUDE.md)
async function computeExpectedCash(shopId, shift) {
  const [{ data: saleRows, error: saleErr }, { data: expenseRows, error: expErr }] = await Promise.all([
    supabase.from('pos_sales').select('*').eq('shop_id', shopId).eq('shift_no', shift.shift_no).is('deleted_at', null),
    supabase.from('pos_expenses').select('*').eq('shop_id', shopId).eq('shift_no', shift.shift_no).is('deleted_at', null),
  ]);
  if (saleErr) throw saleErr;
  if (expErr) throw expErr;
  const cashSales = (saleRows || []).map(saleFromRow)
    .filter(s => s.bill_no && s.payment_method === 'เงินสด' && s.status !== 'ยกเลิก');
  const cashExpenses = (expenseRows || []).map(expenseFromRow)
    .filter(e => e.expense_no && e.payment_method === 'เงินสด');

  let cashCollectedFromCredit = [];
  try {
    const [{ data: settledSaleRows }, { data: settledOrderRows }] = await Promise.all([
      supabase.from('pos_sales').select('*').eq('shop_id', shopId).eq('settled_shift_no', shift.shift_no)
        .eq('collected_method', 'เงินสด').is('deleted_at', null),
      supabase.from('pos_delivery_orders').select('*').eq('shop_id', shopId).eq('settled_shift_no', shift.shift_no)
        .eq('collected_method', 'เงินสด').is('deleted_at', null),
    ]);
    cashCollectedFromCredit = [
      ...(settledSaleRows || []).map(saleFromRow).filter(s => s.bill_no),
      ...(settledOrderRows || []).map(deliveryOrderFromRow).filter(o => o.order_no),
    ];
  } catch {}

  const totalCashIn = cashSales.reduce((s, x) => s + x.total, 0) + cashCollectedFromCredit.reduce((s, x) => s + x.total, 0);
  const totalCashOut = cashExpenses.reduce((s, x) => s + x.total, 0);
  const expected = Math.round((shift.opening_cash + totalCashIn - totalCashOut) * 100) / 100;
  return {
    expected, cashSalesCount: cashSales.length, cashExpensesCount: cashExpenses.length,
    cashCollectedFromCreditCount: cashCollectedFromCredit.length, totalCashIn, totalCashOut,
  };
}

export default async function handler(req, res) {
  const shopId = req.query.shopId || req.body?.shopId;
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });

  // เขียนไม่ได้ถ้าทดลองใช้ 30 วันหมดอายุแล้ว (อ่าน/GET ยังทำได้ปกติเสมอ)
  if (req.method !== 'GET' && (await blockIfTrialExpired(req, res, shopId))) return;

  try {
    // ── GET ──────────────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      if (req.query.shift_no) {
        const { data: shiftRow, error } = await supabase.from('pos_cash_shifts').select('*')
          .eq('shop_id', shopId).eq('shift_no', req.query.shift_no).maybeSingle();
        if (error) throw error;
        if (!shiftRow) return res.status(404).json({ error: 'ไม่พบกะ' });
        const shift = cashShiftFromRow(shiftRow);
        if (shift.status === 'เปิดอยู่') {
          const preview = await computeExpectedCash(shopId, shift);
          return res.json({ shift: { ...shift, expected_cash: preview.expected } });
        }
        return res.json({ shift });
      }

      let query = supabase.from('pos_cash_shifts').select('*').eq('shop_id', shopId);
      if (req.query.status) query = query.eq('status', req.query.status);
      if (req.query.staffId) query = query.eq('staff_id', req.query.staffId);
      const { data, error } = await query.order('created_at', { ascending: false });
      if (error) throw error;
      const shifts = (data || []).map(cashShiftFromRow).filter(s => s.shift_no);
      return res.json({ shifts });
    }

    // ── POST (เปิดกะ) ────────────────────────────────────────────────────────
    if (req.method === 'POST') {
      const { staff_id = '', staff_name = '', branch = '', opening_cash = 0 } = req.body;
      if (!staff_id || !staff_name) return res.status(400).json({ error: 'ต้องระบุพนักงานที่เปิดกะ' });
      if (parseFloat(opening_cash) < 0) return res.status(400).json({ error: 'เงินสดตั้งต้นต้องไม่ติดลบ' });

      const { data: existingOpenRow } = await supabase.from('pos_cash_shifts').select('shift_no')
        .eq('shop_id', shopId).eq('staff_id', staff_id).eq('status', 'เปิดอยู่').maybeSingle();
      if (existingOpenRow) {
        return res.status(400).json({ error: `${staff_name} มีกะที่ยังเปิดอยู่แล้ว (${existingOpenRow.shift_no}) กรุณาปิดกะเดิมก่อน`, shift_no: existingOpenRow.shift_no });
      }

      const shift_no = makeShiftNo();
      const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
      const openedAtIso = new Date().toISOString();

      const { error } = await supabase.from('pos_cash_shifts').insert({
        shop_id: shopId, shift_no, staff_id, staff_name, branch_name: branch,
        opened_at: openedAtIso, opening_cash: parseFloat(opening_cash) || 0, status: 'เปิดอยู่',
      });
      if (error) throw error;
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

      const { data: shiftRow, error: fetchErr } = await supabase.from('pos_cash_shifts').select('*')
        .eq('shop_id', shopId).eq('shift_no', shift_no).maybeSingle();
      if (fetchErr) throw fetchErr;
      if (!shiftRow) return res.status(404).json({ error: 'ไม่พบกะ' });

      const shift = cashShiftFromRow(shiftRow);
      if (shift.status !== 'เปิดอยู่') return res.status(400).json({ error: 'กะนี้ปิดไปแล้ว' });

      const { expected } = await computeExpectedCash(shopId, shift);
      const counted = parseFloat(counted_cash) || 0;
      const variance = Math.round((counted - expected) * 100) / 100;

      if (variance !== 0 && !notes.trim()) {
        return res.status(400).json({ error: 'ยอดเงินสดไม่ตรงกับที่ระบบคำนวณ กรุณาระบุหมายเหตุก่อนปิดกะ', expected_cash: expected, variance });
      }

      const withdrawn = Math.min(counted, Math.max(0, parseFloat(withdrawn_amount) || 0));
      const carriedForward = Math.round((counted - withdrawn) * 100) / 100;
      const closedAtIso = new Date().toISOString();

      const { error } = await supabase.from('pos_cash_shifts').update({
        closed_at: closedAtIso, expected_cash: expected, counted_cash: counted,
        variance, notes, withdrawn_amount: withdrawn, carried_forward: carriedForward, status: 'ปิดแล้ว',
      }).eq('shop_id', shopId).eq('shift_no', shift_no);
      if (error) throw error;

      // แจ้งเจ้าของร้านทาง LINE ถ้ายอดไม่ตรง (ไม่บล็อคการปิดกะ แค่แจ้งเตือน)
      let ownerLineId = '';
      let shopName = '';
      if (variance !== 0) {
        const { data: sp } = await supabase.from('shop_profiles').select('owner_line_id, shop_name').eq('id', shopId).maybeSingle();
        ownerLineId = sp?.owner_line_id || '';
        shopName = sp?.shop_name || '';
        if (ownerLineId) {
          const overShort = variance > 0 ? 'เงินเกิน' : 'เงินขาด';
          await pushLineMessage(ownerLineId, {
            type: 'text',
            text: `⚠️ ปิดกะไม่ตรงยอด — ${shopName}\nพนักงาน: ${shift.staff_name}\nเงินที่ควรมี: ฿${expected.toLocaleString()}\nนับได้จริง: ฿${counted.toLocaleString()}\n${overShort}: ฿${Math.abs(variance).toLocaleString()}\nหมายเหตุ: ${notes}`,
          });
        }
      }

      return res.json({ ok: true, shift_no, expected_cash: expected, counted_cash: counted, variance, withdrawn_amount: withdrawn, carried_forward: carriedForward, notified_owner: variance !== 0 && !!ownerLineId });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('[pos/cash-shifts]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
