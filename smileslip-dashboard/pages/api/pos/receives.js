/**
 * GET  /api/pos/receives?shopId&date&supplierId  → ประวัติรับสินค้า
 * POST /api/pos/receives { shopId, supplierId, supplier, items:[{sku,name,qty,unitCost,unit,vatType}], notes, branch }
 *   → บันทึกการรับสินค้า + อัปเดตสต็อค + คำนวณ weighted average cost ทุกรายการ
 *   → vatType ต่อรายการ: 'รวม VAT แล้ว' (unitCost รวม VAT แยกกลับออกมา) | 'ไม่รวม VAT' (unitCost ก่อน VAT บวก 7% เพิ่ม)
 *     | 'ไม่มี VAT' (ไม่มี VAT เลย) — แบบเดียวกับ vat_type ของสินค้า — ต้นทุนถ่วงน้ำหนักคำนวณจากฐานก่อน VAT เสมอ
 *
 * ข้อมูลเก็บสองที่:
 * 1. Supabase (pos_receives) — รายละเอียด (รายการสินค้า, VAT breakdown, ผู้จำหน่าย ฯลฯ) — Phase 2
 *    (write-primary flip, 2026-07-29): เป็น primary/สมบูรณ์แล้ว ไม่ผ่าน Sheets อีกต่อไป
 * 2. Main shop Sheets (sheet ปี) — รายจ่ายเข้าบัญชีหลัก (ให้แสดงใน Dashboard Ledger/Analytics/#กำไรขาดทุน)
 *    หมวดหมู่ "ซื้อสินค้าเข้าสต็อค (POS)" แยกจากรายจ่ายทั่วไป — คนละระบบ (บอท LINE เอง) จงใจไม่แตะ
 *    ในรอบ migration นี้ (ดู CLAUDE.md Phase 2 Context) ยังเป็น best-effort เหมือนเดิม เปลี่ยนแค่
 *    requirement ของ Google connection จากบังคับเป็น optional
 *
 * + Verified Market Price Index / Procurement Fraud Detection (v1 retail-only, lib/market-price.js):
 *   ทุกครั้งที่รับสินค้าเข้า เทียบราคาที่ซื้อจริงกับราคากลางอำเภอ/จังหวัด ถ้าแพงผิดปกติจะคืน `warnings`
 *   กลับไปด้วย + บันทึก procurement_alerts — นับเข้าตารางกลางนิรนาม (anonymous_market_prices) เฉพาะ
 *   ตอนมี photoUrl แนบมาด้วยเท่านั้น (verified data filter) — คนละตารางกับ pos_receives ไม่ต้องแก้
 */
const VAT_RATE = 0.07;
const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

// แยกฐานราคาก่อน VAT / ยอด VAT จากราคาที่กรอกจริง ตาม vatType ของรายการ
function splitVat(unitCost, vatType) {
  if (vatType === 'รวม VAT แล้ว') {
    const base = unitCost / (1 + VAT_RATE);
    return { base, vat: unitCost - base };
  }
  if (vatType === 'ไม่รวม VAT') {
    return { base: unitCost, vat: unitCost * VAT_RATE };
  }
  return { base: unitCost, vat: 0 }; // ไม่มี VAT
}
import { createClient } from '@supabase/supabase-js';
import {
  getAccessToken, appendSheet, makeReceiveNo, receiveFromRow, productFromRow, resolveRecordDateTime,
} from '../../../lib/google-pos';
import { getShopDistrictProvince, checkProcurementFraud, insertAnonymousMarketPrices, MARKET_PRICE_FEATURE_LIVE } from '../../../lib/market-price';
import { blockIfTrialExpired } from '../../../lib/shop-access';
import { dualWrite, insertRow, LEDGER_TYPE } from '../../../lib/supabase-pos';
import { requirePermission } from '../../../lib/pos-auth';
import { adjustBranchStock } from '../../../lib/pos-stock';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

// Google connection ตอนนี้เป็น optional (แค่จำเป็นถ้าจะเขียนเข้าบัญชีหลักของบอทด้วย)
async function getMainLedgerConfig(shopId) {
  const [{ data: gc }, { data: sp }] = await Promise.all([
    supabase.from('shop_google_configs').select('google_refresh_token, google_sheet_id').eq('shop_id', shopId).maybeSingle(),
    supabase.from('shop_profiles').select('shop_name, branch_name').eq('id', shopId).maybeSingle(),
  ]);
  return {
    mainSheetId: gc?.google_sheet_id || null,
    refreshToken: gc?.google_refresh_token || null,
    shopName: sp?.shop_name || '',
    branchName: sp?.branch_name || '',
  };
}

// เขียนต้นทุนรับสินค้าลง Sheets บัญชีหลัก (tab ปี ค.ศ.) ด้วย เพื่อให้แสดงในหน้ากราฟวิเคราะห์/Ledger ของ
// Dashboard และนับรวมใน #กำไรขาดทุน ของบอท LINE เหมือนกับที่ยอดขาย/รายจ่าย POS ทำอยู่แล้ว
async function writeReceiveToMainSheets(refreshToken, mainSheetId, { shopId, total, supplier, notes, shopName, branchName, transactionDate }) {
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

    const noteText = ['รับสินค้าเข้าสต็อค POS', notes].filter(Boolean).join(' | ');
    const category = 'ซื้อสินค้าเข้าสต็อค (POS)';

    const txDate = transactionDate ? new Date(`${transactionDate}T00:00:00+07:00`) : now;
    const transactionAt = new Date(
      txDate.getFullYear(), txDate.getMonth(), txDate.getDate(),
      now.getHours(), now.getMinutes(), now.getSeconds()
    );

    await dualWrite({
      label: 'receives-mainledger',
      primary: () => appendSheet(token, mainSheetId, year, [
        thaiDate, thaiTime, 'รายจ่าย', total,
        shopName,               // E ผู้โอน (ฝั่งจ่าย)
        supplier || '-',        // F ผู้รับ (ผู้จำหน่าย)
        noteText,               // G หมายเหตุ
        '', todayISO, branchName || shopName,
        '', '', '', '', '',     // K-O เลขอ้างอิง/ภาษี — ไม่เกี่ยวกับรับสินค้านี้
        category,                // P หมวดหมู่ — แยกจากรายจ่ายทั่วไปให้ดูออกว่าเป็นต้นทุนขาย
        'เงินสด',               // Q วิธีรับ-จ่าย — ไม่ได้เก็บวิธีชำระตอนรับสินค้า ใส่ค่า default
        '',                     // R ผู้บันทึก
      ]),
      secondary: () => insertRow('ledger_transactions', {
        shop_id: shopId, type: LEDGER_TYPE.EXPENSE, amount: total, category,
        note: noteText, sender_name: shopName, receiver_name: supplier || '-',
        branch_name: branchName || shopName, payment_method: 'เงินสด',
        transaction_at: transactionAt.toISOString(),
        raw_data: { source: 'pos-receives', supplier, notes },
      }),
    });
  } catch (err) {
    console.error('[pos/receives] writeReceiveToMainSheets error:', err.message);
  }
}

export default async function handler(req, res) {
  const shopId = req.query.shopId || req.body?.shopId;
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });

  // เขียนไม่ได้ถ้าทดลองใช้ 30 วันหมดอายุแล้ว (อ่าน/GET ยังทำได้ปกติเสมอ)
  if (req.method !== 'GET' && (await blockIfTrialExpired(req, res, shopId))) return;

  try {
    // ── GET ─────────────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      const { data, error } = await supabase.from('pos_receives').select('*').eq('shop_id', shopId);
      if (error) throw error;
      let receives = (data || []).map(receiveFromRow).filter(r => r.receive_no);

      // filter by date (YYYY-MM-DD)
      if (req.query.date) {
        receives = receives.filter(r => r.created_at.startsWith(req.query.date));
      }

      // filter by supplier (contact_id) — ใช้ดึงราคาซื้อล่าสุดต่อผู้จำหน่ายรายนี้
      if (req.query.supplierId) {
        receives = receives.filter(r => r.supplier_id === req.query.supplierId);
      }

      receives.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      return res.json({ receives });
    }

    // ── POST ─────────────────────────────────────────────────────────────────
    if (req.method === 'POST') {
      if (!(await requirePermission(req, res, shopId, 'perm_manage_receiving'))) return;
      const { supplierId = '', supplier = '', items = [], notes = '', branch = '', photoUrl = '', transactionDate = '' } = req.body;
      if (!items.length) return res.status(400).json({ error: 'ต้องมีรายการสินค้าอย่างน้อย 1 รายการ' });

      const nowThai = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }); // เวลาจริงที่ปรับสต็อค — ไม่ backdate
      const recordDT = resolveRecordDateTime(transactionDate); // วันที่ของ "รายการ" — backdate ได้ถ้าระบุ transactionDate
      const receiveNo = makeReceiveNo();
      let subtotal = 0;   // ยอดก่อน VAT (ต้นทุนถ่วงน้ำหนักของสินค้าคำนวณจากยอดนี้เสมอ)
      let vatTotal = 0;    // ยอด VAT รวมทั้งใบ

      // อัปเดตสต็อค + weighted avg cost ทีละสินค้า (ต้นทุนถ่วงน้ำหนักคำนวณจากฐานราคาก่อน VAT เสมอ)
      const itemsForMarket = []; // เก็บไว้ใช้ตรวจราคาตลาด/บันทึกดัชนีราคากลางหลังบันทึกสำเร็จ
      for (const item of items) {
        const { sku, qty, unitCost, vatType } = item;
        const numQty = parseFloat(qty) || 0;
        const numCost = parseFloat(unitCost) || 0;
        // ต้นทุนติดลบเคยไม่ถูกกันไว้ — จะทำให้ต้นทุนถ่วงน้ำหนักเพี้ยนติดลบได้ (กระทบ P&L/รายงานทั้งหมด)
        if (!sku || numQty <= 0 || numCost < 0) continue;

        const { base: unitBase, vat: unitVat } = splitVat(numCost, vatType);
        const lineSubtotal = numQty * unitBase;
        subtotal += lineSubtotal;
        vatTotal += numQty * unitVat;
        itemsForMarket.push({ name: item.name, unit: item.unit || '', unitBase });

        const { data: prodRow } = await supabase.from('pos_products').select('*')
          .eq('shop_id', shopId).eq('sku', sku).is('deleted_at', null).maybeSingle();
        if (!prodRow) continue;
        const prod = productFromRow(prodRow);

        // Weighted average cost: (เก่า × ต้นทุนเก่า + ใหม่ × ต้นทุนใหม่ก่อน VAT) / (เก่า + ใหม่)
        // ต้นทุนยังเป็นค่ากลางทั้งร้านเสมอ (ไม่แยกตามสาขา — ไม่มีเหตุผลทางธุรกิจที่ต้องแยก และ
        // จะกระทบรายงานกำไร/margin หลายจุด) ใช้ prod.stock (cache ผลรวมทั้งร้าน) เป็นน้ำหนักถ่วงเฉลี่ยเหมือนเดิม
        const newStock = prod.stock + numQty;
        const newAvgCost = newStock > 0
          ? (prod.stock * prod.cost + numQty * unitBase) / newStock
          : unitBase;

        await supabase.from('pos_products').update({
          cost: Math.round(newAvgCost * 100) / 100, product_updated_at: nowThai,
        }).eq('shop_id', shopId).eq('sku', sku);

        // โอนย้ายสต็อกข้ามสาขา Phase 1: เพิ่มสต็อกเข้าสาขาที่รับสินค้าจริง (branch) ไม่ใช่ยอดรวมทั้งร้าน
        // สินค้าหมุนเวียน: รับสินค้าเข้า = ได้ของที่รีฟิล/บรรจุกลับมาแล้ว ต้องหักออกจาก "เปล่ารอรีฟิล"
        // ของสาขานั้นด้วยเสมอ
        await adjustBranchStock(shopId, sku, branch, {
          qtyDelta: numQty,
          emptyWaitingDelta: prod.type === 'หมุนเวียน' ? -numQty : 0,
        });
      }

      const roundedSubtotal = Math.round(subtotal * 100) / 100;
      const roundedVat = Math.round(vatTotal * 100) / 100;
      const grandTotal = Math.round((subtotal + vatTotal) * 100) / 100;

      // บันทึกใบรับสินค้าลง Supabase
      const itemsForRow = items.map(i => {
        const q = parseFloat(i.qty) || 0;
        const c = parseFloat(i.unitCost) || 0;
        const { base, vat: unitVat } = splitVat(c, i.vatType);
        const lineSub = q * base;
        const lineVat = q * unitVat;
        return {
          sku: i.sku, name: i.name, qty: q, unit: i.unit || '', unitCost: c,
          vatType: i.vatType || 'ไม่มี VAT',
          vatAmount: Math.round(lineVat * 100) / 100,
          lineTotal: Math.round((lineSub + lineVat) * 100) / 100,
        };
      });

      const { error } = await supabase.from('pos_receives').insert({
        shop_id: shopId, receive_no: receiveNo, transaction_at: recordDT.full,
        supplier, items: itemsForRow, total_cost: grandTotal, notes,
        supplier_id: supplierId, subtotal: roundedSubtotal, vat_total: roundedVat,
        photo_url: photoUrl, branch_name: branch,
      });
      if (error) throw error;

      const { mainSheetId, refreshToken, shopName, branchName } = await getMainLedgerConfig(shopId);
      await writeReceiveToMainSheets(refreshToken, mainSheetId, {
        shopId, total: grandTotal, supplier, notes, shopName, branchName: branch || branchName, transactionDate,
      });

      // Market Price Index + Procurement Fraud Detection (v1 retail-only, fail-safe เสมอ)
      // — ดูรายละเอียดการตัดสินใจ/สิ่งที่ยังไม่ชัวร์ใน CLAUDE.md ข้อ 30
      let warnings = [];
      try {
        const { district, province } = await getShopDistrictProvince(shopId);
        if (district && province && itemsForMarket.length) {
          warnings = await checkProcurementFraud({
            shopId, branchName: branch || branchName, receiveDocNo: receiveNo,
            items: itemsForMarket, district, province,
          });
          // นับเข้าตารางกลางนิรนามเฉพาะตอนมีรูปแนบเป็นหลักฐาน (verified data filter)
          if (photoUrl) {
            await insertAnonymousMarketPrices({ shopId, items: itemsForMarket, district, province, priceType: 'retail' });
          }
        }
      } catch (marketErr) {
        console.error('[pos/receives] market-price error:', marketErr.message);
      }

      return res.json({ ok: true, receiveNo, subtotal: roundedSubtotal, vatTotal: roundedVat, totalCost: grandTotal, itemCount: items.length, warnings: MARKET_PRICE_FEATURE_LIVE ? warnings : [] });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('[pos/receives]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
