/**
 * ตรวจสอบว่าไลไอดีหนึ่งๆ ผูกกับร้านไหนบ้าง ในบทบาทอะไร — รองรับหลายบทบาทพร้อมกันจริงจัง
 * (เจ้าของร้านตัวเอง + แอดมินร้านอื่น พร้อมกันได้) แทนที่ตรรกะเดิมที่เช็คเจ้าของก่อนเสมอ
 * แล้ว return ทันที (ทำให้เข้าแอดมินร้านอื่นไม่ได้อีกเลยถ้ากลายเป็นเจ้าของร้านตัวเองด้วย)
 *
 * สำคัญ: ใช้ .eq() ธรรมดา ไม่ใช้ .single()/.maybeSingle() เพราะสองอันนั้นจะ error ทันที
 * ถ้ามีมากกว่า 1 แถวตรงกัน (ซึ่งเคยเกิดขึ้นได้จริงจากบั๊กเดิมใน auth/line.js ที่ insert
 * ร้านซ้ำแบบไม่รู้ตัว) — ฟังก์ชันนี้ต้องทนทานต่อ 0, 1, หรือ 2+ แถว โดยไม่พังเงียบๆ
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

export async function getRolesForLineId(lineUserId) {
  const roles = [];
  if (!lineUserId) return roles;

  // 1. เป็นเจ้าของร้านไหนบ้าง (ปกติมีแค่ 1 แถว แต่ทนทานถ้าเจอ 2+ จากข้อมูลเก่าที่อาจซ้ำ)
  // กรอง deleted_at ออก — ร้านที่ถูก soft-delete (ข้อ "6-month retention", 2026-08-16) ต้อง
  // มองไม่เห็นเลยจากมุมมอง login/register ปกติ (การตรวจหาร้านที่ soft-delete ไว้เพื่อเสนอกู้คืน
  // เป็นคนละ query แยกต่างหากใน check-user.js ไม่ปนกับฟังก์ชันนี้)
  const { data: ownedShops, error: ownerErr } = await supabase
    .from('shop_profiles')
    .select('id, shop_name, owner_line_id')
    .eq('owner_line_id', lineUserId)
    .is('deleted_at', null);

  if (ownerErr) {
    console.error('[identity] getRolesForLineId owner query error:', ownerErr.message);
  } else {
    for (const shop of (ownedShops || [])) {
      roles.push({ shopId: shop.id, shopName: shop.shop_name, ownerId: shop.owner_line_id, role: 'owner' });
    }
  }

  // 2. เป็นแอดมินร้านไหนบ้าง (เฉพาะที่อนุมัติแล้ว) — รองรับหลายร้านพร้อมกันอยู่แล้วในระดับ schema
  //    (unique constraint คือ (shop_id, line_user_id) ไม่ใช่ line_user_id เดี่ยวๆ)
  const { data: adminRows, error: adminErr } = await supabase
    .from('shop_admins')
    .select('shop_id, shop_profiles!inner(owner_line_id, shop_name, deleted_at)')
    .eq('line_user_id', lineUserId)
    .eq('status', 'approved');

  if (adminErr) {
    console.error('[identity] getRolesForLineId admin query error:', adminErr.message);
  } else {
    for (const row of (adminRows || [])) {
      if (row.shop_profiles.deleted_at) continue; // ร้านนี้ถูก soft-delete ไปแล้ว ไม่นับเป็นบทบาทที่ใช้งานได้
      roles.push({
        shopId: row.shop_id,
        shopName: row.shop_profiles.shop_name,
        ownerId: row.shop_profiles.owner_line_id,
        role: 'admin',
      });
    }
  }

  return roles;
}
