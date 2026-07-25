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
import { blockIfTrialExpired } from '../../../lib/shop-access';
import { hasFeature, upgradeMessage } from '../../../lib/tier-features';
import { requirePermission } from '../../../lib/pos-auth';
import {
  getAccessToken, readSheet, appendSheet, appendRows, updateSheetRow,
  makeSKU, rowToProduct,
} from '../../../lib/google-pos';
import { dualWrite, insertRow, insertRows, updateRow, softDeleteRow } from '../../../lib/supabase-pos';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

// บังคับให้ Google Sheets เก็บ "วันที่อัปเดต" เป็นข้อความล้วน ไม่ auto-parse ปี พ.ศ. เป็น ค.ศ.
// ตรงๆ จนเพี้ยนไป ~543 ปี (บั๊กเดียวกับที่เจอซ้ำหลายจุดในโปรเจกต์นี้ — ไฟล์นี้ไม่เคยแก้มาก่อน
// เพิ่งเจอตอนสร้างฟีเจอร์นำเข้าสินค้าเป็นชุด ซึ่งจะเขียนคอลัมน์นี้ซ้ำหลายร้อยแถวถ้าไม่แก้ก่อน)
function asText(v) {
  if (v === '' || v == null) return v;
  return `'${v}`;
}

async function getConfig(shopId) {
  const [{ data: pc }, { data: gc }, { data: sp }] = await Promise.all([
    supabase.from('pos_configs').select('pos_sheet_id').eq('shop_id', shopId).single(),
    supabase.from('shop_google_configs').select('google_refresh_token').eq('shop_id', shopId).single(),
    supabase.from('shop_profiles').select('subscription_tier').eq('id', shopId).maybeSingle(),
  ]);
  if (!pc?.pos_sheet_id) throw Object.assign(new Error('ยังไม่ได้ตั้งค่า POS'), { notSetup: true });
  if (!gc?.google_refresh_token) throw Object.assign(new Error('ยังไม่ได้เชื่อมต่อ Google'), { notConnected: true });
  return { sheetId: pc.pos_sheet_id, tier: sp?.subscription_tier || 'normal', token: await getAccessToken(gc.google_refresh_token) };
}

export default async function handler(req, res) {
  const shopId = req.query.shopId || req.body?.shopId;
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });

  // เขียนไม่ได้ถ้าทดลองใช้ 30 วันหมดอายุแล้ว (อ่าน/GET ยังทำได้ปกติเสมอ)
  if (req.method !== 'GET' && (await blockIfTrialExpired(req, res, shopId))) return;


  try {
    const { sheetId, tier, token } = await getConfig(shopId);

    // ── GET ──────────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      const rows = await readSheet(token, sheetId, 'สินค้า!A:T');
      let products = rows.slice(1)
        .map((r, i) => ({ ...rowToProduct(r), _row: i + 2 }))
        .filter(p => p.sku && p.name);

      // ถ้าไม่ระบุ showInactive ให้คืนเฉพาะสินค้าที่ active (is_active = true)
      if (!req.query.showInactive) products = products.filter(p => p.is_active !== false);

      if (req.query.category) products = products.filter(p => p.category === req.query.category);
      // สาขาที่ขาย — ว่าง (branches.length===0) = ขายได้ทุกสาขา เสมอ
      if (req.query.branch) products = products.filter(p => p.branches.length === 0 || p.branches.includes(req.query.branch));
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

    // ── POST (bulk import — นำเข้าสินค้าจาก CSV จำนวนมากในคำขอเดียว) ────────
    // ต่างจากเพิ่มทีละตัว: รับ shopId + products (array) แทน ยิง append เป็นก้อนใหญ่ผ่าน
    // appendRows() ไม่ใช่ทีละแถว กัน rate limit ของ Google เวลานำเข้าเป็นร้อย/พันรายการ
    // (pattern เดียวกับ bulk import ของผู้ติดต่อใน contacts.js) — ทุกรายการที่นำเข้าเป็น
    // ประเภท "นับสต็อค" เสมอ (ไม่รองรับตั้ง "หมุนเวียน" ผ่านการนำเข้าเป็นชุด ผู้ใช้แก้เองทีหลัง
    // ได้ถ้าต้องการ เพราะสินค้าหมุนเวียนมีผลข้างเคียงเรื่องแลกเปลี่ยน/ยืมที่ละเอียดอ่อนกว่า)
    if (req.method === 'POST' && Array.isArray(req.body.products)) {
      const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
      const validProducts = req.body.products.filter(p => p?.name);
      const skus = validProducts.map(() => makeSKU());
      // รหัสสินค้า/บาร์โค้ดที่ขึ้นต้นด้วย 0 (พบได้ทั่วไปในบาร์โค้ด EAN-13) ต้องผ่าน asText() ใน
      // แถวที่เขียนลง Sheets เสมอ (Postgres ใน supaRows ด้านล่างไม่ต้อง — ไม่มีปัญหา auto-parse นี้)
      const rows = validProducts.map((p, i) => [
        skus[i], p.name, p.category || '',
        Math.max(0, parseFloat(p.price) || 0), Math.max(0, parseFloat(p.cost) || 0),
        Math.max(0, parseFloat(p.stock) || 0), p.unit || 'ชิ้น', p.aliases || '', p.notes || '', asText(now),
        'นับสต็อค', 0, 0,
        asText(p.product_code || ''), asText(p.barcode || ''), p.description || '',
        p.vat_type || 'ไม่มี VAT', '1', 0, '',
      ]);
      const supaRows = validProducts.map((p, i) => ({
        shop_id: shopId, sku: skus[i], name: p.name, category: p.category || '',
        price: Math.max(0, parseFloat(p.price) || 0), cost: Math.max(0, parseFloat(p.cost) || 0),
        stock: Math.max(0, parseFloat(p.stock) || 0), unit: p.unit || 'ชิ้น', aliases: p.aliases || '',
        notes: p.notes || '', product_updated_at: now, type: 'นับสต็อค', at_customer: 0, empty_waiting: 0,
        product_code: p.product_code || '', barcode: p.barcode || '', description: p.description || '',
        vat_type: p.vat_type || 'ไม่มี VAT', is_active: true, empty_ceiling: 0, branches: '',
      }));

      const CHUNK = 500;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const sheetChunk = rows.slice(i, i + CHUNK);
        const supaChunk = supaRows.slice(i, i + CHUNK);
        await dualWrite({
          label: 'products-bulk-import',
          primary: () => appendRows(token, sheetId, 'สินค้า', sheetChunk),
          secondary: () => insertRows('pos_products', supaChunk),
        });
      }
      return res.json({ ok: true, imported: rows.length });
    }

    // ── POST (เพิ่มสินค้าใหม่) ────────────────────────────────────────────
    if (req.method === 'POST') {
      const {
        name, category = '', price = 0, cost = 0, stock = 0,
        unit = 'ชิ้น', aliases = '', notes = '',
        type = 'นับสต็อค',
        product_code = '', barcode = '', description = '',
        vat_type = 'ไม่มี VAT', is_active = true, empty_ceiling = 0, branches = [],
      } = req.body;
      if (!name) return res.status(400).json({ error: 'ต้องระบุชื่อสินค้า' });
      // ราคา/ทุน/สต็อคติดลบตั้งแต่สร้างสินค้าจะไหลไปกระทบทุกจุดที่ใช้ข้อมูลนี้ต่อ (ขาย/รายงาน/VAT)
      if (parseFloat(price) < 0) return res.status(400).json({ error: 'ราคาขายต้องไม่ติดลบ' });
      if (parseFloat(cost) < 0) return res.status(400).json({ error: 'ราคาทุนต้องไม่ติดลบ' });
      if (parseFloat(stock) < 0) return res.status(400).json({ error: 'จำนวนสต็อคต้องไม่ติดลบ' });
      if (type === 'หมุนเวียน' && !hasFeature(tier, 'cyclical_stock')) {
        return res.status(403).json({ error: upgradeMessage('cyclical_stock'), featureLocked: true });
      }

      const sku = makeSKU();
      const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
      const branchesStr = Array.isArray(branches) ? branches.join(',') : '';
      // รหัสสินค้า/บาร์โค้ดที่ขึ้นต้นด้วย 0 (พบได้ทั่วไปในบาร์โค้ด EAN-13) ต้องผ่าน asText() ตั้งแต่
      // สร้างสินค้าเลยในแถว Sheets ไม่งั้นถูกตีความเป็นตัวเลขแล้วตัด 0 นำหน้าทิ้งตั้งแต่แถวแรกที่เขียน
      // (Postgres ใน secondary write ด้านล่างไม่ต้อง asText — ไม่มีปัญหา auto-parse นี้)
      await dualWrite({
        label: 'products-create',
        primary: () => appendSheet(token, sheetId, 'สินค้า', [
          sku, name, category, price, cost, stock, unit, aliases, notes, asText(now),
          type, 0, 0,
          asText(product_code), asText(barcode), description, vat_type, is_active ? '1' : '0', empty_ceiling || 0,
          branchesStr,
        ]),
        secondary: () => insertRow('pos_products', {
          shop_id: shopId, sku, name, category, price, cost, stock, unit, aliases, notes,
          product_updated_at: now, type, at_customer: 0, empty_waiting: 0,
          product_code, barcode, description, vat_type, is_active: !!is_active,
          empty_ceiling: empty_ceiling || 0, branches: branchesStr,
        }),
      });
      return res.json({ ok: true, sku, name });
    }

    // ── PATCH (แก้ไข / อัปเดตสต็อค / actions หมุนเวียน) ─────────────────
    if (req.method === 'PATCH') {
      // เรียกจากหน้าพนักงาน (pos-staff.js/แคชเชียร์ แนบ x-staff-session มาด้วย) — ต้องมีสิทธิ์
      // "จัดการสต็อก" ถึงจะแก้ได้ (ตรวจสอบผ่าน session ที่เซ็นชื่อ ไม่ใช่ staffId เปล่าๆ ที่ปลอมได้
      // แบบเดิมอีกต่อไป) — เจ้าของร้าน/แอดมิน (pos.js เรียกตรง ไม่มี session) ไม่ถูกกระทบเลย
      if (!(await requirePermission(req, res, token, sheetId, 'perm_manage_stock'))) return;

      const { sku, action, qty, stockDelta, ...updates } = req.body;
      if (!sku) return res.status(400).json({ error: 'Missing sku' });
      if (updates.price !== undefined && parseFloat(updates.price) < 0) {
        return res.status(400).json({ error: 'ราคาขายต้องไม่ติดลบ' });
      }
      if (updates.cost !== undefined && parseFloat(updates.cost) < 0) {
        return res.status(400).json({ error: 'ราคาทุนต้องไม่ติดลบ' });
      }
      if (updates.stock !== undefined && parseFloat(updates.stock) < 0) {
        return res.status(400).json({ error: 'จำนวนสต็อคต้องไม่ติดลบ' });
      }

      const rows = await readSheet(token, sheetId, 'สินค้า!A:T');
      const dataRows = rows.slice(1);
      const idx = dataRows.findIndex(r => r[0] === sku);
      if (idx === -1) return res.status(404).json({ error: `ไม่พบสินค้า ${sku}` });

      const existing = [...dataRows[idx]];
      while (existing.length < 20) existing.push('');

      // บล็อคเฉพาะตอน "เปลี่ยนประเภทเป็นหมุนเวียนใหม่" (จากประเภทอื่น) — สินค้าที่เป็นหมุนเวียนอยู่แล้ว
      // (สร้างไว้ตั้งแต่ก่อนถูกล็อค/ตอน tier สูงกว่า) แก้ไขฟิลด์อื่นได้ตามปกติไม่ถูกบล็อค
      if (updates.type === 'หมุนเวียน' && existing[10] !== 'หมุนเวียน' && !hasFeature(tier, 'cyclical_stock')) {
        return res.status(403).json({ error: upgradeMessage('cyclical_stock'), featureLocked: true });
      }

      const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });

      // action: รับถังเปล่าคืนจากลูกค้า
      if (action === 'receive-back') {
        const newAtCustomer = Math.max(0, (parseFloat(existing[11]) || 0) - qty);
        const newEmptyWaiting = (parseFloat(existing[12]) || 0) + qty;
        existing[11] = newAtCustomer;
        existing[12] = newEmptyWaiting;
        existing[9]  = asText(now);
        // รหัสสินค้า/บาร์โค้ดที่ขึ้นต้นด้วย 0 (พบได้ทั่วไปในบาร์โค้ด EAN-13) ต้อง re-wrap ทุกครั้ง
        // ที่เขียนทั้งแถวกลับ ไม่ว่า action นี้จะแก้ไขฟิลด์นี้เองหรือไม่ — กันตัดเลข 0 นำหน้าทิ้ง
        existing[13] = asText(existing[13]);
        existing[14] = asText(existing[14]);
        await dualWrite({
          label: 'products-receive-back',
          primary: () => updateSheetRow(token, sheetId, 'สินค้า', idx + 2, existing),
          secondary: () => updateRow('pos_products', { shop_id: shopId, sku }, {
            at_customer: newAtCustomer, empty_waiting: newEmptyWaiting, product_updated_at: now,
          }),
        });
        return res.json({ ok: true });
      }

      // action: รีฟิลเสร็จ พร้อมขาย
      if (action === 'refill') {
        const newEmptyWaiting = Math.max(0, (parseFloat(existing[12]) || 0) - qty);
        const newStock = (parseFloat(existing[5]) || 0) + qty;
        existing[12] = newEmptyWaiting;
        existing[5]  = newStock;
        existing[9]  = asText(now);
        existing[13] = asText(existing[13]);
        existing[14] = asText(existing[14]);
        await dualWrite({
          label: 'products-refill',
          primary: () => updateSheetRow(token, sheetId, 'สินค้า', idx + 2, existing),
          secondary: () => updateRow('pos_products', { shop_id: shopId, sku }, {
            empty_waiting: newEmptyWaiting, stock: newStock, product_updated_at: now,
          }),
        });
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
      if (updates.branches      !== undefined) existing[19] = Array.isArray(updates.branches) ? updates.branches.join(',') : '';
      existing[9] = asText(now);
      // รหัสสินค้า/บาร์โค้ดที่ขึ้นต้นด้วย 0 ต้อง re-wrap ทุกครั้งไม่ว่า PATCH นี้จะแก้ฟิลด์นี้
      // หรือไม่ (เดิม assign ตรงๆ ไม่ผ่าน asText() เลยแม้ตอนแก้ในคำขอนี้ด้วย)
      existing[13] = asText(existing[13]);
      existing[14] = asText(existing[14]);

      // payload ฝั่ง Supabase สร้างจาก `updates`/`stockDelta` ดิบโดยตรง (ไม่ผ่าน existing[] ที่มี
      // asText() ฝังอยู่ในคอลัมน์วันที่) เหมือน pattern ที่ใช้ใน contacts.js
      const supaUpdates = { product_updated_at: now };
      if (updates.name          !== undefined) supaUpdates.name = updates.name;
      if (updates.category      !== undefined) supaUpdates.category = updates.category;
      if (updates.price         !== undefined) supaUpdates.price = updates.price;
      if (updates.cost          !== undefined) supaUpdates.cost = updates.cost;
      if (updates.stock         !== undefined) supaUpdates.stock = updates.stock;
      if (stockDelta            !== undefined) supaUpdates.stock = parseFloat(existing[5]) || 0;
      if (updates.unit          !== undefined) supaUpdates.unit = updates.unit;
      if (updates.aliases       !== undefined) supaUpdates.aliases = updates.aliases;
      if (updates.notes         !== undefined) supaUpdates.notes = updates.notes;
      if (updates.type          !== undefined) supaUpdates.type = updates.type;
      if (updates.at_customer   !== undefined) supaUpdates.at_customer = updates.at_customer;
      if (updates.empty_waiting !== undefined) supaUpdates.empty_waiting = updates.empty_waiting;
      if (updates.product_code  !== undefined) supaUpdates.product_code = updates.product_code;
      if (updates.barcode       !== undefined) supaUpdates.barcode = updates.barcode;
      if (updates.description   !== undefined) supaUpdates.description = updates.description;
      if (updates.vat_type      !== undefined) supaUpdates.vat_type = updates.vat_type;
      if (updates.is_active     !== undefined) supaUpdates.is_active = !!updates.is_active;
      if (updates.empty_ceiling !== undefined) supaUpdates.empty_ceiling = updates.empty_ceiling;
      if (updates.branches      !== undefined) supaUpdates.branches = Array.isArray(updates.branches) ? updates.branches.join(',') : '';

      await dualWrite({
        label: 'products-update',
        primary: () => updateSheetRow(token, sheetId, 'สินค้า', idx + 2, existing),
        secondary: () => updateRow('pos_products', { shop_id: shopId, sku }, supaUpdates),
      });
      return res.json({ ok: true, sku, stock: parseFloat(existing[5]) || 0 });
    }

    // ── DELETE ────────────────────────────────────────────────────────────
    if (req.method === 'DELETE') {
      const { sku } = req.body;
      if (!sku) return res.status(400).json({ error: 'Missing sku' });

      const rows = await readSheet(token, sheetId, 'สินค้า!A:T');
      const dataRows = rows.slice(1);
      const idx = dataRows.findIndex(r => r[0] === sku);
      if (idx === -1) return res.status(404).json({ error: `ไม่พบสินค้า ${sku}` });

      await dualWrite({
        label: 'products-delete',
        primary: () => updateSheetRow(token, sheetId, 'สินค้า', idx + 2, Array(20).fill('')),
        secondary: () => softDeleteRow('pos_products', { shop_id: shopId, sku }),
      });
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
