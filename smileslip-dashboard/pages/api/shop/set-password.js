import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { requireOwnerAuth } from '../../../lib/owner-auth';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

// ต้องตรงกับ hashPassword ใน register.js และ verifyPassword ใน email-login.js เป๊ะ
// (รูปแบบ "salt:hash", pbkdf2 1000 รอบ sha512, 64 ไบต์) ไม่งั้น login ด้วยรหัสใหม่จะไม่ผ่าน
const hashPassword = (password) => {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
};

const verifyPassword = (password, stored) => {
  try {
    const [salt, hash] = stored.split(':');
    const newHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return newHash === hash;
  } catch {
    return false;
  }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { shopId, currentPassword, newPassword } = req.body;
  if (!shopId) return res.status(400).json({ error: 'ไม่พบ shopId' });
  if (!newPassword || newPassword.length < 6)
    return res.status(400).json({ error: 'รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร' });
  if (!requireOwnerAuth(req, res, shopId, { enforce: true })) return;

  const { data: profile, error: fetchErr } = await supabase
    .from('shop_profiles')
    .select('password_hash')
    .eq('id', shopId)
    .maybeSingle();
  if (fetchErr) return res.status(500).json({ error: fetchErr.message });
  if (!profile) return res.status(404).json({ error: 'ไม่พบข้อมูลร้านค้า' });

  // ถ้าเคยตั้งรหัสผ่านไว้แล้ว ต้องยืนยันรหัสเดิมก่อนเสมอ (กัน owner-session ที่หลุดถูกใช้เปลี่ยน
  // รหัสผ่าน login แบบเงียบๆ) — ถ้ายังไม่เคยตั้งเลย (password_hash เป็น null, เช่น สมัครผ่าน LINE
  // ล้วนๆ ไม่เคยผ่านหน้านี้มาก่อน) ข้ามได้เลย เพราะ owner-session เองก็พิสูจน์ตัวตนแล้วว่าเป็น
  // เจ้าของร้านจริง
  if (profile.password_hash) {
    if (!currentPassword) return res.status(400).json({ error: 'กรุณากรอกรหัสผ่านเดิม' });
    if (!verifyPassword(currentPassword, profile.password_hash))
      return res.status(401).json({ error: 'รหัสผ่านเดิมไม่ถูกต้อง' });
  }

  const { error } = await supabase
    .from('shop_profiles')
    .update({ password_hash: hashPassword(newPassword) })
    .eq('id', shopId);

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ success: true });
}
