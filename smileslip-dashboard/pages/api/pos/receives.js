/**
 * GET  /api/pos/receives?shopId&date  → ประวัติรับสินค้า
 * POST /api/pos/receives { shopId, supplier, items:[{sku,name,qty,unitCost,unit}], notes }
 *   → บันทึกการรับสินค้า + อัปเดตสต็อค + คำนวณ weighted average cost ทุกรายการ
 *
 * เก็บใน Google Sheets tab "รับสินค้า" (PDPA compliant)
 */
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
      const rows = await readSheet(token, sheetId, 'รับสินค้า!A:F');
      let receives = rows.slice(1)
        .map((r, i) => ({ ...rowToReceive(r), _row: i + 2 }))
        .filter(r => r.receive_no);

      // filter by date (YYYY-MM-DD)
      if (req.query.date) {
        receives = receives.filter(r => r.created_at.startsWith(req.query.date));
      }

      return res.json({ receives: receives.reverse() });
    }

    // ── POST ─────────────────────────────────────────────────────────────────
    if (req.method === 'POST') {
      const { supplier = '', items = [], notes = '' } = req.body;
      if (!items.length) return res.status(400).json({ error: 'ต้องมีรายการสินค้าอย่างน้อย 1 รายการ' });

      // อ่านข้อมูลสินค้าทั้งหมดเพื่อคำนวณ weighted avg cost — ต้องอ่านเต็ม A:R (18 คอลัมน์)
      // ไม่ใช่แค่ A:J เพราะเดิมอ่าน/เขียนแค่ 10 คอลัมน์ทำให้ข้อมูล K-R (ประเภท, บาร์โค้ด,
      // รายละเอียด, VAT, สถานะ ฯลฯ) ของสินค้าถูกล้างทิ้งทุกครั้งที่รับสินค้าเข้า
      const prodRows = await readSheet(token, sheetId, 'สินค้า!A:R');
      const prodDataRows = prodRows.slice(1);

      const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
      const receiveNo = makeReceiveNo();
      let totalCost = 0;

      // อัปเดตสต็อค + weighted avg cost ทีละสินค้า
      for (const item of items) {
        const { sku, qty, unitCost } = item;
        const numQty = parseFloat(qty) || 0;
        const numCost = parseFloat(unitCost) || 0;
        if (!sku || numQty <= 0) continue;

        totalCost += numQty * numCost;

        const idx = prodDataRows.findIndex(r => r[0] === sku);
        if (idx === -1) continue;

        const existing = [...prodDataRows[idx]];
        while (existing.length < 18) existing.push('');

        const oldStock = parseFloat(existing[5]) || 0;
        const oldAvgCost = parseFloat(existing[4]) || 0;

        // Weighted average cost: (เก่า × ต้นทุนเก่า + ใหม่ × ต้นทุนใหม่) / (เก่า + ใหม่)
        const newStock = oldStock + numQty;
        const newAvgCost = newStock > 0
          ? (oldStock * oldAvgCost + numQty * numCost) / newStock
          : numCost;

        existing[4] = Math.round(newAvgCost * 100) / 100;  // col E: ราคาทุนเฉลี่ย
        existing[5] = newStock;                              // col F: สต็อค
        existing[9] = now;                                   // col J: วันที่อัปเดต

        await updateSheetRow(token, sheetId, 'สินค้า', idx + 2, existing);

        // อัปเดต cache ใน memory ด้วยเพื่อการ loop ถัดไปถูกต้อง
        prodDataRows[idx] = existing;
      }

      // บันทึกใบรับสินค้าลง tab "รับสินค้า"
      await appendSheet(token, sheetId, 'รับสินค้า', [
        receiveNo,
        now,
        supplier,
        JSON.stringify(items.map(i => ({
          sku: i.sku, name: i.name, qty: parseFloat(i.qty) || 0,
          unit: i.unit || '', unitCost: parseFloat(i.unitCost) || 0,
        }))),
        Math.round(totalCost * 100) / 100,
        notes,
      ]);

      return res.json({ ok: true, receiveNo, totalCost, itemCount: items.length });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('[pos/receives]', err.message);
    if (err.notSetup) return res.status(400).json({ error: err.message, notSetup: true });
    if (err.notConnected) return res.status(400).json({ error: err.message, notConnected: true });
    return res.status(500).json({ error: err.message });
  }
}
