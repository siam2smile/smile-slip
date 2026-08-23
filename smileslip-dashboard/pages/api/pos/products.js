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
import { getBranchStock, adjustBranchStock, getBranchStockMap } from '../../../lib/pos-stock';

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
      // Supabase/PostgREST คืนสูงสุด 1,000 แถวต่อ query เสมอ (default db-max-rows) — ร้านที่มี
      // สินค้าเกิน 1,000 SKU (เช่น นำเข้าแคตตาล็อกใหญ่ผ่าน Excel/CSV) จะเห็นรายการไม่ครบเงียบๆ
      // ถ้าไม่ paginate เอง (เจอบั๊กเดียวกันจริงกับ contacts.js — ผู้ติดต่อ 2,121 คน เห็นแค่ 1,000)
      const PAGE = 1000;
      let data = [];
      for (let from = 0; ; from += PAGE) {
        // .order('created_at') อย่างเดียวไม่พอ — เจอบั๊กจริงในไฟล์ contacts.js (แถวที่ created_at
        // ตรงกันเป๊ะจากการนำเข้าทีเดียวทำให้ .range() ข้ามหน้าแบบไม่แน่นอน) แก้ไว้ล่วงหน้าเผื่อร้าน
        // ที่นำเข้าสินค้าทีละมากๆ (เช่น import Excel) เจอปัญหาเดียวกัน — เพิ่ม order ตาม id (unique เสมอ)
        const { data: page, error } = await supabase.from('pos_products').select('*')
          .eq('shop_id', shopId).is('deleted_at', null)
          .order('created_at', { ascending: true }).order('id', { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        data = data.concat(page || []);
        if (!page || page.length < PAGE) break;
      }
      let products = data.map(productFromRow).filter(p => p.sku && p.name);

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

      // โอนย้ายสต็อกข้ามสาขา Phase 3 — `branchStock` (ค่าว่างก็ใช้ได้ = กองกลาง) แทนที่
      // stock/at_customer/empty_waiting ในผลลัพธ์ด้วยตัวเลขของสาขานั้นโดยเฉพาะ (จาก
      // pos_product_stock) แทนยอดรวมทั้งร้าน — ใช้สำหรับหน้าจัดการสต็อกของพนักงาน
      // (pos-staff.js) ที่ต้องแก้/ดูเฉพาะสาขาตัวเองเท่านั้น ไม่กระทบ caller เดิมที่ไม่ส่ง
      // param นี้มา (ยังได้ยอดรวมทั้งร้านเหมือนเดิมทุกประการ)
      if (req.query.branchStock !== undefined && products.length > 0) {
        const branchMap = await getBranchStockMap(shopId, req.query.branchStock);
        products = products.map(p => {
          const b = branchMap.get(p.sku);
          return {
            ...p,
            shop_total_stock: p.stock,
            stock: b ? b.qty : 0,
            at_customer: b ? b.at_customer : 0,
            empty_waiting: b ? b.empty_waiting : 0,
          };
        });
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

      // โอนย้ายสต็อกข้ามสาขา Phase 1: สินค้าที่นำเข้าใหม่ทุกตัวต้องมีแถวใน pos_product_stock ด้วย
      // ไม่งั้น cache (pos_products.stock) จะถูกรีเซ็ตเป็น 0 เงียบๆ ตอนมีการเขียนสต็อกแบบแยกสาขา
      // ครั้งแรกของ SKU นั้น (adjustBranchStock อ่าน pos_product_stock เป็นความจริง ไม่ใช่ pos_products)
      // — ไม่มี branch ที่ระบุตอนนำเข้าเป็นชุด (ไม่มี UI เลือกสาขา) จึงลงกองกลาง/ไม่ระบุสาขา ('')
      const stockSeedRows = supaRows.filter(r => r.stock > 0).map(r => ({
        shop_id: shopId, sku: r.sku, branch_name: '', qty: r.stock, at_customer: 0, empty_waiting: 0,
      }));
      for (let i = 0; i < stockSeedRows.length; i += CHUNK) {
        const { error } = await supabase.from('pos_product_stock').insert(stockSeedRows.slice(i, i + CHUNK));
        if (error) console.error('[pos/products] bulk import: seed pos_product_stock failed:', error.message);
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
        branch = '', // สาขาที่กำลังทำงานอยู่ตอนสร้างสินค้า (selectedBranch) — ใช้ seed สต็อกเริ่มต้นเท่านั้น
        loyalty_baht_per_point,
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

      // loyalty_baht_per_point — คอลัมน์ใหม่ (ข้อ 102) แยกเขียนต่างหากกันพังการสร้างสินค้าหลัก
      // ถ้ายังไม่ได้รัน SQL เพิ่มคอลัมน์
      if (loyalty_baht_per_point !== undefined && loyalty_baht_per_point !== null && loyalty_baht_per_point !== '') {
        try {
          await supabase.from('pos_products').update({ loyalty_baht_per_point: parseFloat(loyalty_baht_per_point) || null }).eq('shop_id', shopId).eq('sku', sku);
        } catch (lpErr) {
          console.error('[pos/products] set loyalty_baht_per_point on create failed (non-fatal):', lpErr.message);
        }
      }

      // โอนย้ายสต็อกข้ามสาขา Phase 1: seed pos_product_stock ให้สินค้าใหม่ทันที (กันเหตุผลเดียวกับ
      // bulk import ด้านบน — ไม่งั้น cache จะถูกรีเซ็ตเป็น 0 เงียบๆ ตอนมีการเขียนสต็อกแบบแยกสาขาครั้งแรก)
      const initialStock = parseFloat(stock) || 0;
      if (initialStock > 0) {
        try {
          await adjustBranchStock(shopId, sku, branch, { qtyDelta: initialStock });
        } catch (seedErr) {
          console.error('[pos/products] seed pos_product_stock on create failed:', seedErr.message);
        }
      }

      return res.json({ ok: true, sku, name });
    }

    // ── PATCH (แก้ไข / อัปเดตสต็อค / actions หมุนเวียน) ─────────────────
    if (req.method === 'PATCH' && Array.isArray(req.body.bulkOnlineVisibility)) {
      // ข้อ 94 — ติ๊กเลือกหลายสินค้าพร้อมกันว่าจะแสดง/ซ่อนในหน้าสั่งซื้อออนไลน์ (order.js) แล้วยืนยันทีเดียว
      // (แทนที่จะต้องเปิดฟอร์มแก้ไขทีละตัว) — เจ้าของร้าน/แอดมินเท่านั้น (เหมือน PATCH เดี่ยวด้านล่าง)
      if (!(await requirePermission(req, res, shopId, 'perm_manage_stock'))) return;

      const items = req.body.bulkOnlineVisibility.filter(x => x?.sku);
      let updated = 0;
      for (const item of items) {
        const { error } = await supabase.from('pos_products')
          .update({ online_order_visible: !!item.online_order_visible })
          .eq('shop_id', shopId).eq('sku', item.sku).is('deleted_at', null);
        if (!error) updated++;
      }
      return res.json({ ok: true, updated, requested: items.length });
    }

    if (req.method === 'PATCH') {
      // เรียกจากหน้าพนักงาน (pos-staff.js/แคชเชียร์ แนบ x-staff-session มาด้วย) — ต้องมีสิทธิ์
      // "จัดการสต็อก" ถึงจะแก้ได้ (ตรวจสอบผ่าน session ที่เซ็นชื่อ ไม่ใช่ staffId เปล่าๆ ที่ปลอมได้
      // แบบเดิมอีกต่อไป) — เจ้าของร้าน/แอดมิน (pos.js เรียกตรง ไม่มี session) ไม่ถูกกระทบเลย
      if (!(await requirePermission(req, res, shopId, 'perm_manage_stock'))) return;

      const { sku, action, qty, stockDelta, branch = '', ...updates } = req.body;
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

      // action: รับถังเปล่าคืนจากลูกค้า — โอนย้ายสต็อกข้ามสาขา Phase 1: แยกตามสาขาที่รับคืน (branch)
      if (action === 'receive-back') {
        const q = parseFloat(qty) || 0;
        const { shopTotals } = await adjustBranchStock(shopId, sku, branch, { atCustomerDelta: -q, emptyWaitingDelta: q });
        await supabase.from('pos_products').update({ product_updated_at: now }).eq('shop_id', shopId).eq('sku', sku);
        return res.json({ ok: true, shopTotals });
      }

      // action: รีฟิลเสร็จ พร้อมขาย — แยกตามสาขา
      if (action === 'refill') {
        const q = parseFloat(qty) || 0;
        const { shopTotals } = await adjustBranchStock(shopId, sku, branch, { qtyDelta: q, emptyWaitingDelta: -q });
        await supabase.from('pos_products').update({ product_updated_at: now }).eq('shop_id', shopId).eq('sku', sku);
        return res.json({ ok: true, shopTotals });
      }

      // generic patch — ฟิลด์ที่ไม่ใช่จำนวนสต็อกยังอัปเดต pos_products ตรงๆ เหมือนเดิม
      const supaUpdates = { product_updated_at: now };
      if (updates.name          !== undefined) supaUpdates.name = updates.name;
      if (updates.category      !== undefined) supaUpdates.category = updates.category;
      if (updates.price         !== undefined) supaUpdates.price = updates.price;
      if (updates.cost          !== undefined) supaUpdates.cost = updates.cost;
      if (updates.unit          !== undefined) supaUpdates.unit = updates.unit;
      if (updates.aliases       !== undefined) supaUpdates.aliases = updates.aliases;
      if (updates.notes         !== undefined) supaUpdates.notes = updates.notes;
      if (updates.type          !== undefined) supaUpdates.type = updates.type;
      if (updates.product_code  !== undefined) supaUpdates.product_code = updates.product_code;
      if (updates.barcode       !== undefined) supaUpdates.barcode = updates.barcode;
      if (updates.description   !== undefined) supaUpdates.description = updates.description;
      if (updates.vat_type      !== undefined) supaUpdates.vat_type = updates.vat_type;
      if (updates.is_active     !== undefined) supaUpdates.is_active = !!updates.is_active;
      if (updates.empty_ceiling !== undefined) supaUpdates.empty_ceiling = updates.empty_ceiling;
      if (updates.branches      !== undefined) supaUpdates.branches = Array.isArray(updates.branches) ? updates.branches.join(',') : '';
      if (updates.online_order_visible !== undefined) supaUpdates.online_order_visible = !!updates.online_order_visible;

      const { error } = await supabase.from('pos_products').update(supaUpdates)
        .eq('shop_id', shopId).eq('sku', sku);
      if (error) throw error;

      // loyalty_baht_per_point — คอลัมน์ใหม่ (ข้อ 102) แยกเขียนต่างหากกันพังการแก้ไขสินค้าหลัก
      // ถ้ายังไม่ได้รัน SQL เพิ่มคอลัมน์ — ส่ง '' หรือ null = ล้างค่ากลับไปใช้อัตราเริ่มต้นของร้าน
      if (updates.loyalty_baht_per_point !== undefined) {
        try {
          const v = updates.loyalty_baht_per_point;
          await supabase.from('pos_products').update({ loyalty_baht_per_point: (v !== null && v !== '') ? (parseFloat(v) || null) : null }).eq('shop_id', shopId).eq('sku', sku);
        } catch (lpErr) {
          console.error('[pos/products] update loyalty_baht_per_point failed (non-fatal):', lpErr.message);
        }
      }

      // โอนย้ายสต็อกข้ามสาขา Phase 1: stock/stockDelta/at_customer/empty_waiting แก้ผ่าน
      // adjustBranchStock() แยกตามสาขา (branch จาก request — ใน pos.js คือ selectedBranch ที่กำลัง
      // ทำงานอยู่) ไม่ใช่เขียน pos_products ตรงๆ อีกต่อไป — updates.stock เป็นค่าตั้งใหม่แบบ absolute
      // จึงต้องแปลงเป็น delta เทียบกับยอดปัจจุบันของสาขานั้นก่อน
      let branchResult = null;
      const wantsStockChange = updates.stock !== undefined || stockDelta !== undefined;
      const wantsCyclicalChange = updates.at_customer !== undefined || updates.empty_waiting !== undefined;
      if (wantsStockChange || wantsCyclicalChange) {
        const current = await getBranchStock(shopId, sku, branch);
        const qtyDelta = updates.stock !== undefined
          ? (parseFloat(updates.stock) || 0) - current.qty
          : (stockDelta !== undefined ? stockDelta : 0);
        const atCustomerDelta = updates.at_customer !== undefined ? (parseFloat(updates.at_customer) || 0) - current.at_customer : 0;
        const emptyWaitingDelta = updates.empty_waiting !== undefined ? (parseFloat(updates.empty_waiting) || 0) - current.empty_waiting : 0;
        branchResult = await adjustBranchStock(shopId, sku, branch, { qtyDelta, atCustomerDelta, emptyWaitingDelta });
      }

      return res.json({ ok: true, sku, stock: branchResult ? branchResult.shopTotals.stock : (parseFloat(existing.stock) || 0) });
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
