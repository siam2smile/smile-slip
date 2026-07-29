/**
 * GET    /api/pos/products?shopId&category&search  → รายการสินค้า
 * POST   /api/pos/products { shopId, name, ... }  → เพิ่มสินค้าใหม่
 * PATCH  /api/pos/products { shopId, sku, ... }   → แก้ไข / อัปเดตสต็อค
 *                                                    action: 'receive-back' → รับถังเปล่าคืน
 *                                                    action: 'refill'       → รีฟิลแล้วพร้อมขาย
 * DELETE /api/pos/products { shopId, sku }        → ลบสินค้า
 *
 * Phase 2 (write-primary flip, 2026-07-29): อ่าน/เขียนจาก Supabase (pos_products) โดยตรงแล้ว
 * ไม่ผ่าน Google Sheets/Google connection อีกต่อไป — จุดนี้คือ hot path หลักของ QR สั่งสินค้า/
 * การใช้งาน POS พร้อมกันจำนวนมาก ที่เป็นสาเหตุให้ตัด Sheets ออกทั้งโมดูล (rate limit)
 */
import { supabase } from '../../../lib/supabase-pos';
import { blockIfTrialExpired } from '../../../lib/shop-access';
import { hasFeature, upgradeMessage } from '../../../lib/tier-features';
import { requirePermission } from '../../../lib/pos-auth';
import { makeSKU, productFromRow } from '../../../lib/google-pos';

async function getTier(shopId) {
  const { data: sp } = await supabase.from('shop_profiles').select('subscription_tier').eq('id', shopId).maybeSingle();
  return sp?.subscription_tier || 'normal';
}

export default async function handler(req, res) {
  const shopId = req.query.shopId || req.body?.shopId;
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });

  // เขียนไม่ได้ถ้าทดลองใช้ 30 วันหมดอายุแล้ว (อ่าน/GET ยังทำได้ปกติเสมอ)
  if (req.method !== 'GET' && (await blockIfTrialExpired(req, res, shopId))) return;

  try {
    // ── GET ──────────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      const { data, error } = await supabase.from('pos_products').select('*')
        .eq('shop_id', shopId).is('deleted_at', null).order('created_at', { ascending: true });
      if (error) throw error;
      let products = (data || []).map(productFromRow).filter(p => p.sku && p.name);

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
    // ทุกรายการที่นำเข้าเป็นประเภท "นับสต็อค" เสมอ (ไม่รองรับตั้ง "หมุนเวียน" ผ่านการนำเข้าเป็นชุด
    // ผู้ใช้แก้เองทีหลังได้ถ้าต้องการ เพราะสินค้าหมุนเวียนมีผลข้างเคียงเรื่องแลกเปลี่ยน/ยืมที่ละเอียดอ่อนกว่า)
    if (req.method === 'POST' && Array.isArray(req.body.products)) {
      const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
      const validProducts = req.body.products.filter(p => p?.name);
      const supaRows = validProducts.map(p => ({
        shop_id: shopId, sku: makeSKU(), name: p.name, category: p.category || '',
        price: Math.max(0, parseFloat(p.price) || 0), cost: Math.max(0, parseFloat(p.cost) || 0),
        stock: Math.max(0, parseFloat(p.stock) || 0), unit: p.unit || 'ชิ้น', aliases: p.aliases || '',
        notes: p.notes || '', product_updated_at: now, type: 'นับสต็อค', at_customer: 0, empty_waiting: 0,
        product_code: p.product_code || '', barcode: p.barcode || '', description: p.description || '',
        vat_type: p.vat_type || 'ไม่มี VAT', is_active: true, empty_ceiling: 0, branches: '',
      }));

      const CHUNK = 500;
      for (let i = 0; i < supaRows.length; i += CHUNK) {
        const { error } = await supabase.from('pos_products').insert(supaRows.slice(i, i + CHUNK));
        if (error) throw error;
      }
      return res.json({ ok: true, imported: supaRows.length });
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

      const tier = await getTier(shopId);
      if (type === 'หมุนเวียน' && !hasFeature(tier, 'cyclical_stock')) {
        return res.status(403).json({ error: upgradeMessage('cyclical_stock'), featureLocked: true });
      }

      const sku = makeSKU();
      const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
      const branchesStr = Array.isArray(branches) ? branches.join(',') : '';
      const { error } = await supabase.from('pos_products').insert({
        shop_id: shopId, sku, name, category, price, cost, stock, unit, aliases, notes,
        product_updated_at: now, type, at_customer: 0, empty_waiting: 0,
        product_code, barcode, description, vat_type, is_active: !!is_active,
        empty_ceiling: empty_ceiling || 0, branches: branchesStr,
      });
      if (error) throw error;
      return res.json({ ok: true, sku, name });
    }

    // ── PATCH (แก้ไข / อัปเดตสต็อค / actions หมุนเวียน) ─────────────────
    if (req.method === 'PATCH') {
      // เรียกจากหน้าพนักงาน (pos-staff.js/แคชเชียร์ แนบ x-staff-session มาด้วย) — ต้องมีสิทธิ์
      // "จัดการสต็อก" ถึงจะแก้ได้ (ตรวจสอบผ่าน session ที่เซ็นชื่อ ไม่ใช่ staffId เปล่าๆ ที่ปลอมได้
      // แบบเดิมอีกต่อไป) — เจ้าของร้าน/แอดมิน (pos.js เรียกตรง ไม่มี session) ไม่ถูกกระทบเลย
      if (!(await requirePermission(req, res, shopId, 'perm_manage_stock'))) return;

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

      const { data: existing, error: fetchErr } = await supabase.from('pos_products').select('*')
        .eq('shop_id', shopId).eq('sku', sku).is('deleted_at', null).maybeSingle();
      if (fetchErr) throw fetchErr;
      if (!existing) return res.status(404).json({ error: `ไม่พบสินค้า ${sku}` });

      // บล็อคเฉพาะตอน "เปลี่ยนประเภทเป็นหมุนเวียนใหม่" (จากประเภทอื่น) — สินค้าที่เป็นหมุนเวียนอยู่แล้ว
      // (สร้างไว้ตั้งแต่ก่อนถูกล็อค/ตอน tier สูงกว่า) แก้ไขฟิลด์อื่นได้ตามปกติไม่ถูกบล็อค
      if (updates.type === 'หมุนเวียน' && existing.type !== 'หมุนเวียน') {
        const tier = await getTier(shopId);
        if (!hasFeature(tier, 'cyclical_stock')) {
          return res.status(403).json({ error: upgradeMessage('cyclical_stock'), featureLocked: true });
        }
      }

      const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });

      // action: รับถังเปล่าคืนจากลูกค้า
      if (action === 'receive-back') {
        const newAtCustomer = Math.max(0, (parseFloat(existing.at_customer) || 0) - qty);
        const newEmptyWaiting = (parseFloat(existing.empty_waiting) || 0) + qty;
        const { error } = await supabase.from('pos_products').update({
          at_customer: newAtCustomer, empty_waiting: newEmptyWaiting, product_updated_at: now,
        }).eq('shop_id', shopId).eq('sku', sku);
        if (error) throw error;
        return res.json({ ok: true });
      }

      // action: รีฟิลเสร็จ พร้อมขาย
      if (action === 'refill') {
        const newEmptyWaiting = Math.max(0, (parseFloat(existing.empty_waiting) || 0) - qty);
        const newStock = (parseFloat(existing.stock) || 0) + qty;
        const { error } = await supabase.from('pos_products').update({
          empty_waiting: newEmptyWaiting, stock: newStock, product_updated_at: now,
        }).eq('shop_id', shopId).eq('sku', sku);
        if (error) throw error;
        return res.json({ ok: true });
      }

      // generic patch
      const supaUpdates = { product_updated_at: now };
      if (updates.name          !== undefined) supaUpdates.name = updates.name;
      if (updates.category      !== undefined) supaUpdates.category = updates.category;
      if (updates.price         !== undefined) supaUpdates.price = updates.price;
      if (updates.cost          !== undefined) supaUpdates.cost = updates.cost;
      if (updates.stock         !== undefined) supaUpdates.stock = updates.stock;
      if (stockDelta            !== undefined) supaUpdates.stock = (parseFloat(existing.stock) || 0) + stockDelta;
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

      const { error } = await supabase.from('pos_products').update(supaUpdates)
        .eq('shop_id', shopId).eq('sku', sku);
      if (error) throw error;
      return res.json({ ok: true, sku, stock: supaUpdates.stock !== undefined ? supaUpdates.stock : (parseFloat(existing.stock) || 0) });
    }

    // ── DELETE ────────────────────────────────────────────────────────────
    if (req.method === 'DELETE') {
      const { sku } = req.body;
      if (!sku) return res.status(400).json({ error: 'Missing sku' });

      const { data: existing, error: fetchErr } = await supabase.from('pos_products').select('sku')
        .eq('shop_id', shopId).eq('sku', sku).is('deleted_at', null).maybeSingle();
      if (fetchErr) throw fetchErr;
      if (!existing) return res.status(404).json({ error: `ไม่พบสินค้า ${sku}` });

      const { error } = await supabase.from('pos_products')
        .update({ deleted_at: new Date().toISOString() })
        .eq('shop_id', shopId).eq('sku', sku);
      if (error) throw error;
      return res.json({ ok: true, sku });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('[pos/products]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
