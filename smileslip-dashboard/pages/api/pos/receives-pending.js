/**
 * GET    /api/pos/receives-pending?shopId              → รายการรับสินค้าที่รอตรวจสอบ (มาจากบอท LINE #รับสินค้า)
 * DELETE /api/pos/receives-pending { shopId, pending_no } → ลบออกจากคิวรอ (ปฏิเสธ หรือแอดมินยืนยันรับเข้าสต็อคจริงเสร็จแล้ว)
 *
 * ไฟล์นี้ไม่แตะสต็อคเอง — การตัดสต็อคจริงยังผ่าน /api/pos/receives ปกติเท่านั้น
 * (แอดมินตรวจ/แก้ไขรายการที่นี่ก่อน แล้วค่อยกดยืนยันผ่านฟอร์มรับสินค้าปกติ)
 *
 * Phase 2 (write-primary flip, 2026-07-29): อ่านจาก Supabase (pos_pending_receives) แล้ว —
 * ตารางนี้ถูกเขียนจากฝั่งบอท (smileslip-pro/index.js) เป็น dual-write secondary มาตั้งแต่ Tier A
 * อยู่แล้ว ตอนนี้เป็นแหล่งอ่าน/ลบเพียงแหล่งเดียวของไฟล์นี้ (ไม่มี deleted_at — ลบจริงเลย)
 */
import { createClient } from '@supabase/supabase-js';
import { blockIfTrialExpired } from '../../../lib/shop-access';
import { pendingReceiveFromRow } from '../../../lib/google-pos';
import { requirePermission } from '../../../lib/pos-auth';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  const shopId = req.query.shopId || req.body?.shopId;
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });

  // เขียนไม่ได้ถ้าทดลองใช้ 30 วันหมดอายุแล้ว (อ่าน/GET ยังทำได้ปกติเสมอ)
  if (req.method !== 'GET' && (await blockIfTrialExpired(req, res, shopId))) return;

  try {
    if (req.method === 'GET') {
      const { data, error } = await supabase.from('pos_pending_receives').select('*')
        .eq('shop_id', shopId).eq('status', 'รอตรวจสอบ').order('created_at', { ascending: false });
      if (error) throw error;
      const pending = (data || []).map(pendingReceiveFromRow).filter(p => p.pending_no);
      return res.json({ pending });
    }

    if (req.method === 'DELETE') {
      if (!(await requirePermission(req, res, shopId, 'perm_manage_receiving'))) return;
      const { pending_no } = req.body;
      if (!pending_no) return res.status(400).json({ error: 'Missing pending_no' });
      const { data: existing, error: fetchErr } = await supabase.from('pos_pending_receives').select('id')
        .eq('shop_id', shopId).eq('pending_no', pending_no).maybeSingle();
      if (fetchErr) throw fetchErr;
      if (!existing) return res.status(404).json({ error: 'ไม่พบรายการ' });

      const { error } = await supabase.from('pos_pending_receives').delete()
        .eq('shop_id', shopId).eq('pending_no', pending_no);
      if (error) throw error;
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[pos/receives-pending]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
