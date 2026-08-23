/**
 * GET    /api/pos/promotions?shopId&branch&activeOnly=1  → รายการโปรโมชั่น พร้อมคำนวณกำไร/มาร์จิ้น
 *        ที่เหลือของแต่ละโปรต่อ 1 ครั้งที่ใช้ (ใช้ราคา/ต้นทุนสินค้าปัจจุบันเสมอ ไม่ใช่ ณ ตอนสร้างโปร)
 * POST   /api/pos/promotions { shopId, name, promo_type, config, branch, valid_from, valid_until }
 * PATCH  /api/pos/promotions { shopId, promo_id, ...fields, is_active }
 * DELETE /api/pos/promotions { shopId, promo_id } → soft-delete
 *
 * promo_type 6 แบบ (config shape ต่างกันตาม type):
 *   product_discount  { sku, discount_type:'percent'|'amount', discount_value }
 *   quantity_discount { sku, min_qty, discount_type, discount_value }
 *   buy_x_get_y       { buySku, buyQty, getSku, getQty, get_discount_type:'free'|'percent', get_discount_value }
 *   bundle            { items:[{sku,qty}], bundle_price }
 *   free_gift         { triggerSku, triggerQty, giftSku, giftQty }
 *   bill_discount     { min_total, discount_type:'percent'|'amount', discount_value, max_discount? }
 *     — ต่างจาก 5 แบบข้างบนตรงที่ไม่ผูกกับ SKU ไหนเลย เช็คจากยอดรวมทั้งบิล ไม่มี margin preview
 *       ล่วงหน้าได้ (ไม่รู้ว่าบิลจริงจะมีสินค้าอะไรบ้าง) ตอนใช้จริงกระจายส่วนลดตามสัดส่วนราคาเดิมของ
 *       ทุกชิ้นในตะกร้า (ratio เดียวกับที่ bundle ใช้)
 *
 * งานกลยุทธ์ "Promotions Engine" — ผู้ใช้อนุมัติ 2026-08-16 พร้อมขอเพิ่มคำนวณกำไรคงเหลือต่อโปร
 * ไม่แตะ sales.js/checkout เลย — เป็นแค่เครื่องมือคำนวณ/จัดการ ฝั่งหน้าขาย (pos.js) นำราคาที่คำนวณ
 * ได้ไปปรับในตะกร้าผ่านกลไกแก้ราคาที่มีอยู่แล้ว (updatePrice) ความเสี่ยงต่ำสุดต่อ core checkout flow
 */
import { createClient } from '@supabase/supabase-js';
import { blockIfTrialExpired } from '../../../lib/shop-access';
import { blockAllStaffSessions } from '../../../lib/pos-auth';
import { productFromRow } from '../../../lib/google-pos';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

const PROMO_TYPES = new Set(['product_discount', 'quantity_discount', 'buy_x_get_y', 'bundle', 'free_gift', 'bill_discount']);

async function fetchProductsBySku(shopId) {
  const PAGE = 1000;
  let all = [], from = 0;
  for (;;) {
    const { data, error } = await supabase.from('pos_products').select('*')
      .eq('shop_id', shopId).is('deleted_at', null).order('id').range(from, from + PAGE - 1);
    if (error) throw error;
    all = all.concat(data || []);
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
  const bySku = {};
  all.map(productFromRow).filter(p => p.sku).forEach(p => { bySku[p.sku] = p; });
  return bySku;
}

function round2(n) { return Math.round((n || 0) * 100) / 100; }

// คำนวณรายได้/ต้นทุน/กำไรของโปร "ต่อการใช้ 1 ครั้ง" จากราคา/ต้นทุนสินค้าปัจจุบัน — คืน null ถ้าคำนวณ
// ไม่ได้ (สินค้าที่อ้างอิงถูกลบไปแล้ว) กันพังทั้ง response ถ้าโปรเก่าอ้างสินค้าที่ไม่มีแล้ว
function computePromoMargin(promo, productsBySku) {
  try {
    const c = promo.config || {};
    if (promo.promo_type === 'product_discount' || promo.promo_type === 'quantity_discount') {
      const p = productsBySku[c.sku];
      if (!p) return null;
      const price = c.discount_type === 'amount'
        ? Math.max(0, p.price - (parseFloat(c.discount_value) || 0))
        : p.price * (1 - (parseFloat(c.discount_value) || 0) / 100);
      const revenue = round2(price);
      const cost = round2(p.cost || 0);
      const profit = round2(revenue - cost);
      return { revenue, cost, profit, margin_pct: revenue > 0 ? round2(profit / revenue * 100) : 0, per: '1 ชิ้น' };
    }
    if (promo.promo_type === 'buy_x_get_y') {
      const buy = productsBySku[c.buySku], get = productsBySku[c.getSku];
      if (!buy || !get) return null;
      const buyQty = parseInt(c.buyQty) || 1, getQty = parseInt(c.getQty) || 1;
      const getPrice = c.get_discount_type === 'free' ? 0
        : get.price * (1 - (parseFloat(c.get_discount_value) || 0) / 100);
      const revenue = round2(buy.price * buyQty + getPrice * getQty);
      const cost = round2(buy.cost * buyQty + get.cost * getQty);
      const profit = round2(revenue - cost);
      return { revenue, cost, profit, margin_pct: revenue > 0 ? round2(profit / revenue * 100) : 0, per: `ซื้อ ${buyQty} แถม ${getQty}` };
    }
    if (promo.promo_type === 'bundle') {
      const items = Array.isArray(c.items) ? c.items : [];
      if (!items.length) return null;
      let cost = 0, normalRevenue = 0;
      for (const it of items) {
        const p = productsBySku[it.sku];
        if (!p) return null;
        cost += p.cost * (parseInt(it.qty) || 1);
        normalRevenue += p.price * (parseInt(it.qty) || 1);
      }
      const revenue = parseFloat(c.bundle_price) || 0;
      const profit = round2(revenue - cost);
      return { revenue: round2(revenue), cost: round2(cost), profit, margin_pct: revenue > 0 ? round2(profit / revenue * 100) : 0, per: '1 ชุด', normal_price: round2(normalRevenue) };
    }
    if (promo.promo_type === 'free_gift') {
      const trigger = productsBySku[c.triggerSku], gift = productsBySku[c.giftSku];
      if (!trigger || !gift) return null;
      const triggerQty = parseInt(c.triggerQty) || 1, giftQty = parseInt(c.giftQty) || 1;
      const revenue = round2(trigger.price * triggerQty); // ของแถมไม่คิดรายได้
      const cost = round2(trigger.cost * triggerQty + gift.cost * giftQty);
      const profit = round2(revenue - cost);
      return { revenue, cost, profit, margin_pct: revenue > 0 ? round2(profit / revenue * 100) : 0, per: `ซื้อ ${triggerQty} แถม ${giftQty}` };
    }
    return null;
  } catch { return null; }
}

function promoFromRow(r) {
  return {
    promo_id: r.id, promo_no: r.promo_no, name: r.name, promo_type: r.promo_type,
    config: r.config || {}, is_active: r.is_active, branch: r.branch_name || '',
    valid_from: r.valid_from, valid_until: r.valid_until, created_at: r.created_at,
  };
}

function validateConfig(promoType, config) {
  const c = config || {};
  if (promoType === 'product_discount') {
    if (!c.sku || !['percent', 'amount'].includes(c.discount_type) || !(parseFloat(c.discount_value) > 0)) return 'ข้อมูลส่วนลดไม่ครบ (สินค้า/ประเภท/มูลค่าส่วนลด)';
  } else if (promoType === 'quantity_discount') {
    if (!c.sku || !(parseInt(c.min_qty) >= 2) || !['percent', 'amount'].includes(c.discount_type) || !(parseFloat(c.discount_value) > 0)) return 'ข้อมูลไม่ครบ (สินค้า/จำนวนขั้นต่ำ≥2/ประเภท/มูลค่าส่วนลด)';
  } else if (promoType === 'buy_x_get_y') {
    if (!c.buySku || !c.getSku || !(parseInt(c.buyQty) > 0) || !(parseInt(c.getQty) > 0) || !['free', 'percent'].includes(c.get_discount_type)) return 'ข้อมูลไม่ครบ (สินค้าที่ซื้อ/สินค้าที่แถม/จำนวน)';
    if (c.get_discount_type === 'percent' && !(parseFloat(c.get_discount_value) > 0)) return 'กรุณาระบุ % ส่วนลดของที่แถม';
  } else if (promoType === 'bundle') {
    if (!Array.isArray(c.items) || c.items.length < 2 || c.items.some(it => !it.sku || !(parseInt(it.qty) > 0))) return 'ชุดต้องมีสินค้าอย่างน้อย 2 รายการ';
    if (!(parseFloat(c.bundle_price) > 0)) return 'กรุณาระบุราคาชุด';
  } else if (promoType === 'free_gift') {
    if (!c.triggerSku || !c.giftSku || !(parseInt(c.triggerQty) > 0) || !(parseInt(c.giftQty) > 0)) return 'ข้อมูลไม่ครบ (สินค้าที่ต้องซื้อ/ของแถม/จำนวน)';
  } else if (promoType === 'bill_discount') {
    if (!(parseFloat(c.min_total) > 0) || !['percent', 'amount'].includes(c.discount_type) || !(parseFloat(c.discount_value) > 0)) return 'ข้อมูลไม่ครบ (ยอดขั้นต่ำ/ประเภท/มูลค่าส่วนลด)';
    if (c.discount_type === 'percent' && parseFloat(c.discount_value) > 100) return 'ส่วนลด % ต้องไม่เกิน 100';
    if (c.max_discount !== undefined && c.max_discount !== null && c.max_discount !== '' && !(parseFloat(c.max_discount) >= 0)) return 'ยอดลดสูงสุดไม่ถูกต้อง';
  }
  return null;
}

function makePromoNo() {
  return 'PROMO' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
}

export default async function handler(req, res) {
  const shopId = req.query.shopId || req.body?.shopId;
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });

  try {
    // ── GET (ทุกคนดูได้ รวมแคชเชียร์ — ต้องเห็นโปรที่ active เพื่อใช้ตอนขาย) ──────────────
    if (req.method === 'GET') {
      let query = supabase.from('pos_promotions').select('*').eq('shop_id', shopId).is('deleted_at', null);
      if (req.query.activeOnly === '1') query = query.eq('is_active', true);
      if (req.query.branch) query = query.or(`branch_name.eq.${req.query.branch},branch_name.eq.`);
      const { data, error } = await query.order('created_at', { ascending: false });
      if (error) throw error;

      const productsBySku = await fetchProductsBySku(shopId);
      const promos = (data || []).map(r => {
        const p = promoFromRow(r);
        p.margin = computePromoMargin(p, productsBySku);
        return p;
      });
      return res.json({ promotions: promos });
    }

    // เขียน (POST/PATCH/DELETE) — เฉพาะเจ้าของร้าน/แอดมิน กำหนดกลยุทธ์ราคาไม่ใช่หน้าที่พนักงาน
    if (!blockAllStaffSessions(req, res, shopId)) return;
    if (req.method !== 'GET' && (await blockIfTrialExpired(req, res, shopId))) return;

    // ── POST (สร้างโปรใหม่) ──────────────────────────────────────────────────
    if (req.method === 'POST') {
      const { name, promo_type, config, branch = '', valid_from = null, valid_until = null } = req.body || {};
      if (!name?.trim()) return res.status(400).json({ error: 'กรุณาระบุชื่อโปรโมชั่น' });
      if (!PROMO_TYPES.has(promo_type)) return res.status(400).json({ error: 'ประเภทโปรโมชั่นไม่ถูกต้อง' });
      const configErr = validateConfig(promo_type, config);
      if (configErr) return res.status(400).json({ error: configErr });

      const promo_no = makePromoNo();
      const { data: inserted, error } = await supabase.from('pos_promotions').insert({
        shop_id: shopId, promo_no, name: name.trim(), promo_type, config: config || {},
        branch_name: branch, valid_from, valid_until, is_active: true,
      }).select('*').single();
      if (error) throw error;
      return res.json({ ok: true, promo: promoFromRow(inserted) });
    }

    // ── PATCH (แก้ไข/เปิด-ปิด) ────────────────────────────────────────────────
    if (req.method === 'PATCH') {
      const { promo_id, name, promo_type, config, branch, valid_from, valid_until, is_active } = req.body || {};
      if (!promo_id) return res.status(400).json({ error: 'Missing promo_id' });

      const updates = {};
      if (name !== undefined) updates.name = name.trim();
      if (is_active !== undefined) updates.is_active = !!is_active;
      if (branch !== undefined) updates.branch_name = branch;
      if (valid_from !== undefined) updates.valid_from = valid_from;
      if (valid_until !== undefined) updates.valid_until = valid_until;
      if (promo_type !== undefined && config !== undefined) {
        if (!PROMO_TYPES.has(promo_type)) return res.status(400).json({ error: 'ประเภทโปรโมชั่นไม่ถูกต้อง' });
        const configErr = validateConfig(promo_type, config);
        if (configErr) return res.status(400).json({ error: configErr });
        updates.promo_type = promo_type;
        updates.config = config;
      }

      const { error } = await supabase.from('pos_promotions').update(updates).eq('shop_id', shopId).eq('id', promo_id);
      if (error) throw error;
      return res.json({ ok: true });
    }

    // ── DELETE (soft-delete) ─────────────────────────────────────────────────
    if (req.method === 'DELETE') {
      const { promo_id } = req.body || {};
      if (!promo_id) return res.status(400).json({ error: 'Missing promo_id' });
      const { error } = await supabase.from('pos_promotions')
        .update({ deleted_at: new Date().toISOString() }).eq('shop_id', shopId).eq('id', promo_id);
      if (error) throw error;
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('[pos/promotions]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
