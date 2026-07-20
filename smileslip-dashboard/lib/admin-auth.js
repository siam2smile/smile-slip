/**
 * ระบบยืนยันตัวตนแอดมินบริษัท (multi-admin) — เพิ่ม 2026-07-20
 *
 * เดิม /admin ใช้รหัสผ่านเดียว (ADMIN_PASSWORD) ร่วมกันทั้งบริษัท ไม่มีตัวตนผู้ใช้เลย
 * ตอนนี้แต่ละคนมีบัญชีอีเมล/รหัสผ่านของตัวเอง (ตาราง company_admins) แบ่ง 2 บทบาท:
 *   - owner: จัดการแอดมินคนอื่นได้ (เพิ่ม/ระงับ/เปลี่ยนสิทธิ์/ตั้งรหัสผ่านให้คนอื่น) + ใช้งานทุกอย่างในระบบ
 *   - staff: ใช้งานทุกอย่างในระบบเหมือนกัน ยกเว้นจัดการแอดมินคนอื่น
 * ADMIN_PASSWORD (env) ยังคงใช้ได้เป็น "รหัสฉุกเฉิน" ของทั้งบริษัท (ผู้ใช้ยืนยันให้เก็บไว้)
 * — token ที่ได้จากรหัสฉุกเฉินไม่ผูกกับตัวตนใคร จึงใช้จัดการแอดมินคนอื่นไม่ได้
 *
 * สำคัญ: token ยังขึ้นต้นด้วย "smileslip-admin:" เหมือนเดิมทุกตัวอักษร (แค่เปลี่ยนข้อมูลหลัง prefix)
 * เพื่อไม่ให้กระทบ verifyAdmin() ที่ copy กระจายอยู่ ~12 ไฟล์ API admin เดิม (เช็คแค่ prefix เท่านั้น
 * ไม่ต้องแก้ไฟล์เหล่านั้นเลยสักไฟล์) — ไฟล์ใหม่ที่ต้องรู้ตัวตนจริง (เช่น admins.js) ให้ใช้
 * verifyAdminRequest() ในไฟล์นี้แทน
 */
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  try {
    const [salt, hash] = stored.split(':');
    const newHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return newHash === hash;
  } catch {
    return false;
  }
}

export function signAdminToken(adminId) {
  return Buffer.from(`smileslip-admin:${adminId}:${Date.now()}`).toString('base64');
}

export function signLegacyAdminToken() {
  return Buffer.from(`smileslip-admin:legacy:${Date.now()}`).toString('base64');
}

// คืน { ok, admin } — ok=false ถ้า token ผิดรูปแบบ/ไม่มี, admin=null ถ้าเป็น token รหัสฉุกเฉิน
// (ไม่ผูกตัวตน) หรือ admin นั้นถูกระงับ/ลบไปแล้ว
export async function verifyAdminRequest(req) {
  const token = req.headers['x-admin-token'];
  if (!token) return { ok: false, admin: null };
  let decoded;
  try {
    decoded = Buffer.from(token, 'base64').toString('utf8');
  } catch {
    return { ok: false, admin: null };
  }
  if (!decoded.startsWith('smileslip-admin:')) return { ok: false, admin: null };

  const adminId = decoded.split(':')[1];
  if (!adminId || !/^[0-9a-f-]{36}$/i.test(adminId)) {
    return { ok: true, admin: null }; // รหัสฉุกเฉิน — token ถูกต้องแต่ไม่มีตัวตน
  }

  const { data } = await supabase
    .from('company_admins')
    .select('id, email, display_name, role, status')
    .eq('id', adminId)
    .maybeSingle();
  if (!data || data.status !== 'active') return { ok: true, admin: null };
  return { ok: true, admin: data };
}

// กันไม่ให้ระงับ/ลดสิทธิ์ owner คนสุดท้ายจนไม่มีใครจัดการระบบได้เลย
// (เรียกใช้หลังจาก verifyAdminRequest หาแอดมินจริงเจอแล้วเท่านั้น จึงมั่นใจได้ว่าตารางมีอยู่จริง —
// ไม่ใช้ head:true เพราะพิสูจน์แล้วว่า Supabase คืน error:null/count:null เสมอแม้ตารางไม่มีอยู่จริง)
export async function countActiveOwners(excludeId = null) {
  let q = supabase.from('company_admins').select('id', { count: 'exact' })
    .eq('role', 'owner').eq('status', 'active');
  if (excludeId) q = q.neq('id', excludeId);
  const { count } = await q;
  return count || 0;
}
