import { createClient } from '@supabase/supabase-js';
import { deleteShopCompletely } from '../../../lib/shop-deletion';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

/**
 * DELETE /api/shop/purge-deleted-shop { shopId, lineUserId }
 *
 * ล้างร้านที่ soft-delete ไว้แล้ว (ข้อ 91) ให้ถาวรทันที ไม่ต้องรอครบ RETENTION_MONTHS เดือน — ใช้
 * ตอนเจ้าของ LINE ID เดิมสมัครใหม่แล้วเลือก "เริ่มระบบใหม่หมด" ใน register.js (ไม่เอาข้อมูลเก่า)
 * ก่อนจะเข้าฟอร์มสมัครร้านใหม่ (กันไลไอดีเดียวชนกับร้านเก่าที่ soft-delete ค้างอยู่)
 *
 * ต่างจาก /api/shop/delete-shop.js (ต้องพิมพ์ชื่อร้านยืนยัน, ใช้ตอนร้านยัง active อยู่) โดยเจตนา —
 * endpoint นี้ทำงานได้เฉพาะร้านที่ "soft-deleted อยู่แล้วเท่านั้น" (เจ้าของกดลบไปแล้วครั้งหนึ่ง จึงไม่
 * ต้องบังคับพิมพ์ยืนยันซ้ำอีกรอบ — ความเสี่ยงกดพลาดต่ำกว่าการลบร้านที่ยัง active อยู่มาก)
 */
export default async function handler(req, res) {
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });

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
      return res.status(400).json({ error: 'ร้านนี้ยังไม่ได้ถูกลบ — ใช้ /api/shop/delete-shop แทน' });
    }

    const result = await deleteShopCompletely(shopId);
    if (result.notFound) return res.status(404).json({ error: 'ไม่พบร้านค้านี้' });
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[purge-deleted-shop] fatal error:', err.message);
    return res.status(500).json({ error: `ล้างข้อมูลเดิมไม่สำเร็จ: ${err.message}` });
  }
}
