import { getRolesForLineId } from '../../../lib/identity';

/**
 * รองรับหลายบทบาทพร้อมกัน (เจ้าของร้านตัวเอง + แอดมินร้านอื่น) — คืน roles เป็น array เสมอ
 * (length 0 = ยังไม่มีบัญชี, 1 = เข้าร้านเดียวตามปกติ, 2+ = ให้ฝั่งเว็บโชว์ตัวเลือกให้กดเข้าร้านไหน)
 * เดิมเช็คเจ้าของก่อนแล้ว return ทันที ทำให้ถ้ากลายเป็นเจ้าของร้านตัวเองด้วย จะเข้าร้านที่เป็น
 * แอดมินอยู่ไม่ได้อีกเลยผ่านหน้า login ปกติ — แก้เป็นเก็บทุกบทบาทที่มีจริงแล้วคืนกลับให้หมด
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'Missing userId' });

  const roles = await getRolesForLineId(userId);
  if (!roles.length) return res.status(200).json({ exists: false, roles: [] });

  return res.status(200).json({ exists: true, roles });
}
