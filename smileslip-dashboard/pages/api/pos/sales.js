/**
 * GET  /api/pos/sales?shopId&date=YYYY-MM-DD  → ประวัติยอดขาย
 * POST /api/pos/sales { shopId, items, discount, payment_method, cash_received, cashier, customerName, notes }
 *   → บันทึกยอดขาย + ตัดสต็อค + เขียน Sheets บัญชีหลัก (รายรับ)
 *
 * ข้อมูลเก็บสองที่:
 * 1. POS Sheets tab "ยอดขาย" — รายละเอียดบิล (รายการสินค้า, ส่วนลด, เงินทอน ฯลฯ)
 * 2. Main shop Sheets (sheet ปี) — รายรับเข้าบัญชีหลัก (ให้แสดงใน Dashboard Ledger)
 */
import { createClient } from '@supabase/supabase-js';
import {
  getAccessToken, readSheet, appendSheet, updateSheetRow,
  ensureTabExists, makeBillNo, rowToSale, SALE_HEADERS, rowToProduct, CONTACT_HEADERS,
} from '../../../lib/google-pos';

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

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

// เขียนรายการขายลง Sheets บัญชีหลัก (tab ปี ค.ศ.) เพื่อให้แสดงใน Dashboard Ledger
async function writeToMainSheets(token, mainSheetId, { billNo, items, total, payMethod, customerName, notes, shopName, branchName, slipUrl, slipSender, slipRefNo }) {
  if (!mainSheetId) return;
  try {
    const now = new Date();
    const year = now.getFullYear().toString();
    const thaiLocale = { timeZone: 'Asia/Bangkok' };
    const thaiDate = now.toLocaleDateString('th-TH', { ...thaiLocale, day: '2-digit', month: '2-digit', year: 'numeric' });
    const thaiTime = now.toLocaleTimeString('th-TH', thaiLocale);
    const todayISO = now.toLocaleDateString('en-CA', thaiLocale); // YYYY-MM-DD

    // ตรวจ/สร้าง tab ปี พร้อม header 18 คอลัมน์
    const metaRes = await fetch(`${SHEETS_BASE}/${mainSheetId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
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

    // สรุปรายการสินค้า
    const itemsSummary = items.map(i => `${i.name}×${i.qty}`).join(', ');
    const noteText = [
      customerName ? `ลูกค้า: ${customerName}` : '',
      `ขายหน้าร้าน`,
      itemsSummary,
      notes,
    ].filter(Boolean).join(' | ');

    const payMethodLabel = payMethod === 'โอน' ? 'โอน' : 'เงินสด';

    // ถ้ามีสลิปที่อ่านด้วย OCR ให้ใช้ชื่อผู้โอนจริงจากสลิป
    const senderName = slipSender || customerName || 'cash sale / ขายเงินสด';

    await appendSheet(token, mainSheetId, year, [
      thaiDate,               // A วันที่สลิป
      thaiTime,               // B เวลา
      'รายรับ',               // C ประเภท
      total,                  // D จำนวนเงิน
      senderName,             // E ผู้โอน
      shopName,               // F ผู้รับ
      noteText,               // G หมายเหตุ
      slipUrl || '',          // H ลิงก์สลิป (Drive URL ถ้ามี)
      todayISO,               // I วันที่บันทึก
      branchName || shopName, // J ชื่อสาขา
      slipRefNo || billNo,    // K เลขอ้างอิง (ref_no จากสลิป ถ้ามี หรือ billNo)
      '', '', '', '',         // L-O ภาษี
      'ขายหน้าร้าน',         // P หมวดหมู่
      payMethodLabel,         // Q วิธีรับ-จ่าย
      '',                     // R ผู้บันทึก
    ]);
  } catch (err) {
    // ไม่หยุดระบบถ้าเขียน main Sheets ไม่ได้
    console.error('[pos/sales] writeToMainSheets error:', err.message);
  }
}

export default async function handler(req, res) {
  const shopId = req.query.shopId || req.body?.shopId;
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });

  try {
    const { sheetId, mainSheetId, token, shopName, branchName } = await getConfig(shopId);

    // ตรวจว่ามี tab "ยอดขาย" ไหม (บัญชีเก่าอาจยังไม่มีหรือชื่อผิด)
    await ensureTabExists(token, sheetId, 'ยอดขาย', SALE_HEADERS);

    // ── GET ──────────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      // A:P (16 คอลัมน์เต็ม) — เดิมอ่านแค่ A:L ทำให้รหัส/ชื่อลูกค้า (คอลัมน์ M/N) ไม่เคยถูกอ่านเลย
      const rows = await readSheet(token, sheetId, 'ยอดขาย!A:P');
      let sales = rows.slice(1).map(r => rowToSale(r)).filter(s => s.bill_no);

      if (req.query.date) {
        sales = sales.filter(s => {
          // created_at เก็บเป็น Thai locale เช่น "3/7/2569, 20:30:45" (D/M/พ.ศ.)
          const dateStr = req.query.date; // YYYY-MM-DD (ค.ศ.)
          const [y, m, d] = dateStr.split('-');
          const buddhistYear = (parseInt(y) + 543).toString();
          // match "D/M/พ.ศ." — ต้องขึ้นต้นด้วย D/ เพื่อกัน วันที่ 3 match วันที่ 13, 23
          const pattern = `${parseInt(d)}/${parseInt(m)}/${buddhistYear}`;
          return s.created_at.startsWith(pattern) || s.created_at.startsWith(dateStr);
        });
      }

      if (req.query.customerId) {
        sales = sales.filter(s => s.customer_id === req.query.customerId);
      }

      const summary = {
        count:    sales.length,
        total:    sales.reduce((sum, s) => sum + s.total, 0),
        cash:     sales.filter(s => s.payment_method === 'เงินสด').length,
        transfer: sales.filter(s => s.payment_method === 'โอน').length,
      };

      return res.json({ sales: sales.reverse(), summary });
    }

    // ── PATCH (รับชำระเงินเชื่อ) ─────────────────────────────────────────
    if (req.method === 'PATCH') {
      const { bill_no, notes: patchNotes = '' } = req.body;
      if (!bill_no) return res.status(400).json({ error: 'Missing bill_no' });

      const rows = await readSheet(token, sheetId, 'ยอดขาย!A:P');
      const dataRows = rows.slice(1);
      const idx = dataRows.findIndex(r => r[0] === bill_no);
      if (idx === -1) return res.status(404).json({ error: 'ไม่พบบิล' });

      const existing = [...dataRows[idx]];
      while (existing.length < 16) existing.push('');
      if (existing[11] === 'ชำระแล้ว') return res.status(400).json({ error: 'ชำระแล้ว' });

      const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
      existing[11] = 'ชำระแล้ว';
      existing[14] = now; // paid_at
      if (patchNotes) existing[10] = [existing[10], patchNotes].filter(Boolean).join(' | ');
      await updateSheetRow(token, sheetId, 'ยอดขาย', idx + 2, existing);

      // เขียนลง Main Sheets หลังชำระ
      const sale = rowToSale(existing);
      await writeToMainSheets(token, mainSheetId, {
        billNo: sale.bill_no, items: sale.items, total: sale.total,
        payMethod: 'เชื่อ/ชำระแล้ว',
        customerName: sale.customer_name, notes: sale.notes,
        shopName, branchName, slipUrl: '', slipSender: '', slipRefNo: '',
      });

      return res.json({ ok: true });
    }

    // ── POST ─────────────────────────────────────────────────────────────
    if (req.method === 'POST') {
      const {
        items = [], discount = 0, payment_method = 'เงินสด',
        cash_received = 0, cashier = '', notes = '',
        customerName = '', customerId = '',
        slipUrl = '', slipSender = '', slipRefNo = '',
        branch = '',
      } = req.body;
      if (!items.length) return res.status(400).json({ error: 'ไม่มีรายการสินค้า' });
      if (payment_method === 'เชื่อ' && !customerName) return res.status(400).json({ error: 'ต้องระบุลูกค้าสำหรับการขายเชื่อ' });

      const subtotal = items.reduce((sum, i) => sum + i.price * i.qty, 0);
      const total = Math.max(0, subtotal - discount);
      const change = payment_method === 'เงินสด' ? Math.max(0, cash_received - total) : 0;
      const billNo = makeBillNo();
      const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });

      const fullNotes = [
        customerName ? `ลูกค้า: ${customerName}` : '',
        notes,
      ].filter(Boolean).join(' | ');

      // เชื่อ → ค้างชำระ (ไม่บันทึก main sheets จนกว่าจะรับชำระ)
      // โอน ไม่มีสลิป → รอยืนยัน
      const isCredit = payment_method === 'เชื่อ';
      const isTransferPending = payment_method === 'โอน' && !slipUrl;
      const billStatus = isCredit ? 'ค้างชำระ' : isTransferPending ? 'รอยืนยัน' : 'ชำระแล้ว';

      // 1. บันทึกลง POS Sheets tab "ยอดขาย" (16 คอลัมน์ A-P)
      await appendSheet(token, sheetId, 'ยอดขาย', [
        billNo, now, JSON.stringify(items),
        subtotal, discount, total,
        payment_method, cash_received, change,
        cashier, fullNotes, billStatus,
        customerId, customerName, '', branch,
      ]);

      // 2. บันทึกลง Main shop Sheets เฉพาะเมื่อชำระแล้ว (ไม่บันทึกถ้าค้างชำระ/รอยืนยัน)
      if (!isTransferPending && !isCredit) {
        await writeToMainSheets(token, mainSheetId, {
          billNo, items, total, payMethod: payment_method,
          customerName, notes, shopName, branchName,
          slipUrl, slipSender, slipRefNo,
        });
      }

      // 3. ตัดสต็อค / แลกถังสินค้าหมุนเวียน (fail-safe)
      //    สินค้าหมุนเวียน: ขาย 1 ถัง → หัก "เต็ม" (stock) ออก 1 เสมอ (เดิมไม่หัก เป็นบั๊ก)
      //    ถ้าลูกค้าเอาถังเปล่าเก่ามาคืน (item.returned_qty) → ถังนั้นไม่ได้ค้างอยู่กับลูกค้าเพิ่ม
      //    (กับลูกค้าสุทธิ = qty - returned_qty) และเพิ่ม "เปล่ารอรีฟิล" ตามจำนวนที่คืนมา
      let netCylinderDeltaForCustomer = 0;
      try {
        const prodRows = await readSheet(token, sheetId, 'สินค้า!A:R');
        const dataRows = prodRows.slice(1);
        for (const item of items) {
          const idx = dataRows.findIndex(r => r[0] === item.sku);
          if (idx === -1) continue;
          const existing = [...dataRows[idx]];
          while (existing.length < 18) existing.push('');
          const rawType  = existing[10] || 'นับสต็อค';
          const prodType = rawType === 'ทั่วไป' ? 'นับสต็อค' : rawType;
          if (prodType === 'ไม่นับสต็อค') {
            // บริการ/ไม่นับสต็อค: ไม่เปลี่ยนแปลงตัวเลขใดๆ
            continue;
          } else if (prodType === 'หมุนเวียน') {
            const returnedQty = parseInt(item.returned_qty) || 0;
            existing[5]  = Math.max(0, (parseFloat(existing[5]) || 0) - item.qty); // เต็ม (stock) ลด — ออกจากร้านไปกับลูกค้า
            existing[11] = Math.max(0, (parseFloat(existing[11]) || 0) + item.qty - returnedQty); // กับลูกค้า สุทธิ
            existing[12] = (parseFloat(existing[12]) || 0) + returnedQty; // เปล่ารอรีฟิล
            existing[9]  = now;
            netCylinderDeltaForCustomer += item.qty - returnedQty;
          } else {
            existing[5] = Math.max(0, (parseFloat(existing[5]) || 0) - item.qty); // stock ลด
            existing[9] = now;
          }
          await updateSheetRow(token, sheetId, 'สินค้า', idx + 2, existing);
          dataRows[idx] = existing;
        }

        // อัปเดตยอด "ถังอยู่กับลูกค้า" ของผู้ติดต่อ (ถ้าเลือกลูกค้าไว้ตอนขาย)
        if (customerId && netCylinderDeltaForCustomer !== 0) {
          await ensureTabExists(token, sheetId, 'ผู้ติดต่อ', CONTACT_HEADERS);
          const custRows = await readSheet(token, sheetId, 'ผู้ติดต่อ!A:W');
          const custDataRows = custRows.slice(1);
          const custIdx = custDataRows.findIndex(r => r[0] === customerId);
          if (custIdx !== -1) {
            const custExisting = [...custDataRows[custIdx]];
            while (custExisting.length < 23) custExisting.push('');
            custExisting[14] = Math.max(0, (parseFloat(custExisting[14]) || 0) + netCylinderDeltaForCustomer); // ถังอยู่กับลูกค้า
            custExisting[19] = now; // updated_at
            await updateSheetRow(token, sheetId, 'ผู้ติดต่อ', custIdx + 2, custExisting);
          }
        }
      } catch (stockErr) {
        console.error('[pos/sales] stock deduct error:', stockErr.message);
      }

      return res.json({ ok: true, billNo, total, change });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('[pos/sales]', err.message);
    if (err.notSetup) return res.status(400).json({ error: err.message, notSetup: true });
    if (err.notConnected) return res.status(400).json({ error: err.message, notConnected: true });
    return res.status(500).json({ error: err.message });
  }
}
