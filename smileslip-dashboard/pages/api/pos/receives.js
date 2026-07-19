/**
 * GET  /api/pos/receives?shopId&date&supplierId  → ประวัติรับสินค้า
 * POST /api/pos/receives { shopId, supplierId, supplier, items:[{sku,name,qty,unitCost,unit,vatType}], notes }
 *   → บันทึกการรับสินค้า + อัปเดตสต็อค + คำนวณ weighted average cost ทุกรายการ
 *   → vatType ต่อรายการ: 'รวม VAT แล้ว' (unitCost รวม VAT แยกกลับออกมา) | 'ไม่รวม VAT' (unitCost ก่อน VAT บวก 7% เพิ่ม)
 *     | 'ไม่มี VAT' (ไม่มี VAT เลย) — แบบเดียวกับ vat_type ของสินค้า — ต้นทุนถ่วงน้ำหนักคำนวณจากฐานก่อน VAT เสมอ
 *
 * เก็บใน Google Sheets tab "รับสินค้า" (PDPA compliant)
 */
const VAT_RATE = 0.07;

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
  getAccessToken, readSheet, appendSheet, updateSheetRow, ensureTabExists,
  makeReceiveNo, rowToReceive, rowToProduct, RECEIVE_HEADERS,
} from '../../../lib/google-pos';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

async function getConfig(shopId) {
  const [{ data: pc }, { data: gc }] = await Promise.all([
    supabase.from('pos_configs').select('pos_sheet_id').eq('shop_id', shopId).single(),
    supabase.from('shop_google_configs').select('google_refresh_token').eq('shop_id', shopId).single(),
  ]);
  if (!pc?.pos_sheet_id) throw Object.assign(new Error('ยังไม่ได้ตั้งค่า POS'), { notSetup: true });
  if (!gc?.google_refresh_token) throw Object.assign(new Error('ยังไม่ได้เชื่อมต่อ Google'), { notConnected: true });
  return { sheetId: pc.pos_sheet_id, token: await getAccessToken(gc.google_refresh_token) };
}

export default async function handler(req, res) {
  const shopId = req.query.shopId || req.body?.shopId;
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });

  try {
    const { sheetId, token } = await getConfig(shopId);

    // ตรวจว่ามี tab "รับสินค้า" ไหม (บัญชีเก่าอาจยังไม่มี)
    await ensureTabExists(token, sheetId, 'รับสินค้า', RECEIVE_HEADERS);

    // ── GET ─────────────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      const rows = await readSheet(token, sheetId, 'รับสินค้า!A:I');
      let receives = rows.slice(1)
        .map((r, i) => ({ ...rowToReceive(r), _row: i + 2 }))
        .filter(r => r.receive_no);

      // filter by date (YYYY-MM-DD)
      if (req.query.date) {
        receives = receives.filter(r => r.created_at.startsWith(req.query.date));
      }

      // filter by supplier (contact_id) — ใช้ดึงราคาซื้อล่าสุดต่อผู้จำหน่ายรายนี้
      if (req.query.supplierId) {
        receives = receives.filter(r => r.supplier_id === req.query.supplierId);
      }

      return res.json({ receives: receives.reverse() });
    }

    // ── POST ─────────────────────────────────────────────────────────────────
    if (req.method === 'POST') {
      const { supplierId = '', supplier = '', items = [], notes = '' } = req.body;
      if (!items.length) return res.status(400).json({ error: 'ต้องมีรายการสินค้าอย่างน้อย 1 รายการ' });

      // อ่านข้อมูลสินค้าทั้งหมดเพื่อคำนวณ weighted avg cost — ต้องอ่านเต็ม A:R (18 คอลัมน์)
      // ไม่ใช่แค่ A:J เพราะเดิมอ่าน/เขียนแค่ 10 คอลัมน์ทำให้ข้อมูล K-R (ประเภท, บาร์โค้ด,
      // รายละเอียด, VAT, สถานะ ฯลฯ) ของสินค้าถูกล้างทิ้งทุกครั้งที่รับสินค้าเข้า
      const prodRows = await readSheet(token, sheetId, 'สินค้า!A:R');
      const prodDataRows = prodRows.slice(1);

      const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
      const receiveNo = makeReceiveNo();
      let subtotal = 0;   // ยอดก่อน VAT (ต้นทุนถ่วงน้ำหนักของสินค้าคำนวณจากยอดนี้เสมอ)
      let vatTotal = 0;    // ยอด VAT รวมทั้งใบ

      // อัปเดตสต็อค + weighted avg cost ทีละสินค้า (ต้นทุนถ่วงน้ำหนักคำนวณจากฐานราคาก่อน VAT เสมอ)
      for (const item of items) {
        const { sku, qty, unitCost, vatType } = item;
        const numQty = parseFloat(qty) || 0;
        const numCost = parseFloat(unitCost) || 0;
        if (!sku || numQty <= 0) continue;

        const { base: unitBase, vat: unitVat } = splitVat(numCost, vatType);
        const lineSubtotal = numQty * unitBase;
        subtotal += lineSubtotal;
        vatTotal += numQty * unitVat;

        const idx = prodDataRows.findIndex(r => r[0] === sku);
        if (idx === -1) continue;

        const existing = [...prodDataRows[idx]];
        while (existing.length < 18) existing.push('');

        const oldStock = parseFloat(existing[5]) || 0;
        const oldAvgCost = parseFloat(existing[4]) || 0;
        const rawType = existing[10] || 'นับสต็อค';
        const prodType = rawType === 'ทั่วไป' ? 'นับสต็อค' : rawType;

        // Weighted average cost: (เก่า × ต้นทุนเก่า + ใหม่ × ต้นทุนใหม่ก่อน VAT) / (เก่า + ใหม่)
        const newStock = oldStock + numQty;
        const newAvgCost = newStock > 0
          ? (oldStock * oldAvgCost + numQty * unitBase) / newStock
          : unitBase;

        existing[4] = Math.round(newAvgCost * 100) / 100;  // col E: ราคาทุนเฉลี่ย
        existing[5] = newStock;                              // col F: สต็อค
        existing[9] = now;                                   // col J: วันที่อัปเดต

        // สินค้าหมุนเวียน: รับสินค้าเข้า = ได้ของที่รีฟิล/บรรจุกลับมาแล้ว ต้องหักออกจาก
        // "เปล่ารอรีฟิล" ด้วยเสมอ (เดิมเพิ่มแค่ "เต็ม" อย่างเดียว เปล่าค้างไม่ลดลงเลย)
        if (prodType === 'หมุนเวียน') {
          existing[12] = Math.max(0, (parseFloat(existing[12]) || 0) - numQty);
        }

        await updateSheetRow(token, sheetId, 'สินค้า', idx + 2, existing);

        // อัปเดต cache ใน memory ด้วยเพื่อการ loop ถัดไปถูกต้อง
        prodDataRows[idx] = existing;
      }

      const roundedSubtotal = Math.round(subtotal * 100) / 100;
      const roundedVat = Math.round(vatTotal * 100) / 100;
      const grandTotal = Math.round((subtotal + vatTotal) * 100) / 100;

      // บันทึกใบรับสินค้าลง tab "รับสินค้า"
      await appendSheet(token, sheetId, 'รับสินค้า', [
        receiveNo,
        now,
        supplier,
        JSON.stringify(items.map(i => {
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
        })),
        grandTotal,
        notes,
        supplierId,
        roundedSubtotal,
        roundedVat,
      ]);

      return res.json({ ok: true, receiveNo, subtotal: roundedSubtotal, vatTotal: roundedVat, totalCost: grandTotal, itemCount: items.length });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('[pos/receives]', err.message);
    if (err.notSetup) return res.status(400).json({ error: err.message, notSetup: true });
    if (err.notConnected) return res.status(400).json({ error: err.message, notConnected: true });
    return res.status(500).json({ error: err.message });
  }
}
