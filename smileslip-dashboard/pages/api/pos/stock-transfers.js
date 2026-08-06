/**
 * GET  /api/pos/stock-transfers?shopId&sku  → ประวัติการโอนย้ายสต็อกข้ามสาขา
 * POST /api/pos/stock-transfers { shopId, sku, from_branch, to_branch, qty, note }
 *   → โอนย้าย "เต็ม/พร้อมขาย" (qty) ของสินค้าจากสาขาหนึ่งไปอีกสาขาหนึ่ง
 *
 * โอนย้ายสต็อกข้ามสาขา Phase 2 — บล็อกถ้าสต็อคต้นทางไม่พอ (ต่างจากขายที่ clamp เงียบๆ) เพราะเป็น
 * action ของแอดมิน ความถี่ต่ำ และ "ย้ายของที่ไม่มีจริง" เป็นไปไม่ได้ทางกายภาพ
 *
 * status บน pos_stock_transfers: pending (เริ่มโอน) -> committed (สำเร็จทั้งสองฝั่ง) — ถ้าหักต้นทาง
 * สำเร็จแต่เพิ่มปลายทางล้มเหลว (หายาก) แถวจะค้างที่ pending ให้ตรวจสอบด้วยมือ ไม่ mark เป็น failed
 * เพราะเป็นสถานะกึ่งสำเร็จ ไม่ใช่ล้มเหลวสะอาดๆ
 */
import { createClient } from '@supabase/supabase-js';
import { blockIfTrialExpired } from '../../../lib/shop-access';
import { requirePermission } from '../../../lib/pos-auth';
import { transferBranchStock, getStockBreakdown } from '../../../lib/pos-stock';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  const shopId = req.query.shopId || req.body?.shopId;
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });

  try {
    // ── GET — ประวัติการโอน (+ breakdown สต็อกปัจจุบันต่อสาขาถ้าระบุ sku) ──────
    if (req.method === 'GET') {
      let query = supabase.from('pos_stock_transfers').select('*').eq('shop_id', shopId);
      if (req.query.sku) query = query.eq('sku', req.query.sku);
      const { data, error } = await query.order('created_at', { ascending: false }).limit(200);
      if (error) throw error;

      let breakdown = null;
      if (req.query.sku) breakdown = await getStockBreakdown(shopId, req.query.sku);

      return res.json({ transfers: data || [], breakdown });
    }

    // ── POST — โอนย้ายจริง ───────────────────────────────────────────────
    if (req.method === 'POST') {
      if (await blockIfTrialExpired(req, res, shopId)) return;
      if (!(await requirePermission(req, res, shopId, 'perm_manage_stock'))) return;

      const { sku, from_branch = '', to_branch = '', qty, note = '', transferred_by = '' } = req.body;
      if (!sku) return res.status(400).json({ error: 'ต้องระบุสินค้า' });
      const q = parseFloat(qty);
      if (!(q > 0)) return res.status(400).json({ error: 'จำนวนที่โอนต้องมากกว่า 0' });
      if ((from_branch || '') === (to_branch || '')) {
        return res.status(400).json({ error: 'สาขาต้นทางและปลายทางต้องไม่ใช่สาขาเดียวกัน' });
      }

      const { data: transferRow, error: insertErr } = await supabase.from('pos_stock_transfers').insert({
        shop_id: shopId, sku, from_branch, to_branch, qty: q, status: 'pending',
        transferred_by, note,
      }).select().single();
      if (insertErr) throw insertErr;

      try {
        await transferBranchStock(shopId, sku, from_branch, to_branch, q);
      } catch (transferErr) {
        if (transferErr.insufficientStock) {
          await supabase.from('pos_stock_transfers').update({ status: 'failed' }).eq('id', transferRow.id);
          return res.status(400).json({ error: transferErr.message, insufficientStock: true });
        }
        // ล้มเหลวกลางทาง (เช่น ชนกันเกิน retry limit) — ปล่อยไว้ที่ pending ให้ตรวจสอบด้วยมือ
        // ถ้ายังไม่มีอะไรถูกหักไปจริง (เช่น error เกิดก่อนหักต้นทางสำเร็จ) ก็ไม่กระทบข้อมูลอะไรเลย
        console.error('[stock-transfers] transfer failed mid-way:', transferErr.message);
        return res.status(500).json({ error: 'โอนย้ายไม่สำเร็จ: ' + transferErr.message, transferId: transferRow.id });
      }

      const { error: commitErr } = await supabase.from('pos_stock_transfers')
        .update({ status: 'committed', committed_at: new Date().toISOString() })
        .eq('id', transferRow.id);
      if (commitErr) console.error('[stock-transfers] mark committed failed (non-fatal, transfer itself succeeded):', commitErr.message);

      return res.json({ ok: true, transferId: transferRow.id });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[pos/stock-transfers]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
