import { requireOwnerAuth } from '../../../lib/owner-auth';
import { deleteShopCompletely } from '../../../lib/shop-deletion';
import { createClient } from '@supabase/supabase-js';

/**
 * DELETE /api/shop/delete-shop { shopId, lineUserId, confirmShopName }
 *
 * ลบร้านแบบถาวร (hard delete) — ใช้ตอนเจ้าของร้านเลือก "ลบร้านเดิมแล้วสมัครใหม่" ในหน้า register.js
 * เจตนาของผู้ใช้ชัดเจนว่าต้องเป็นการลบจริง ไม่ใช่ soft-delete เพราะต้องปิดช่องโหว่ลบแล้วสมัครใหม่
 * เพื่อขอสิทธิ์ทดลองฟรี 30 วันซ้ำไม่จำกัดรอบ
 *
 * ความปลอดภัยเฉพาะทางนี้ (การลบข้อมูลจริง + ยกเลิก Stripe + กันสิทธิ์ trial ซ้ำ อยู่รวมกันใน
 * lib/shop-deletion.js ใช้ร่วมกับปุ่ม "ลบร้านนี้" ของแอดมินบริษัทใน /api/admin/update-shop แล้ว):
 * - ต้องเป็นเจ้าของร้านจริงเท่านั้น (แอดมินร้านลบร้านที่ตัวเองแค่ดูแลอยู่ไม่ได้)
 * - ต้องพิมพ์ชื่อร้านให้ตรงเป๊ะก่อนเสมอ (กันกดพลาด/สคริปต์ยิงมั่ว)
 */

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });

  const { shopId, lineUserId, confirmShopName } = req.body || {};
  if (!shopId || !lineUserId || !confirmShopName) {
    return res.status(400).json({ error: 'ข้อมูลไม่ครบถ้วน กรุณาลองใหม่อีกครั้ง' });
  }

  // เฟส C — endpoint เสี่ยงสูงสุดในระบบ (ลบร้านถาวร) บังคับ owner-session จริงเป็นด่านแรก
  // (enforce:true = ไม่มี token เลยก็บล็อก, requireOwnerRole:true = แอดมินร้านลบไม่ได้)
  // เดิมมีแค่เช็ค body.lineUserId เทียบ owner_line_id เฉยๆ (ปลอมได้ตรงๆ) — ยังคงเช็คนั้นไว้
  // เป็นชั้นป้องกันที่สอง ไม่ลบออก
  if (!requireOwnerAuth(req, res, shopId, { enforce: true, requireOwnerRole: true })) return;

  const { data: shop, error: fetchErr } = await supabase
    .from('shop_profiles')
    .select('id, shop_name, owner_line_id')
    .eq('id', shopId)
    .maybeSingle();

  if (fetchErr) return res.status(500).json({ error: fetchErr.message });
  if (!shop) return res.status(404).json({ error: 'ไม่พบร้านค้านี้' });

  // ต้องเป็นเจ้าของร้านจริงเท่านั้นถึงจะลบได้ (แอดมินของร้านลบร้านที่ตัวเองแค่ดูแลอยู่ไม่ได้)
  if (shop.owner_line_id !== lineUserId) {
    return res.status(403).json({ error: 'คุณไม่ใช่เจ้าของร้านนี้ ไม่สามารถลบได้' });
  }

  // บังคับพิมพ์ชื่อร้านให้ตรงเป๊ะก่อนลบจริง (กันกดพลาด)
  if (confirmShopName.trim() !== (shop.shop_name || '').trim()) {
    return res.status(400).json({ error: 'ชื่อร้านที่พิมพ์ไม่ตรงกับชื่อร้านจริง กรุณาตรวจสอบอีกครั้ง' });
  }

  try {
    const result = await deleteShopCompletely(shopId);
    if (result.notFound) return res.status(404).json({ error: 'ไม่พบร้านค้านี้' });
    return res.status(200).json({ success: true, stripeCancelWarning: result.stripeCancelWarning });
  } catch (err) {
    console.error('[delete-shop] fatal error:', err.message);
    return res.status(500).json({ error: `ลบร้านไม่สำเร็จ: ${err.message}` });
  }
}
