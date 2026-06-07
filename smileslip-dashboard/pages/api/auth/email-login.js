import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

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
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'กรุณากรอกอีเมลและรหัสผ่าน' });

  const { data, error } = await supabase
    .from('shop_profiles')
    .select('owner_line_id, password_hash')
    .eq('email', email)
    .maybeSingle();

  if (!data) return res.status(404).json({ error: 'ไม่พบบัญชีที่ใช้อีเมลนี้ กรุณาตรวจสอบหรือสมัครใหม่ผ่าน LINE' });

  // ถ้ายังไม่มี password_hash (ผู้ใช้เก่าที่สมัครก่อนระบบนี้)
  if (!data.password_hash) {
    return res.status(401).json({ error: 'บัญชีนี้ยังไม่ได้ตั้งรหัสผ่าน กรุณาเข้าสู่ระบบด้วย LINE แล้วตั้งรหัสผ่านใหม่ในหน้าตั้งค่า' });
  }

  if (!verifyPassword(password, data.password_hash)) {
    return res.status(401).json({ error: 'รหัสผ่านไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง' });
  }

  return res.status(200).json({ userId: data.owner_line_id });
}
