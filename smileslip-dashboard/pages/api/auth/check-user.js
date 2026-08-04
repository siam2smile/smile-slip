import { getRolesForLineId } from '../../../lib/identity';
import { issueOwnerSession } from '../../../lib/owner-session';

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
  if (!roles.length) return res.status(200).json({ exists: false, roles: [] });

  const rolesWithSession = roles.map(r => ({
    ...r,
    ownerSession: issueOwnerSession({ shopId: r.shopId, ownerId: userId, role: r.role }),
  }));

  return res.status(200).json({ exists: true, roles: rolesWithSession });
}
