import { createClient } from '@supabase/supabase-js';
import { getRolesForLineId, getStaffShopsForLineId } from '../../../lib/identity';
import { issueOwnerSession } from '../../../lib/owner-session';
import { RETENTION_MONTHS } from '../../../lib/shop-deletion';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

/**
 * รองรับหลายบทบาทพร้อมกัน (เจ้าของร้านตัวเอง + แอดมินร้านอื่น) — คืน roles เป็น array เสมอ
 * (length 0 = ยังไม่มีบัญชี, 1 = เข้าร้านเดียวตามปกติ, 2+ = ให้ฝั่งเว็บโชว์ตัวเลือกให้กดเข้าร้านไหน)
 * เดิมเช็คเจ้าของก่อนแล้ว return ทันที ทำให้ถ้ากลายเป็นเจ้าของร้านตัวเองด้วย จะเข้าร้านที่เป็น
 * แอดมินอยู่ไม่ได้อีกเลยผ่านหน้า login ปกติ — แก้เป็นเก็บทุกบทบาทที่มีจริงแล้วคืนกลับให้หมด
 *
 * Owner-session: endpoint นี้คือจุดที่ `pages/login.js` เรียกทันทีหลัง `liff.getProfile()`
 * สำเร็จ (LIFF SDK ยืนยันตัวตนฝั่ง client แล้ว) จึงเป็นจุดที่เหมาะสมที่สุดในการออก owner-session
 * token ให้ทุก role ที่เจอ — known trade-off: endpoint นี้เปิดสาธารณะไม่มี auth ใดๆ (แค่ query
 * lookup) ดังนั้นใครก็ตามที่รู้ userId (LINE ID) ของเจ้าของร้านก็แลกเป็น token ได้เช่นกัน — ยอมรับ
 * ได้เพราะยังดีกว่าเดิมมาก (เดิม userId เปลือยๆ ใช้ได้กับทุก endpoint ตลอดไป ไม่มีวันหมดอายุ ส่วน
 * token ใหม่หมดอายุใน 30 วันและผูกกับ shopId เฉพาะ) เทียบเท่ากับที่ verify-pin.js ของพนักงานทำอยู่แล้ว
 * (ความลับที่พิสูจน์ตัวตนคือการ "รู้ค่า" ไม่ใช่ cryptographic proof เต็มรูปแบบ)
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'Missing userId' });

  const roles = await getRolesForLineId(userId);
  // พนักงาน (มี PIN ตั้งไว้แล้ว) อยู่ร้านไหนบ้าง — คนละระบบ auth จาก roles (owner-session)
  // แต่ต้องรวมกันในหน้า login ให้คนที่เป็นทั้งเจ้าของร้านหนึ่ง+พนักงานอีกร้านหนึ่งเลือกได้
  const staffShops = await getStaffShopsForLineId(userId);

  // ไม่มีบทบาทที่ active เลย (ทั้งเจ้าของ/แอดมิน/พนักงาน) — เช็คต่อว่ามีร้านที่เจ้าของ LINE ID นี้
  // เคย "ลบ" ไว้ (soft-delete, ข้อ 91) แล้วยังอยู่ในช่วงเก็บข้อมูล (RETENTION_MONTHS เดือน) อยู่ไหม
  // เพื่อให้ register.js เสนอกู้คืนได้ (แยก query ต่างหากจาก getRolesForLineId() โดยเจตนา เพราะที่นั่น
  // ต้องกรอง deleted_at ออกเสมอสำหรับ login ปกติ — จุดนี้จุดเดียวที่ต้องมองเห็นร้านที่ลบไปแล้ว)
  if (!roles.length && !staffShops.length) {
    let deletedShop = null;
    try {
      const cutoffIso = new Date(Date.now() - RETENTION_MONTHS * 30 * 24 * 3600 * 1000).toISOString();
      const { data } = await supabase
        .from('shop_profiles')
        .select('id, shop_name, deleted_at')
        .eq('owner_line_id', userId)
        .not('deleted_at', 'is', null)
        .gt('deleted_at', cutoffIso)
        .order('deleted_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) deletedShop = { shopId: data.id, shopName: data.shop_name, deletedAt: data.deleted_at };
    } catch (e) { console.error('[check-user] deletedShop lookup failed:', e.message); }
    return res.status(200).json({ exists: false, roles: [], deletedShop });
  }

  const rolesWithSession = roles.map(r => ({
    ...r,
    ownerSession: issueOwnerSession({ shopId: r.shopId, ownerId: userId, role: r.role }),
  }));

  // staff entry ไม่มี owner-session (คนละระบบ auth — ต้องพิสูจน์ตัวตนด้วย PIN ที่ /pos-staff เสมอ
  // แค่รู้ LINE ID ไม่พอ) แค่พอให้ login.js รู้ว่ามีตัวเลือกนี้อยู่ + จะพาไปหน้าไหน
  const staffRoles = staffShops.map(s => ({
    shopId: s.shopId, shopName: s.shopName, role: 'staff',
    staffId: s.staffId, staffName: s.staffName, branchName: s.branchName,
  }));

  return res.status(200).json({ exists: true, roles: [...rolesWithSession, ...staffRoles] });
}
