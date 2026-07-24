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
import { blockIfTrialExpired } from '../../../lib/shop-access';
import { hasFeature, upgradeMessage } from '../../../lib/tier-features';
import { requirePermission } from '../../../lib/pos-auth';
import {
  getAccessToken, readSheet, appendSheet, updateSheetRow,
  ensureTabExists, makeBillNo, rowToSale, SALE_HEADERS, rowToProduct, CONTACT_HEADERS,
  computeVatBreakdown, logCyclicalTransaction, resolveRecordDateTime,
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
    supabase.from('shop_profiles').select('shop_name, branch_name, subscription_tier').eq('id', shopId).single(),
  ]);
  if (!pc?.pos_sheet_id) throw Object.assign(new Error('ยังไม่ได้ตั้งค่า POS'), { notSetup: true });
  if (!gc?.google_refresh_token) throw Object.assign(new Error('ยังไม่ได้เชื่อมต่อ Google'), { notConnected: true });
  return {
    sheetId: pc.pos_sheet_id,
    mainSheetId: gc.google_sheet_id || null,
    shopName: sp?.shop_name || '',
    branchName: sp?.branch_name || '',
    tier: sp?.subscription_tier || 'normal',
    token: await getAccessToken(gc.google_refresh_token),
  };
}

// เขียนรายการขายลง Sheets บัญชีหลัก (tab ปี ค.ศ.) เพื่อให้แสดงใน Dashboard Ledger
async function writeToMainSheets(token, mainSheetId, { billNo, items, total, payMethod, customerName, notes, shopName, branchName, slipUrl, slipSender, slipRefNo, transactionDate }) {
  if (!mainSheetId) return;
  try {
    const now = new Date();
    const thaiLocale = { timeZone: 'Asia/Bangkok' };
    const { thaiDate, thaiTime, isoYear: year } = resolveRecordDateTime(transactionDate);
    const todayISO = now.toLocaleDateString('en-CA', thaiLocale); // วันที่บันทึกจริง (recorded_at) — ไม่ backdate

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

  // เขียนไม่ได้ถ้าทดลองใช้ 30 วันหมดอายุแล้ว (อ่าน/GET ยังทำได้ปกติเสมอ)
  if (req.method !== 'GET' && (await blockIfTrialExpired(req, res, shopId))) return;


  try {
    const { sheetId, mainSheetId, token, shopName, branchName, tier } = await getConfig(shopId);

    // ตรวจว่ามี tab "ยอดขาย" ไหม (บัญชีเก่าอาจยังไม่มีหรือชื่อผิด)
    await ensureTabExists(token, sheetId, 'ยอดขาย', SALE_HEADERS);

    // ── GET ──────────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      // A:S (19 คอลัมน์เต็ม รวมเลขที่กะ) — เดิมอ่านแค่ A:L ทำให้รหัส/ชื่อลูกค้า (คอลัมน์ M/N) ไม่เคยถูกอ่านเลย
      const rows = await readSheet(token, sheetId, 'ยอดขาย!A:S');
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

      const rows = await readSheet(token, sheetId, 'ยอดขาย!A:R');
      const dataRows = rows.slice(1);
      const idx = dataRows.findIndex(r => r[0] === bill_no);
      if (idx === -1) return res.status(404).json({ error: 'ไม่พบบิล' });

      const existing = [...dataRows[idx]];
      while (existing.length < 18) existing.push('');
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

      // ลดยอดค้างชำระของผู้ติดต่อกลับลง (ตอนขายเชื่อเคยบวกยอดนี้ไว้แล้ว — ดู POST ด้านล่าง)
      if (sale.customer_id) {
        try {
          await ensureTabExists(token, sheetId, 'ผู้ติดต่อ', CONTACT_HEADERS);
          const custRows = await readSheet(token, sheetId, 'ผู้ติดต่อ!A:X');
          const custDataRows = custRows.slice(1);
          const custIdx = custDataRows.findIndex(r => r[0] === sale.customer_id);
          if (custIdx !== -1) {
            const custExisting = [...custDataRows[custIdx]];
            while (custExisting.length < 24) custExisting.push('');
            custExisting[13] = Math.max(0, (parseFloat(custExisting[13]) || 0) - sale.total); // ยอดค้างชำระ
            custExisting[19] = now; // updated_at
            await updateSheetRow(token, sheetId, 'ผู้ติดต่อ', custIdx + 2, custExisting);
          }
        } catch (debtErr) {
          console.error('[pos/sales] settle credit debt error:', debtErr.message);
        }
      }

      return res.json({ ok: true });
    }

    // ── POST ─────────────────────────────────────────────────────────────
    if (req.method === 'POST') {
      const {
        items = [], discount = 0, payment_method = 'เงินสด',
        cash_received = 0, cashier = '', notes = '',
        customerName = '', customerId = '',
        slipUrl = '', slipSender = '', slipRefNo = '',
        branch = '', transactionDate = '', shift_no = '',
      } = req.body;
      if (!items.length) return res.status(400).json({ error: 'ไม่มีรายการสินค้า' });
      // จำนวน/ราคาต้องไม่ติดลบ — จำนวนติดลบเคยทำให้ "ขาย" กลายเป็นวิธีเพิ่มสต็อคฟรีๆ ได้
      // (stock - (-qty) = stock + qty) และราคาติดลบไม่มีเหตุผลทางธุรกิจใดๆ เลย
      if (items.some(i => !(parseFloat(i.qty) > 0))) {
        return res.status(400).json({ error: 'จำนวนสินค้าต้องมากกว่า 0 ทุกรายการ' });
      }
      if (items.some(i => parseFloat(i.price) < 0)) {
        return res.status(400).json({ error: 'ราคาสินค้าต้องไม่ติดลบ' });
      }
      if (discount < 0) return res.status(400).json({ error: 'ส่วนลดต้องไม่ติดลบ' });
      if (payment_method === 'เชื่อ' && !customerName) return res.status(400).json({ error: 'ต้องระบุลูกค้าสำหรับการขายเชื่อ' });
      if (payment_method === 'เชื่อ' && !hasFeature(tier, 'credit_ar')) {
        return res.status(403).json({ error: upgradeMessage('credit_ar'), featureLocked: true });
      }

      const subtotal = items.reduce((sum, i) => sum + i.price * i.qty, 0);
      const total = Math.max(0, subtotal - discount);
      const change = payment_method === 'เงินสด' ? Math.max(0, cash_received - total) : 0;
      const billNo = makeBillNo();
      const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }); // เวลาจริงที่ตัดสต็อค — ไม่ backdate
      const recordDT = resolveRecordDateTime(transactionDate); // วันที่ของบิล — backdate ได้ถ้าระบุ transactionDate

      const fullNotes = [
        customerName ? `ลูกค้า: ${customerName}` : '',
        notes,
      ].filter(Boolean).join(' | ');

      // เชื่อ → ค้างชำระ (ไม่บันทึก main sheets จนกว่าจะรับชำระ)
      // โอน ไม่มีสลิป → รอยืนยัน
      const isCredit = payment_method === 'เชื่อ';
      const isTransferPending = payment_method === 'โอน' && !slipUrl;
      const billStatus = isCredit ? 'ค้างชำระ' : isTransferPending ? 'รอยืนยัน' : 'ชำระแล้ว';

      // อ่านสินค้าไว้ล่วงหน้า — ใช้ทั้งคำนวณ VAT (จาก vat_type ต่อ SKU), ตัดสต็อค, และเช็คเพดานเปล่ารอรีฟิล (คอลัมน์ S)
      const prodRows = await readSheet(token, sheetId, 'สินค้า!A:S');
      const dataRows = prodRows.slice(1);
      const productsForVat = dataRows.map(r => rowToProduct(r));
      const { subtotal: vatSubtotal, vat: vatAmount } = computeVatBreakdown(items, productsForVat);

      // 1. บันทึกลง POS Sheets tab "ยอดขาย" (19 คอลัมน์ A-S — เพิ่มเลขที่กะท้ายสุด)
      await appendSheet(token, sheetId, 'ยอดขาย', [
        billNo, recordDT.full, JSON.stringify(items),
        subtotal, discount, total,
        payment_method, cash_received, change,
        cashier, fullNotes, billStatus,
        customerId, customerName, '', branch,
        vatSubtotal, vatAmount, shift_no,
      ]);

      // 2. บันทึกลง Main shop Sheets เฉพาะเมื่อชำระแล้ว (ไม่บันทึกถ้าค้างชำระ/รอยืนยัน)
      // branch (สาขาที่เลือกไว้ในหน้า POS) ต้องมาก่อน branchName (ค่า default ของร้าน) เสมอ
      // ไม่งั้นยอดขายทุกสาขาจะถูกนับรวมเป็นสาขาเดียวกันหมดในบัญชีหลัก/กราฟวิเคราะห์
      if (!isTransferPending && !isCredit) {
        await writeToMainSheets(token, mainSheetId, {
          billNo, items, total, payMethod: payment_method,
          customerName, notes, shopName, branchName: branch || branchName,
          slipUrl, slipSender, slipRefNo, transactionDate,
        });
      }

      // 3. ตัดสต็อค / แลกถังสินค้าหมุนเวียน (fail-safe)
      //    สินค้าหมุนเวียน: ขาย 1 ถัง → หัก "เต็ม" (stock) ออก 1 เสมอ (เดิมไม่หัก เป็นบั๊ก)
      //    ถ้าลูกค้าเอาถังเปล่าเก่ามาคืน (item.returned_qty) → ถังนั้นไม่ได้ค้างอยู่กับลูกค้าเพิ่ม
      //    (กับลูกค้าสุทธิ = qty - returned_qty) และเพิ่ม "เปล่ารอรีฟิล" ตามจำนวนที่คืนมา
      let netCylinderDeltaForCustomer = 0;
      const warnings = [];

      // เตือน (ไม่บล็อค) ถ้าราคาที่ขายจริงต่ำกว่าต้นทุน — พนักงานแก้ราคาต่อรายการได้ตามปกติ (ฟีเจอร์ตั้งใจ)
      // แต่เจ้าของร้านควรเห็นสัญญาณถ้าขายต่ำกว่าทุนผิดปกติ (เช่น พิมพ์ราคาผิด หรือทุจริต)
      for (const item of items) {
        const prod = productsForVat.find(p => p.sku === item.sku);
        if (prod && prod.cost > 0 && parseFloat(item.price) < prod.cost) {
          warnings.push(`⚠️ "${item.name}" ขายราคา ${item.price} ต่ำกว่าต้นทุน (${prod.cost})`);
        }
      }

      try {
        for (const item of items) {
          const idx = dataRows.findIndex(r => r[0] === item.sku);
          if (idx === -1) continue;
          const existing = [...dataRows[idx]];
          while (existing.length < 19) existing.push('');
          const rawType  = existing[10] || 'นับสต็อค';
          const prodType = rawType === 'ทั่วไป' ? 'นับสต็อค' : rawType;
          if (prodType === 'ไม่นับสต็อค') {
            // บริการ/ไม่นับสต็อค: ไม่เปลี่ยนแปลงตัวเลขใดๆ
            continue;
          } else if (prodType === 'หมุนเวียน') {
            const returnedQty = parseInt(item.returned_qty) || 0;
            const netBorrow = item.qty - returnedQty;
            existing[5]  = Math.max(0, (parseFloat(existing[5]) || 0) - item.qty); // เต็ม (stock) ลด — ออกจากร้านไปกับลูกค้า
            existing[11] = Math.max(0, (parseFloat(existing[11]) || 0) + netBorrow); // กับลูกค้า สุทธิ
            existing[12] = (parseFloat(existing[12]) || 0) + returnedQty; // เปล่ารอรีฟิล
            existing[9]  = now;
            netCylinderDeltaForCustomer += netBorrow;

            // เพดานเปล่ารอรีฟิล — เตือนถ้าเกิน (ไม่บล็อคการขาย)
            const ceiling = parseFloat(existing[18]) || 0;
            if (ceiling > 0 && existing[12] > ceiling) {
              warnings.push(`⚠️ "${item.name}" เปล่ารอรีฟิลเกินเพดาน (${existing[12]}/${ceiling} ${item.unit || ''})`);
            }

            await logCyclicalTransaction(token, sheetId, {
              shopId,
              sku: item.sku, name: item.name, source: 'ขายหน้าร้าน',
              action: returnedQty > 0 ? 'แลกเปลี่ยน' : 'ยืม',
              qty: returnedQty > 0 ? returnedQty : netBorrow,
              customerId, customerName, branch, performedBy: cashier,
            });
            if (returnedQty > 0 && netBorrow > 0) {
              await logCyclicalTransaction(token, sheetId, {
                shopId,
                sku: item.sku, name: item.name, source: 'ขายหน้าร้าน', action: 'ยืม',
                qty: netBorrow, customerId, customerName, branch, performedBy: cashier,
              });
            }
          } else {
            existing[5] = Math.max(0, (parseFloat(existing[5]) || 0) - item.qty); // stock ลด
            existing[9] = now;
          }
          await updateSheetRow(token, sheetId, 'สินค้า', idx + 2, existing);
          dataRows[idx] = existing;
        }

        // อัปเดตยอด "ถังอยู่กับลูกค้า" + "ยอดค้างชำระ" ของผู้ติดต่อ (ถ้าเลือกลูกค้าไว้ตอนขาย)
        // isCredit ต้องอัปเดต debt ด้วยเสมอ — เดิมขายเชื่อไม่เคยแตะคอลัมน์นี้เลย (บั๊กจริง: ยอดค้างชำระ
        // ไม่ขึ้นที่หน้าผู้ติดต่อ/สรุปรวม ทั้งที่บิลถูกบันทึกเป็น "ค้างชำระ" ใน POS Sheets แล้วก็ตาม)
        if (customerId && (netCylinderDeltaForCustomer !== 0 || isCredit)) {
          await ensureTabExists(token, sheetId, 'ผู้ติดต่อ', CONTACT_HEADERS);
          const custRows = await readSheet(token, sheetId, 'ผู้ติดต่อ!A:X');
          const custDataRows = custRows.slice(1);
          const custIdx = custDataRows.findIndex(r => r[0] === customerId);
          if (custIdx !== -1) {
            const custExisting = [...custDataRows[custIdx]];
            while (custExisting.length < 24) custExisting.push('');
            const newCylinders = Math.max(0, (parseFloat(custExisting[14]) || 0) + netCylinderDeltaForCustomer);
            custExisting[14] = newCylinders; // ถังอยู่กับลูกค้า
            if (isCredit) {
              custExisting[13] = (parseFloat(custExisting[13]) || 0) + total; // ยอดค้างชำระ
            }
            custExisting[19] = now; // updated_at
            const limit = parseFloat(custExisting[23]) || 0;
            if (limit > 0 && newCylinders > limit) {
              warnings.push(`⚠️ ลูกค้ายืมสินค้าหมุนเวียนเกินวงเงินที่ตั้งไว้ (${newCylinders}/${limit})`);
            }
            await updateSheetRow(token, sheetId, 'ผู้ติดต่อ', custIdx + 2, custExisting);
          }
        }
      } catch (stockErr) {
        console.error('[pos/sales] stock deduct error:', stockErr.message);
      }

      return res.json({ ok: true, billNo, total, change, vatSubtotal, vatAmount, warnings });
    }

    // ── DELETE (ยกเลิกบิล) ───────────────────────────────────────────────────
    // เดิมบิลที่คีย์ผิด (ราคา/จำนวน/สินค้าผิด) ไม่มีทางยกเลิกได้เลยผ่านหน้าเว็บ ต้องรบกวนแอดมินเข้า
    // Sheets แก้เอง — คืนสต็อค/ถังลูกค้า/ยอดค้างชำระ (ถ้าเป็นบิลเชื่อ) กลับที่เดิม แล้วลบแถวทิ้ง
    // หมายเหตุ: ถ้าบิลนั้น "ชำระแล้ว" (เขียนเข้าบัญชีหลักไปแล้ว) การยกเลิกจะไม่ลบแถวในบัญชีหลักอัตโนมัติ
    // (หาแถวที่แน่ชัดยากเพราะบัญชีหลักไม่ได้เก็บ reference กลับมาที่ bill_no เสมอไป) ต้องลบเองถ้าจำเป็น
    if (req.method === 'DELETE') {
      // ยกเลิกบิล = ย้อนกลับสต็อค/ยอดค้างชำระ — เสี่ยงถูกใช้ปิดบังยอดขายจริงถ้าไม่คุมสิทธิ์
      // (พนักงาน/แคชเชียร์ทั่วไปไม่ควรยกเลิกบิลได้เอง ต้องเปิดสิทธิ์ perm_void_sales ให้ชัดเจน)
      if (!(await requirePermission(req, res, token, sheetId, 'perm_void_sales'))) return;

      const { bill_no } = req.body;
      if (!bill_no) return res.status(400).json({ error: 'Missing bill_no' });

      const rows = await readSheet(token, sheetId, 'ยอดขาย!A:R');
      const dataRows = rows.slice(1);
      const idx = dataRows.findIndex(r => r[0] === bill_no);
      if (idx === -1) return res.status(404).json({ error: 'ไม่พบบิล' });

      const sale = rowToSale(dataRows[idx]);
      const isCredit = sale.payment_method === 'เชื่อ';
      const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });

      // คืนสต็อค/ถังลูกค้า — ย้อนกลับตรรกะเดียวกับตอนบันทึกขาย (fail-safe ไม่ให้พังการยกเลิกทั้งหมด)
      let netCylinderDeltaForCustomer = 0;
      try {
        const prodRows = await readSheet(token, sheetId, 'สินค้า!A:S');
        const prodDataRows = prodRows.slice(1);
        for (const item of (sale.items || [])) {
          const pIdx = prodDataRows.findIndex(r => r[0] === item.sku);
          if (pIdx === -1) continue;
          const existing = [...prodDataRows[pIdx]];
          while (existing.length < 19) existing.push('');
          const rawType = existing[10] || 'นับสต็อค';
          const prodType = rawType === 'ทั่วไป' ? 'นับสต็อค' : rawType;
          if (prodType === 'ไม่นับสต็อค') continue;
          if (prodType === 'หมุนเวียน') {
            const returnedQty = parseInt(item.returned_qty) || 0;
            const netBorrow = item.qty - returnedQty;
            existing[5]  = (parseFloat(existing[5]) || 0) + item.qty; // คืนเต็มกลับ
            existing[11] = Math.max(0, (parseFloat(existing[11]) || 0) - netBorrow); // กับลูกค้าลดกลับ
            existing[12] = Math.max(0, (parseFloat(existing[12]) || 0) - returnedQty); // เปล่ารอรีฟิลลดกลับ
            netCylinderDeltaForCustomer -= netBorrow;
          } else {
            existing[5] = (parseFloat(existing[5]) || 0) + item.qty;
          }
          existing[9] = now;
          await updateSheetRow(token, sheetId, 'สินค้า', pIdx + 2, existing);
          prodDataRows[pIdx] = existing;
        }
      } catch (err) {
        console.error('[pos/sales] cancel: restore stock error:', err.message);
      }

      // คืนยอดค้างชำระ/ถังลูกค้า (ถ้าผูกลูกค้าไว้ตอนขาย)
      if (sale.customer_id) {
        try {
          await ensureTabExists(token, sheetId, 'ผู้ติดต่อ', CONTACT_HEADERS);
          const custRows = await readSheet(token, sheetId, 'ผู้ติดต่อ!A:X');
          const custDataRows = custRows.slice(1);
          const custIdx = custDataRows.findIndex(r => r[0] === sale.customer_id);
          if (custIdx !== -1) {
            const custExisting = [...custDataRows[custIdx]];
            while (custExisting.length < 24) custExisting.push('');
            if (netCylinderDeltaForCustomer !== 0) {
              custExisting[14] = Math.max(0, (parseFloat(custExisting[14]) || 0) + netCylinderDeltaForCustomer);
            }
            if (isCredit) {
              custExisting[13] = Math.max(0, (parseFloat(custExisting[13]) || 0) - sale.total);
            }
            custExisting[19] = now;
            await updateSheetRow(token, sheetId, 'ผู้ติดต่อ', custIdx + 2, custExisting);
          }
        } catch (err) {
          console.error('[pos/sales] cancel: revert customer debt/cylinders error:', err.message);
        }
      }

      // ลบแถวบิลทิ้ง (blank ทั้งแถว แบบเดียวกับ products/contacts)
      await updateSheetRow(token, sheetId, 'ยอดขาย', idx + 2, Array(18).fill(''));

      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('[pos/sales]', err.message);
    if (err.notSetup) return res.status(400).json({ error: err.message, notSetup: true });
    if (err.notConnected) return res.status(400).json({ error: err.message, notConnected: true });
    return res.status(500).json({ error: err.message });
  }
}
