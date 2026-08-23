/**
 * GET    /api/pos/loyalty-rewards?shopId&branch&activeOnly=1  → รายการของรางวัลที่แลกด้วยแต้มได้
 *        พร้อมคำนวณต้นทุน COGS ที่ร้านต้องจ่ายทุกครั้งที่มีคนแลก (ใช้ต้นทุนสินค้าปัจจุบันเสมอ)
 * POST   /api/pos/loyalty-rewards { shopId, name, points_cost, product_sku, product_qty, branch }
 * PATCH  /api/pos/loyalty-rewards { shopId, reward_id, ...fields, is_active }
 * DELETE /api/pos/loyalty-rewards { shopId, reward_id } → soft-delete
 *
 * แยกไฟล์จาก promotions.js เพราะเป็นคนละแนวคิด (ของรางวัลแลกด้วยแต้มสะสม ไม่ใช่ส่วนลดตอนซื้อ) แต่
 * mirror pattern เดียวกันทุกจุด (auth/validate/CRUD shape) ตามธรรมเนียมโปรเจกต์ — ดูรายละเอียดระบบ
 * แต้มสะสมทั้งหมดใน lib/loyalty.js
 */
import { createClient } from '@supabase/supabase-js';
import { blockIfTrialExpired } from '../../../lib/shop-access';
import { blockAllStaffSessions } from '../../../lib/pos-auth';
import { productFromRow } from '../../../lib/google-pos';
import { makeRewardNo } from '../../../lib/loyalty';
import { tableExists } from '../../../lib/supabase-pos';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

function round2(n) { return Math.round((n || 0) * 100) / 100; }

function rewardFromRow(r) {
  return {
    reward_id: r.id, reward_no: r.reward_no, name: r.name,
    points_cost: Number(r.points_cost) || 0, product_sku: r.product_sku,
    product_qty: Number(r.product_qty) || 1, is_active: r.is_active,
    branch: r.branch_name || '', created_at: r.created_at,
  };
}

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

function validateReward(body) {
  const { name, points_cost, product_sku, product_qty } = body || {};
  if (!name?.trim()) return 'กรุณาระบุชื่อของรางวัล';
  if (!(parseFloat(points_cost) > 0)) return 'กรุณาระบุจำนวนแต้มที่ใช้แลก (ต้องมากกว่า 0)';
  if (!product_sku) return 'กรุณาเลือกสินค้าที่จะให้เป็นของรางวัล';
  if (!(parseInt(product_qty) >= 1)) return 'จำนวนสินค้าต่อการแลก 1 ครั้งต้องมากกว่า 0';
  return null;
}

export default async function handler(req, res) {
  const shopId = req.query.shopId || req.body?.shopId;
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });

  try {
    // ── GET (ทุกคนดูได้ รวมแคชเชียร์ — ต้องเห็นของรางวัลที่ active เพื่อใช้ตอนแลกให้ลูกค้า) ──
    // fail-safe คืนลิสต์ว่างถ้ายังไม่ได้รัน SQL (เรียกจากหน้าขายทุกครั้งที่โหลด ไม่ควรพังทั้งหน้า)
    if (req.method === 'GET') {
      if (!(await tableExists('pos_loyalty_rewards'))) return res.json({ rewards: [] });
      let query = supabase.from('pos_loyalty_rewards').select('*').eq('shop_id', shopId).is('deleted_at', null);
      if (req.query.activeOnly === '1') query = query.eq('is_active', true);
      if (req.query.branch) query = query.or(`branch_name.eq.${req.query.branch},branch_name.eq.`);
      const { data, error } = await query.order('created_at', { ascending: false });
      if (error) throw error;

      const productsBySku = await fetchProductsBySku(shopId);
      const rewards = (data || []).map(r => {
        const rw = rewardFromRow(r);
        const p = productsBySku[rw.product_sku];
        rw.product_name = p?.name || rw.product_sku;
        rw.cogs_per_redemption = p ? round2((p.cost || 0) * rw.product_qty) : null;
        return rw;
      });
      return res.json({ rewards });
    }

    // เขียน (POST/PATCH/DELETE) — เฉพาะเจ้าของร้าน/แอดมิน กำหนดของรางวัล/ต้นทุนไม่ใช่หน้าที่พนักงาน
    if (!blockAllStaffSessions(req, res, shopId)) return;
    if (req.method !== 'GET' && (await blockIfTrialExpired(req, res, shopId))) return;
    if (!(await tableExists('pos_loyalty_rewards'))) {
      return res.status(400).json({ error: 'ระบบแต้มสะสมยังไม่พร้อมใช้งาน (ยังไม่ได้รัน SQL)' });
    }

    // ── POST (สร้างของรางวัลใหม่) ────────────────────────────────────────────
    if (req.method === 'POST') {
      const errMsg = validateReward(req.body);
      if (errMsg) return res.status(400).json({ error: errMsg });
      const { name, points_cost, product_sku, product_qty, branch = '' } = req.body;

      const reward_no = makeRewardNo();
      const { data: inserted, error } = await supabase.from('pos_loyalty_rewards').insert({
        shop_id: shopId, reward_no, name: name.trim(), points_cost: parseFloat(points_cost),
        product_sku, product_qty: parseInt(product_qty) || 1, branch_name: branch, is_active: true,
      }).select('*').single();
      if (error) throw error;
      return res.json({ ok: true, reward: rewardFromRow(inserted) });
    }

    // ── PATCH (แก้ไข/เปิด-ปิด) ────────────────────────────────────────────────
    if (req.method === 'PATCH') {
      const { reward_id, name, points_cost, product_sku, product_qty, branch, is_active } = req.body || {};
      if (!reward_id) return res.status(400).json({ error: 'Missing reward_id' });

      const updates = {};
      if (name !== undefined) updates.name = name.trim();
      if (is_active !== undefined) updates.is_active = !!is_active;
      if (branch !== undefined) updates.branch_name = branch;
      if (points_cost !== undefined || product_sku !== undefined || product_qty !== undefined) {
        const merged = { points_cost, product_sku, product_qty, name: name || 'x' };
        const errMsg = validateReward(merged);
        if (errMsg) return res.status(400).json({ error: errMsg });
        if (points_cost !== undefined) updates.points_cost = parseFloat(points_cost);
        if (product_sku !== undefined) updates.product_sku = product_sku;
        if (product_qty !== undefined) updates.product_qty = parseInt(product_qty) || 1;
      }

      const { error } = await supabase.from('pos_loyalty_rewards').update(updates).eq('shop_id', shopId).eq('id', reward_id);
      if (error) throw error;
      return res.json({ ok: true });
    }

    // ── DELETE (soft-delete) ─────────────────────────────────────────────────
    if (req.method === 'DELETE') {
      const { reward_id } = req.body || {};
      if (!reward_id) return res.status(400).json({ error: 'Missing reward_id' });
      const { error } = await supabase.from('pos_loyalty_rewards')
        .update({ deleted_at: new Date().toISOString() }).eq('shop_id', shopId).eq('id', reward_id);
      if (error) throw error;
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('[pos/loyalty-rewards]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
