/**
 * GET    /api/pos/products?shopId&category&search  → รายการสินค้า
 * POST   /api/pos/products { shopId, name, ... }  → เพิ่มสินค้าใหม่
 * PATCH  /api/pos/products { shopId, sku, ... }   → แก้ไข / อัปเดตสต็อค
 *                                                    action: 'receive-back' → รับถังเปล่าคืน
 *                                                    action: 'refill'       → รีฟิลแล้วพร้อมขาย
 * DELETE /api/pos/products { shopId, sku }        → ลบสินค้า
 *
 * Schema 18 columns A-R (เพิ่ม 2026-07-06: product_code, barcode, description, vat_type, is_active)
 */
import { createClient } from '@supabase/supabase-js';
import {
  getAccessToken, readSheet, appendSheet, updateSheetRow,
  makeSKU, rowToProduct,
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

    // ── GET ──────────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      const rows = await readSheet(token, sheetId, 'สินค้า!A:S');
      let products = rows.slice(1)
        .map((r, i) => ({ ...rowToProduct(r), _row: i + 2 }))
        .filter(p => p.sku && p.name);

      // ถ้าไม่ระบุ showInactive ให้คืนเฉพาะสินค้าที่ active (is_active = true)
      if (!req.query.showInactive) products = products.filter(p => p.is_active !== false);

      if (req.query.category) products = products.filter(p => p.category === req.query.category);
      if (req.query.search) {
        const q = req.query.search.toLowerCase();
        products = products.filter(p =>
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          p.aliases.toLowerCase().includes(q) ||
          (p.product_code || '').toLowerCase().includes(q) ||
          (p.barcode || '').toLowerCase().includes(q)
        );
      }

      return res.json({ products });
    }

    // ── POST (เพิ่มสินค้าใหม่) ────────────────────────────────────────────
    if (req.method === 'POST') {
      const {
        name, category = '', price = 0, cost = 0, stock = 0,
        unit = 'ชิ้น', aliases = '', notes = '',
        type = 'นับสต็อค',
        product_code = '', barcode = '', description = '',
        vat_type = 'ไม่มี VAT', is_active = true, empty_ceiling = 0,
      } = req.body;
      if (!name) return res.status(400).json({ error: 'ต้องระบุชื่อสินค้า' });

      const sku = makeSKU();
      const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
      await appendSheet(token, sheetId, 'สินค้า', [
        sku, name, category, price, cost, stock, unit, aliases, notes, now,
        type, 0, 0,
        product_code, barcode, description, vat_type, is_active ? '1' : '0', empty_ceiling || 0,
      ]);
      return res.json({ ok: true, sku, name });
    }

    // ── PATCH (แก้ไข / อัปเดตสต็อค / actions หมุนเวียน) ─────────────────
    if (req.method === 'PATCH') {
      const { sku, action, qty, stockDelta, ...updates } = req.body;
      if (!sku) return res.status(400).json({ error: 'Missing sku' });

      const rows = await readSheet(token, sheetId, 'สินค้า!A:S');
      const dataRows = rows.slice(1);
      const idx = dataRows.findIndex(r => r[0] === sku);
      if (idx === -1) return res.status(404).json({ error: `ไม่พบสินค้า ${sku}` });

      const existing = [...dataRows[idx]];
      while (existing.length < 19) existing.push('');

      const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });

      // action: รับถังเปล่าคืนจากลูกค้า
      if (action === 'receive-back') {
        existing[11] = Math.max(0, (parseFloat(existing[11]) || 0) - qty);
        existing[12] = (parseFloat(existing[12]) || 0) + qty;
        existing[9]  = now;
        await updateSheetRow(token, sheetId, 'สินค้า', idx + 2, existing);
        return res.json({ ok: true });
      }

      // action: รีฟิลเสร็จ พร้อมขาย
      if (action === 'refill') {
        existing[12] = Math.max(0, (parseFloat(existing[12]) || 0) - qty);
        existing[5]  = (parseFloat(existing[5]) || 0) + qty;
        existing[9]  = now;
        await updateSheetRow(token, sheetId, 'สินค้า', idx + 2, existing);
        return res.json({ ok: true });
      }

      // generic patch
      if (updates.name          !== undefined) existing[1]  = updates.name;
      if (updates.category      !== undefined) existing[2]  = updates.category;
      if (updates.price         !== undefined) existing[3]  = updates.price;
      if (updates.cost          !== undefined) existing[4]  = updates.cost;
      if (updates.stock         !== undefined) existing[5]  = updates.stock;
      if (stockDelta            !== undefined) existing[5]  = (parseFloat(existing[5]) || 0) + stockDelta;
      if (updates.unit          !== undefined) existing[6]  = updates.unit;
      if (updates.aliases       !== undefined) existing[7]  = updates.aliases;
      if (updates.notes         !== undefined) existing[8]  = updates.notes;
      if (updates.type          !== undefined) existing[10] = updates.type;
      if (updates.at_customer   !== undefined) existing[11] = updates.at_customer;
      if (updates.empty_waiting !== undefined) existing[12] = updates.empty_waiting;
      if (updates.product_code  !== undefined) existing[13] = updates.product_code;
      if (updates.barcode       !== undefined) existing[14] = updates.barcode;
      if (updates.description   !== undefined) existing[15] = updates.description;
      if (updates.vat_type      !== undefined) existing[16] = updates.vat_type;
      if (updates.is_active     !== undefined) existing[17] = updates.is_active ? '1' : '0';
      if (updates.empty_ceiling !== undefined) existing[18] = updates.empty_ceiling;
      existing[9] = now;

      await updateSheetRow(token, sheetId, 'สินค้า', idx + 2, existing);
      return res.json({ ok: true, sku, stock: parseFloat(existing[5]) || 0 });
    }

    // ── DELETE ────────────────────────────────────────────────────────────
    if (req.method === 'DELETE') {
      const { sku } = req.body;
      if (!sku) return res.status(400).json({ error: 'Missing sku' });

      const rows = await readSheet(token, sheetId, 'สินค้า!A:S');
      const dataRows = rows.slice(1);
      const idx = dataRows.findIndex(r => r[0] === sku);
      if (idx === -1) return res.status(404).json({ error: `ไม่พบสินค้า ${sku}` });

      await updateSheetRow(token, sheetId, 'สินค้า', idx + 2, Array(19).fill(''));
      return res.json({ ok: true, sku });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('[pos/products]', err.message);
    if (err.notSetup) return res.status(400).json({ error: err.message, notSetup: true });
    if (err.notConnected) return res.status(400).json({ error: err.message, notConnected: true });
    return res.status(500).json({ error: err.message });
  }
}
