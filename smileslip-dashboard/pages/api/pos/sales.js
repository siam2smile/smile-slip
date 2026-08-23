/**
 * GET  /api/pos/sales?shopId&date=YYYY-MM-DD  → ประวัติยอดขาย
 * POST /api/pos/sales { shopId, items, discount, payment_method, cash_received, cashier, customerName, notes }
 *   → บันทึกยอดขาย + ตัดสต็อค + เขียน Sheets บัญชีหลัก (รายรับ)
 *
 * ข้อมูลเก็บสองที่ (คนละระบบกัน):
 * 1. Supabase (pos_sales) — รายละเอียดบิล (รายการสินค้า, ส่วนลด, เงินทอน ฯลฯ) — Phase 2
 *    (write-primary flip, 2026-07-29): อ่าน/เขียนตรงนี้แล้ว ไม่ผ่าน Google Sheets เลย
 * 2. Main shop Sheets (sheet ปี ของร้าน เอง ผ่าน writeToMainSheets()) — รายรับเข้าบัญชีหลัก
 *    (ให้แสดงใน Dashboard Ledger/บอท LINE) — **คงไว้ตามเดิมโดยเจตนา ไม่อยู่ในสโคปการตัด Sheets
 *    รอบนี้** เพราะเป็นระบบบัญชี "ข้อมูลเป็นของร้านเอง" คนละเรื่องกับข้อมูลปฏิบัติการของ POS —
 *    ตอนนี้เป็น best-effort เสมอ (ไม่บล็อคการขายถ้ายังไม่เชื่อม Google/เขียนไม่สำเร็จ)
 */
import { createClient } from '@supabase/supabase-js';
import { blockIfTrialExpired } from '../../../lib/shop-access';
import { hasFeature, upgradeMessage } from '../../../lib/tier-features';
import { requirePermission } from '../../../lib/pos-auth';
import {
  getAccessToken, appendSheet, makeBillNo, saleFromRow, productFromRow,
  computeVatBreakdown, logCyclicalTransaction, resolveRecordDateTime,
} from '../../../lib/google-pos';
import { dualWrite, insertRow, LEDGER_TYPE } from '../../../lib/supabase-pos';
import { getBranchStock, adjustBranchStock } from '../../../lib/pos-stock';
import { getLoyaltyConfig, redeemPoints, earnPointsFromSale } from '../../../lib/loyalty';

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

// Phase 2: ไม่ต้องมี pos_configs.pos_sheet_id/Google connection อีกต่อไปสำหรับตัวข้อมูลขายเอง —
// Google OAuth ยังใช้แบบ "optional" เฉพาะตอนเขียน main ledger sheet ของร้าน (writeToMainSheets)
// ถ้ายังไม่เชื่อมต่อก็ยังขายได้ปกติ แค่ไม่มีรายการไปโผล่ใน Dashboard Ledger/บอท LINE เท่านั้น
async function getConfig(shopId) {
  const [{ data: gc }, { data: sp }, { data: pc }] = await Promise.all([
    supabase.from('shop_google_configs').select('google_refresh_token, google_sheet_id').eq('shop_id', shopId).maybeSingle(),
    supabase.from('shop_profiles').select('shop_name, branch_name, subscription_tier').eq('id', shopId).single(),
    supabase.from('pos_configs').select('vat_registered').eq('shop_id', shopId).maybeSingle(),
  ]);
  let token = null;
  if (gc?.google_refresh_token) {
    try { token = await getAccessToken(gc.google_refresh_token); } catch (e) { console.error('[pos/sales] getAccessToken:', e.message); }
  }
  return {
    mainSheetId: gc?.google_sheet_id || null,
    shopName: sp?.shop_name || '',
    branchName: sp?.branch_name || '',
    tier: sp?.subscription_tier || 'normal',
    vatRegistered: !!pc?.vat_registered,
    token,
  };
}

// เขียนรายการขายลง Sheets บัญชีหลัก (tab ปี ค.ศ.) เพื่อให้แสดงใน Dashboard Ledger — คงไว้ตามเดิม
// ทุกประการ (out of scope การตัด Sheets รอบนี้ — ดูเหตุผลที่หัวไฟล์)
async function writeToMainSheets(token, mainSheetId, { shopId, billNo, items, total, payMethod, customerName, notes, shopName, branchName, slipUrl, slipSender, slipRefNo, transactionDate, vatAmount = 0 }) {
  if (!mainSheetId || !token) return;
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

    const txDate = transactionDate ? new Date(`${transactionDate}T00:00:00+07:00`) : now;
    const transactionAt = new Date(
      txDate.getFullYear(), txDate.getMonth(), txDate.getDate(),
      now.getHours(), now.getMinutes(), now.getSeconds()
    );

    await dualWrite({
      label: 'sales-mainledger',
      primary: () => appendSheet(token, mainSheetId, year, [
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
        // L-O ภาษี — ไม่มีเลขภาษี/ชื่อ/ที่อยู่ผู้ซื้อจริงสำหรับขายปลีกหน้าร้าน (ลูกค้าทั่วไปไม่ได้
        // ขอใบกำกับภาษีเต็มรูปทุกบิล) แต่ร้านที่จดทะเบียน VAT ต้องนับเป็นภาษีขายอยู่ดีตามกฎหมาย
        // (ภ.พ.30 นับจากยอดขายทั้งหมด ไม่ใช่แค่บิลที่ออกใบกำกับภาษีเต็มรูปมีเลขผู้ซื้อ) — ใส่แค่ยอด
        // ภาษี (N) ปล่อย L/M/O ว่างไว้ตามจริง
        '', '', vatAmount > 0 ? vatAmount : '', '',
        'ขายหน้าร้าน',         // P หมวดหมู่
        payMethodLabel,         // Q วิธีรับ-จ่าย
        '',                     // R ผู้บันทึก
      ]),
      secondary: () => insertRow('ledger_transactions', {
        shop_id: shopId, type: LEDGER_TYPE.INCOME, amount: total, category: 'ขายหน้าร้าน',
        note: noteText, sender_name: senderName, receiver_name: shopName,
        branch_name: branchName || shopName, payment_method: payMethodLabel,
        slip_url: slipUrl || null, transaction_at: transactionAt.toISOString(),
        tax_amount: vatAmount > 0 ? vatAmount : null,
        raw_data: { source: 'pos-sales', bill_no: billNo, ref_no: slipRefNo || billNo },
      }),
    });
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
    const { mainSheetId, shopName, branchName, tier, vatRegistered, token } = await getConfig(shopId);

    // ── GET ──────────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      const { data, error } = await supabase.from('pos_sales').select('*')
        .eq('shop_id', shopId).is('deleted_at', null).order('created_at', { ascending: true });
      if (error) throw error;
      let sales = (data || []).map(saleFromRow).filter(s => s.bill_no);

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
      const { bill_no, notes: patchNotes = '', collected_method = 'เงินสด', settled_shift_no = '' } = req.body;
      if (!bill_no) return res.status(400).json({ error: 'Missing bill_no' });
      // วิธีที่ลูกค้าเอามาจ่ายจริงตอนมาชำระเชื่อที่ร้าน (เงินสด/โอน) — เดิม hardcode เป็น
      // "เชื่อ/ชำระแล้ว" เสมอ (ตกไปแสดงเป็น "เงินสด" ในบัญชีหลักทุกครั้งไม่ว่าจะจ่ายด้วยวิธีไหนจริง
      // เพราะ writeToMainSheets แปลค่าอื่นที่ไม่ใช่ "โอน" เป็น "เงินสด" หมด) — **ตั้งใจไม่เปลี่ยน
      // pos_sales.payment_method เอง (ยังคงเป็น "เชื่อ" ตลอดไป)** เพราะ type=credit ใน reports.js
      // ใช้ payment_method==='เชื่อ' เป็นตัวกรองว่าบิลนี้เคยเป็นเงินเชื่อ (รวมที่ชำระแล้ว) ถ้าเปลี่ยน
      // จะทำให้บิลที่ชำระแล้วหายจากรายงานเงินเชื่อไปเลย — บันทึกวิธีชำระจริงไว้ใน notes + ป้ายในบัญชี
      // หลักเหมือนเดิม **และตอนนี้บันทึกเป็นคอลัมน์แยกด้วย (collected_method/settled_shift_no)**
      // ให้ computeExpectedCash() ใน cash-shifts.js นับยอดที่เก็บได้จากลูกหนี้เข้ากะที่เปิดอยู่ตอน
      // เก็บเงินจริงได้ (คนละกะจาก shift_no เดิมของบิลที่ผูกไว้ตอนสร้างบิล) — แก้ known gap เดิม
      const methodLabel = collected_method === 'โอน' ? 'โอน' : 'เงินสด';
      const collectNote = `ชำระด้วย: ${methodLabel}`;

      const { data: existing, error: fetchErr } = await supabase.from('pos_sales').select('*')
        .eq('shop_id', shopId).eq('bill_no', bill_no).is('deleted_at', null).maybeSingle();
      if (fetchErr) throw fetchErr;
      if (!existing) return res.status(404).json({ error: 'ไม่พบบิล' });
      if (existing.status === 'ชำระแล้ว') return res.status(400).json({ error: 'ชำระแล้ว' });

      const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
      const mergedNotes = [existing.notes, collectNote, patchNotes].filter(Boolean).join(' | ');

      const { error } = await supabase.from('pos_sales').update({
        status: 'ชำระแล้ว', paid_at: now, notes: mergedNotes,
      }).eq('shop_id', shopId).eq('bill_no', bill_no);
      if (error) throw error;

      // คอลัมน์ใหม่ (collected_method/settled_shift_no) — แยก update ต่างหาก + กันพัง เหมือน
      // คอลัมน์ใหม่อื่นๆ ในโปรเจกต์นี้เสมอ (ต้องรัน ALTER TABLE ก่อน ดู CLAUDE.md) ถ้ายังไม่ได้รัน
      // การบันทึกรับชำระเชื่อหลักยังสำเร็จปกติ แค่ยังไม่นับเข้ากะเงินสดจนกว่าจะรัน SQL
      try {
        await supabase.from('pos_sales').update({
          collected_method: methodLabel, settled_shift_no: settled_shift_no || null,
        }).eq('shop_id', shopId).eq('bill_no', bill_no);
      } catch {}

      // เขียนลง Main Sheets หลังชำระ (best-effort — ดูหัวไฟล์)
      const sale = saleFromRow({ ...existing, status: 'ชำระแล้ว', paid_at: now, notes: mergedNotes });
      await writeToMainSheets(token, mainSheetId, {
        shopId, billNo: sale.bill_no, items: sale.items, total: sale.total,
        payMethod: methodLabel,
        customerName: sale.customer_name, notes: sale.notes,
        shopName, branchName, slipUrl: '', slipSender: '', slipRefNo: '',
        vatAmount: vatRegistered ? sale.vat_amount : 0,
      });

      // ลดยอดค้างชำระของผู้ติดต่อกลับลง (ตอนขายเชื่อเคยบวกยอดนี้ไว้แล้ว — ดู POST ด้านล่าง)
      if (sale.customer_id) {
        try {
          const { data: cust } = await supabase.from('pos_contacts').select('debt')
            .eq('shop_id', shopId).eq('contact_id', sale.customer_id).is('deleted_at', null).maybeSingle();
          if (cust) {
            await supabase.from('pos_contacts').update({
              debt: Math.max(0, (parseFloat(cust.debt) || 0) - sale.total),
              contact_updated_at: now,
            }).eq('shop_id', shopId).eq('contact_id', sale.customer_id);
          }
        } catch (debtErr) {
          console.error('[pos/sales] settle credit debt error:', debtErr.message);
        }
      }

      return res.json({ ok: true });
    }

    // ── POST ─────────────────────────────────────────────────────────────
    if (req.method === 'POST') {
      if (!(await requirePermission(req, res, shopId, 'perm_process_sales'))) return;
      const {
        items = [], discount = 0, payment_method = 'เงินสด',
        cash_received = 0, cashier = '', notes = '',
        customerName = '', customerId = '',
        slipUrl = '', slipSender = '', slipRefNo = '',
        branch = '', transactionDate = '', shift_no = '',
        loyaltyPointsRedeemed = 0,
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

      // แลกแต้มสะสม (ถ้ามี) — คำนวณมูลค่าส่วนลดฝั่ง server เสมอ (ไม่เชื่อค่าบาทจาก client) จาก
      // อัตรา "บาท/แต้ม" ระดับร้าน (ใช้ค่าเดียวกับอัตราสะสม — แลก 1 แต้ม = คืนทุนเท่ากับที่ต้องใช้ซื้อ 1
      // แต้มตอนแรก, โมเดล breakeven มาตรฐาน) กัน client ส่งมูลค่าไม่ตรงกับแต้มที่หักจริง — ทั้ง "แลกเป็น
      // ส่วนลด" และ "แลกสินค้าเฉพาะ" ใช้ฟิลด์เดียวกันนี้ (จำนวนแต้มรวม) เพราะฝั่งแลกสินค้าจริงๆ คือ
      // frontend เติมสินค้ารางวัลเข้าตะกร้าที่ราคา ฿0 เอง (ผ่าน updatePrice ปกติ) ไม่ต้องมี logic แยก
      // ที่นี่เลย — เขียน ledger entry ทันทีที่ตรวจสอบผ่าน (ก่อน insert บิลจริง) ยอมรับความเสี่ยงเล็กน้อย
      // ที่ถ้า insert ล้มเหลวทีหลังแต้มจะถูกหักไปแล้วไม่มีบิลคู่กัน — เป็น trade-off เดียวกับที่ระบบอื่น
      // ในไฟล์นี้ (เช่น การตัดสต็อค) ใช้อยู่แล้วทั้งหมด ไม่ทำ transaction เต็มรูปแบบตามธรรมเนียมโปรเจกต์
      let loyaltyDiscountValue = 0;
      const redeemPts = Number(loyaltyPointsRedeemed) || 0;
      if (redeemPts > 0) {
        if (!customerId) return res.status(400).json({ error: 'ต้องเลือกลูกค้าก่อนถึงจะแลกแต้มสะสมได้' });
        const loyaltyConfig = await getLoyaltyConfig(shopId);
        if (!loyaltyConfig.enabled || !loyaltyConfig.bahtPerPoint) {
          return res.status(400).json({ error: 'ร้านนี้ยังไม่ได้เปิดใช้งานระบบแต้มสะสม' });
        }
        loyaltyDiscountValue = redeemPts * loyaltyConfig.bahtPerPoint;
        const redeemResult = await redeemPoints(shopId, {
          contactId: customerId, points: redeemPts, entryType: 'redeem',
          ref: '', note: customerName ? `แลกแต้ม ${redeemPts} แต้ม (${customerName})` : `แลกแต้ม ${redeemPts} แต้ม`,
          branch,
        });
        if (!redeemResult.ok) return res.status(400).json({ error: redeemResult.error });
      }

      const subtotal = items.reduce((sum, i) => sum + i.price * i.qty, 0);
      const total = Math.max(0, subtotal - discount - loyaltyDiscountValue);
      const change = payment_method === 'เงินสด' ? Math.max(0, cash_received - total) : 0;
      const billNo = makeBillNo();
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

      // อ่านสินค้าไว้ล่วงหน้า — ใช้ทั้งคำนวณ VAT (จาก vat_type ต่อ SKU), ตัดสต็อค, และเช็คเพดานเปล่ารอรีฟิล
      const { data: prodData } = await supabase.from('pos_products').select('*')
        .eq('shop_id', shopId).is('deleted_at', null);
      const productsForVat = (prodData || []).map(productFromRow);
      const { subtotal: vatSubtotal, vat: vatAmount } = computeVatBreakdown(items, productsForVat);

      // เตือน (ไม่บล็อค) ถ้าราคาที่ขายจริงต่ำกว่าต้นทุน / สต็อคสาขานี้ไม่พอ — ประกาศไว้ก่อนเสมอ เพราะ
      // ต้องใช้ตอนคำนวณ actual_stock_deducted ด้านล่างด้วย (ไม่ใช่แค่ตอนคำนวณ VAT ทีหลัง)
      const warnings = [];

      // คำนวณจำนวนที่จะถูกหักจาก "เต็ม" (stock) จริงต่อรายการไว้ล่วงหน้า แล้วฝังเข้า item ก่อนบันทึก
      // เป็น JSON — เพราะการหักสต็อคด้านล่าง clamp ไว้ที่ 0 ถ้าสต็อคมีไม่พอ "จำนวนที่หักจริง" อาจน้อยกว่า
      // item.qty ต้องจำค่าจริงไว้ ไม่งั้นตอนยกเลิกบิล (DELETE) จะคืนสต็อคเกินกว่าที่หักไปจริง (over-restore)
      // — โอนย้ายสต็อกข้ามสาขา Phase 1: เทียบกับสต็อคที่ "สาขานี้" เท่านั้น (ไม่ใช่ prod.stock ที่เป็น
      // ยอดรวมทั้งร้าน) เพราะขายที่สาขาไหนต้องหักจากของที่มีอยู่จริงที่สาขานั้น
      // — Phase 5: ถ้าสต็อคสาขานี้ไม่พอ (ขายเกินกว่าที่มีจริง) เตือนแอดมิน/แคชเชียร์ให้รู้ตัว แต่ยัง
      // **ไม่บล็อคการขาย** (ตัดสินใจให้สอดคล้องกับ philosophy เดิมของทั้งระบบ — ราคาต่ำกว่าทุน/เพดาน
      // เปล่ารอรีฟิล/วงเงินยืมก็เป็นแค่ warning ทั้งหมด ไม่เคยบล็อคจุดขาย เพราะสต็อคที่บันทึกไว้อาจผิดจริง
      // เช่น ลืมคีย์ของเข้าที่เพิ่งมาส่ง แคชเชียร์ต้องขายต่อได้เสมอไม่ให้ธุรกิจสะดุด)
      for (const item of items) {
        const prod = productsForVat.find(p => p.sku === item.sku);
        if (!prod) { item.actual_stock_deducted = 0; continue; }
        if (prod.type === 'ไม่นับสต็อค') {
          item.actual_stock_deducted = 0;
        } else {
          const branchStock = await getBranchStock(shopId, item.sku, branch);
          const wantQty = parseFloat(item.qty) || 0;
          item.actual_stock_deducted = Math.min(wantQty, branchStock.qty);
          if (branchStock.qty < wantQty) {
            const branchLabel = branch || 'ไม่ระบุสาขา';
            warnings.push(`⚠️ "${item.name}" สต็อคที่สาขา "${branchLabel}" มีไม่พอ (มี ${branchStock.qty} ขาย ${wantQty} ${item.unit || ''})`);
          }
        }
      }

      // 1. บันทึกลง pos_sales
      await insertRow('pos_sales', {
        shop_id: shopId, bill_no: billNo, transaction_at: recordDT.full, items,
        subtotal, discount, total, payment_method, cash_received, change_amount: change,
        cashier, notes: fullNotes, status: billStatus, customer_id: customerId,
        customer_name: customerName, paid_at: null, branch_name: branch,
        vat_subtotal: vatSubtotal, vat_amount: vatAmount, shift_no,
      });

      // 2. บันทึกลง Main shop Sheets เฉพาะเมื่อชำระแล้ว (ไม่บันทึกถ้าค้างชำระ/รอยืนยัน) — best-effort
      if (!isTransferPending && !isCredit) {
        await writeToMainSheets(token, mainSheetId, {
          shopId, billNo, items, total, payMethod: payment_method,
          customerName, notes, shopName, branchName: branch || branchName,
          slipUrl, slipSender, slipRefNo, transactionDate,
          vatAmount: vatRegistered ? vatAmount : 0,
        });
      }

      // 3. ตัดสต็อค / แลกถังสินค้าหมุนเวียน (fail-safe)
      //    สินค้าหมุนเวียน: ขาย 1 ถัง → หัก "เต็ม" (stock) ออก 1 เสมอ
      //    ถ้าลูกค้าเอาถังเปล่าเก่ามาคืน (item.returned_qty) → ถังนั้นไม่ได้ค้างอยู่กับลูกค้าเพิ่ม
      //    (กับลูกค้าสุทธิ = qty - returned_qty) และเพิ่ม "เปล่ารอรีฟิล" ตามจำนวนที่คืนมา
      let netCylinderDeltaForCustomer = 0;

      // เตือน (ไม่บล็อค) ถ้าราคาที่ขายจริงต่ำกว่าต้นทุน
      for (const item of items) {
        const prod = productsForVat.find(p => p.sku === item.sku);
        if (prod && prod.cost > 0 && parseFloat(item.price) < prod.cost) {
          warnings.push(`⚠️ "${item.name}" ขายราคา ${item.price} ต่ำกว่าต้นทุน (${prod.cost})`);
        }
      }

      try {
        for (const item of items) {
          const prod = productsForVat.find(p => p.sku === item.sku);
          if (!prod) continue;
          const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });

          if (prod.type === 'ไม่นับสต็อค') {
            continue; // บริการ/ไม่นับสต็อค: ไม่เปลี่ยนแปลงตัวเลขใดๆ
          } else if (prod.type === 'หมุนเวียน') {
            const returnedQty = parseInt(item.returned_qty) || 0;
            const netBorrow = item.qty - returnedQty;
            const stockDelta = item.actual_stock_deducted ?? 0; // คำนวณต่อสาขาไว้แล้วด้านบนก่อนบันทึกบิล
            const { empty_waiting: newEmptyWaiting, shopTotals } = await adjustBranchStock(
              shopId, item.sku, branch,
              { qtyDelta: -stockDelta, atCustomerDelta: netBorrow, emptyWaitingDelta: returnedQty }
            );
            await supabase.from('pos_products').update({ product_updated_at: now }).eq('shop_id', shopId).eq('sku', item.sku);
            netCylinderDeltaForCustomer += netBorrow;

            // เพดานเปล่ารอรีฟิล — ตั้งค่าไว้ระดับสินค้า (ไม่ใช่ระดับสาขา) เทียบกับยอดรวมทั้งร้านหลัง sync
            // เตือนเท่านั้น ไม่บล็อคการขาย
            if (prod.empty_ceiling > 0 && shopTotals.empty_waiting > prod.empty_ceiling) {
              warnings.push(`⚠️ "${item.name}" เปล่ารอรีฟิลเกินเพดาน (${shopTotals.empty_waiting}/${prod.empty_ceiling} ${item.unit || ''})`);
            }

            await logCyclicalTransaction({
              shopId,
              sku: item.sku, name: item.name, source: 'ขายหน้าร้าน',
              action: returnedQty > 0 ? 'แลกเปลี่ยน' : 'ยืม',
              qty: returnedQty > 0 ? returnedQty : netBorrow,
              customerId, customerName, branch, performedBy: cashier,
            });
            if (returnedQty > 0 && netBorrow > 0) {
              await logCyclicalTransaction({
                shopId,
                sku: item.sku, name: item.name, source: 'ขายหน้าร้าน', action: 'ยืม',
                qty: netBorrow, customerId, customerName, branch, performedBy: cashier,
              });
            }
          } else {
            const stockDelta = item.actual_stock_deducted ?? 0; // คำนวณต่อสาขาไว้แล้วด้านบนก่อนบันทึกบิล
            await adjustBranchStock(shopId, item.sku, branch, { qtyDelta: -stockDelta });
            await supabase.from('pos_products').update({ product_updated_at: now }).eq('shop_id', shopId).eq('sku', item.sku);
          }
        }

        // อัปเดตยอด "ถังอยู่กับลูกค้า" + "ยอดค้างชำระ" ของผู้ติดต่อ (ถ้าเลือกลูกค้าไว้ตอนขาย)
        if (customerId && (netCylinderDeltaForCustomer !== 0 || isCredit)) {
          const { data: cust } = await supabase.from('pos_contacts').select('*')
            .eq('shop_id', shopId).eq('contact_id', customerId).is('deleted_at', null).maybeSingle();
          if (cust) {
            const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
            const newCylinders = Math.max(0, (parseFloat(cust.cylinders) || 0) + netCylinderDeltaForCustomer);
            const custUpdates = { cylinders: newCylinders, contact_updated_at: now };
            if (isCredit) custUpdates.debt = (parseFloat(cust.debt) || 0) + total;
            await supabase.from('pos_contacts').update(custUpdates)
              .eq('shop_id', shopId).eq('contact_id', customerId);

            const limit = parseFloat(cust.cylinder_limit) || 0;
            if (limit > 0 && newCylinders > limit) {
              warnings.push(`⚠️ ลูกค้ายืมสินค้าหมุนเวียนเกินวงเงินที่ตั้งไว้ (${newCylinders}/${limit})`);
            }
          }
        }
      } catch (stockErr) {
        console.error('[pos/sales] stock deduct error:', stockErr.message);
      }

      // สะสมแต้มให้ลูกค้า (ถ้าผูกลูกค้าไว้) — เฉพาะบิลที่ชำระแล้วจริงเท่านั้น (เงื่อนไขเดียวกับที่ใช้
      // ตัดสินใจเขียนเข้าบัญชีหลักด้านบน — บิลเชื่อ/รอยืนยันโอนยังไม่ได้เงินจริง ไม่ควรให้แต้มจนกว่าจะ
      // ชำระสำเร็จ) fail-safe เต็มรูปแบบอยู่แล้วใน earnPointsFromSale เอง ไม่มีทาง throw ออกมาที่นี่
      const loyaltyPointsEarned = (!isTransferPending && !isCredit)
        ? await earnPointsFromSale(shopId, { contactId: customerId, contactName: customerName, items, branch, billNo })
        : 0;

      return res.json({
        ok: true, billNo, total, change, vatSubtotal, vatAmount, warnings,
        loyaltyPointsEarned, loyaltyDiscountValue,
      });
    }

    // ── DELETE (ยกเลิกบิล) ───────────────────────────────────────────────────
    // เดิมบิลที่คีย์ผิด (ราคา/จำนวน/สินค้าผิด) ไม่มีทางยกเลิกได้เลยผ่านหน้าเว็บ ต้องรบกวนแอดมินเข้า
    // Sheets แก้เอง — คืนสต็อค/ถังลูกค้า/ยอดค้างชำระ (ถ้าเป็นบิลเชื่อ) กลับที่เดิม แล้ว soft-delete
    // หมายเหตุ: ถ้าบิลนั้น "ชำระแล้ว" (เขียนเข้าบัญชีหลักไปแล้ว) การยกเลิกจะไม่ลบแถวในบัญชีหลักอัตโนมัติ
    // (หาแถวที่แน่ชัดยากเพราะบัญชีหลักไม่ได้เก็บ reference กลับมาที่ bill_no เสมอไป) ต้องลบเองถ้าจำเป็น
    // ⚠️ known gap เดียวกันสำหรับแต้มสะสม (ตั้งใจไม่ทำ ไม่ใช่ลืม): ยกเลิกบิลไม่ย้อนแต้มที่ได้/แลกไปคืน
    // เพราะโมเดล FIFO-consumption ของ loyalty ledger คำนวณ "ถังแต้ม" ตามลำดับเวลาจริงเสมอ — ถ้าบิล A
    // เคยให้แต้มแล้วลูกค้าแลกแต้มบางส่วนไปแล้ว (อาจดึงจากถังของบิลอื่นปนด้วย) การจะ "ย้อนเฉพาะถังของบิล
    // A" อย่างถูกต้อง 100% ต้องรื้อ FIFO ใหม่ทั้งสาย ซับซ้อนเกินความคุ้มค่าสำหรับ edge case ที่พบยาก
    // (ต้องยกเลิกบิลเก่าหลังลูกค้าแลกแต้มไปแล้วพอดี) — ถ้าจำเป็นต้องแก้ยอดแต้ม ให้ปรับด้วยมือผ่าน
    // pos_loyalty_ledger โดยตรง (entryType: 'adjust')
    if (req.method === 'DELETE') {
      // ยกเลิกบิล = ย้อนกลับสต็อค/ยอดค้างชำระ — เสี่ยงถูกใช้ปิดบังยอดขายจริงถ้าไม่คุมสิทธิ์
      // (พนักงาน/แคชเชียร์ทั่วไปไม่ควรยกเลิกบิลได้เอง ต้องเปิดสิทธิ์ perm_void_sales ให้ชัดเจน)
      if (!(await requirePermission(req, res, shopId, 'perm_void_sales'))) return;

      const { bill_no } = req.body;
      if (!bill_no) return res.status(400).json({ error: 'Missing bill_no' });

      const { data: existing, error: fetchErr } = await supabase.from('pos_sales').select('*')
        .eq('shop_id', shopId).eq('bill_no', bill_no).is('deleted_at', null).maybeSingle();
      if (fetchErr) throw fetchErr;
      if (!existing) return res.status(404).json({ error: 'ไม่พบบิล' });

      const sale = saleFromRow(existing);
      const isCredit = sale.payment_method === 'เชื่อ';
      const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });

      // คืนสต็อค/ถังลูกค้า — ย้อนกลับตรรกะเดียวกับตอนบันทึกขาย (fail-safe ไม่ให้พังการยกเลิกทั้งหมด)
      // — โอนย้ายสต็อกข้ามสาขา Phase 1: คืนกลับเข้าสาขาเดียวกับที่บิลนี้ขาย (sale.branch)
      let netCylinderDeltaForCustomer = 0;
      try {
        for (const item of (sale.items || [])) {
          const { data: prodRow } = await supabase.from('pos_products').select('*')
            .eq('shop_id', shopId).eq('sku', item.sku).is('deleted_at', null).maybeSingle();
          if (!prodRow) continue;
          const prod = productFromRow(prodRow);
          if (prod.type === 'ไม่นับสต็อค') continue;
          // คืนเท่าที่ "หักจริง" ตอนขาย ไม่ใช่ item.qty เสมอ (ดูคอมเมนต์เดิมด้านบนหัวไฟล์ POST)
          const stockRestore = (typeof item.actual_stock_deducted === 'number') ? item.actual_stock_deducted : item.qty;
          if (prod.type === 'หมุนเวียน') {
            const returnedQty = parseInt(item.returned_qty) || 0;
            const netBorrow = item.qty - returnedQty;
            await adjustBranchStock(shopId, item.sku, sale.branch, {
              qtyDelta: stockRestore, atCustomerDelta: -netBorrow, emptyWaitingDelta: -returnedQty,
            });
            netCylinderDeltaForCustomer -= netBorrow;
          } else {
            await adjustBranchStock(shopId, item.sku, sale.branch, { qtyDelta: stockRestore });
          }
          await supabase.from('pos_products').update({ product_updated_at: now }).eq('shop_id', shopId).eq('sku', item.sku);
        }
      } catch (err) {
        console.error('[pos/sales] cancel: restore stock error:', err.message);
      }

      // คืนยอดค้างชำระ/ถังลูกค้า (ถ้าผูกลูกค้าไว้ตอนขาย)
      if (sale.customer_id) {
        try {
          const { data: cust } = await supabase.from('pos_contacts').select('*')
            .eq('shop_id', shopId).eq('contact_id', sale.customer_id).is('deleted_at', null).maybeSingle();
          if (cust) {
            const custUpdates = { contact_updated_at: now };
            if (netCylinderDeltaForCustomer !== 0) {
              custUpdates.cylinders = Math.max(0, (parseFloat(cust.cylinders) || 0) + netCylinderDeltaForCustomer);
            }
            if (isCredit) {
              custUpdates.debt = Math.max(0, (parseFloat(cust.debt) || 0) - sale.total);
            }
            await supabase.from('pos_contacts').update(custUpdates)
              .eq('shop_id', shopId).eq('contact_id', sale.customer_id);
          }
        } catch (err) {
          console.error('[pos/sales] cancel: revert customer debt/cylinders error:', err.message);
        }
      }

      // soft-delete บิล
      const { error } = await supabase.from('pos_sales')
        .update({ deleted_at: new Date().toISOString() })
        .eq('shop_id', shopId).eq('bill_no', bill_no);
      if (error) throw error;

      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('[pos/sales]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
