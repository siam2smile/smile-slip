import { createClient } from '@supabase/supabase-js';
import { restoreShopFromRetention, RETENTION_MONTHS } from '../../../lib/shop-deletion';
import { issueOwnerSession } from '../../../lib/owner-session';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

/**
 * POST /api/shop/restore-shop { shopId, lineUserId }
 *
 * กู้คืนร้านที่ soft-delete ไว้ (ข้อ 91, 6-month retention) — ใช้ตอนเจ้าของ LINE ID เดิมสมัครใหม่
 * ภายในช่วงเก็บข้อมูลแล้วเลือก "ใช้ข้อมูลเดิม" ในหน้า register.js — ไม่เชื่อ shopId จาก client
 * เฉยๆ ตรวจสอบซ้ำที่นี่ว่า owner_line_id ตรงกับ lineUserId จริง + ยัง soft-deleted อยู่จริง + ยังไม่
 * เกิน RETENTION_MONTHS เดือน (กันกู้คืนร้านคนอื่น/ร้านที่ cron ล้างไปแล้วพอดี) ก่อนเรียก
 * restoreShopFromRetention() เสมอ
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { shopId, lineUserId } = req.body || {};
  if (!shopId || !lineUserId) return res.status(400).json({ error: 'ข้อมูลไม่ครบถ้วน' });

  try {
    const { data: shop, error: fetchErr } = await supabase
      .from('shop_profiles')
      .select('id, shop_name, owner_line_id, deleted_at')
      .eq('id', shopId)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!shop) return res.status(404).json({ error: 'ไม่พบร้านค้านี้' });
    if (shop.owner_line_id !== lineUserId) {
      return res.status(403).json({ error: 'คุณไม่ใช่เจ้าของร้านนี้' });
    }
    if (!shop.deleted_at) {
      return res.status(400).json({ error: 'ร้านนี้ยังไม่ได้ถูกลบ ไม่ต้องกู้คืน' });
    }
    const cutoff = Date.now() - RETENTION_MONTHS * 30 * 24 * 3600 * 1000;
    if (new Date(shop.deleted_at).getTime() < cutoff) {
      return res.status(400).json({ error: `ร้านนี้ถูกลบไปเกิน ${RETENTION_MONTHS} เดือนแล้ว กู้คืนไม่ได้อีกต่อไป` });
    }

    const result = await restoreShopFromRetention(shopId);
    if (result.notFound) return res.status(404).json({ error: 'ไม่พบร้านค้านี้' });

    const ownerSession = issueOwnerSession({ shopId: shop.id, ownerId: lineUserId, role: 'owner' });
    return res.status(200).json({ success: true, shopId: shop.id, shopName: shop.shop_name, ownerSession });
  } catch (err) {
    console.error('[restore-shop] fatal error:', err.message);
    return res.status(500).json({ error: `กู้คืนร้านไม่สำเร็จ: ${err.message}` });
  }
}
