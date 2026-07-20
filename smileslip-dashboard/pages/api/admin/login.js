/**
 * POST /api/admin/login
 * body: { email, password }  → login ด้วยบัญชีแอดมินส่วนตัว (company_admins)
 * body: { password }         → login ด้วยรหัสฉุกเฉินของทั้งบริษัท (ADMIN_PASSWORD, legacy fallback)
 *
 * คืน needsBootstrap: true ตอน login ด้วยรหัสฉุกเฉินสำเร็จ แต่ยังไม่มีบัญชีแอดมินส่วนตัวเลยสักคน
 * (หน้าเว็บจะโชว์ฟอร์มให้ตั้งบัญชีเจ้าของระบบคนแรกทันที)
 */
import { createClient } from '@supabase/supabase-js';
import { verifyPassword, signAdminToken, signLegacyAdminToken } from '../../../lib/admin-auth';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { email, password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'กรุณากรอกรหัสผ่าน' });

  try {
    if (email) {
      const { data, error } = await supabase
        .from('company_admins').select('*').eq('email', email).maybeSingle();
      if (error) {
        // ตารางอาจยังไม่ถูกสร้าง (รอรัน SQL) — แจ้งชัดเจนแทน error 500 ดิบ
        return res.status(500).json({ error: 'ยังไม่ได้ตั้งค่าระบบแอดมินหลายบัญชี (ต้องรัน SQL ก่อน) — ใช้รหัสฉุกเฉินแทนได้ชั่วคราว' });
      }
      if (!data) return res.status(401).json({ error: 'ไม่พบบัญชีแอดมินอีเมลนี้' });
      if (data.status !== 'active') return res.status(403).json({ error: 'บัญชีนี้ถูกระงับการใช้งานแล้ว' });
      if (!verifyPassword(password, data.password_hash)) return res.status(401).json({ error: 'รหัสผ่านไม่ถูกต้อง' });

      await supabase.from('company_admins').update({ last_login_at: new Date().toISOString() }).eq('id', data.id);
      const token = signAdminToken(data.id);
      return res.json({
        token,
        admin: { id: data.id, email: data.email, display_name: data.display_name, role: data.role },
      });
    }

    // ── รหัสฉุกเฉินของทั้งบริษัท (fallback) ──────────────────────────────────
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
    if (!ADMIN_PASSWORD) return res.status(500).json({ error: 'Admin password not configured' });
    if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'รหัสผ่านไม่ถูกต้อง' });

    const token = signLegacyAdminToken();
    // needsBootstrap = true เฉพาะตอนที่ query สำเร็จจริงและนับได้ 0 แถวเท่านั้น — ถ้าตารางยังไม่ถูกสร้าง
    // (รอรัน SQL) ต้อง "ไม่ใช้ head:true" เพราะพิสูจน์แล้วว่า Supabase คืน error:null/count:null/status 204
    // เสมอกับ head:true request แม้ตารางไม่มีอยู่จริงเลยก็ตาม (bug จริงที่เจอตอนทดสอบ) — ใช้ select ปกติแทน
    // ถึงจะได้ error PGRST205 กลับมาเวลาตารางยังไม่ถูกสร้างจริงๆ
    let needsBootstrap = false;
    try {
      const { count, error } = await supabase.from('company_admins').select('id', { count: 'exact' }).limit(1);
      if (!error) needsBootstrap = (count || 0) === 0;
    } catch { /* เก็บเป็น false ไว้ก่อน ปลอดภัยกว่า */ }

    return res.json({ token, admin: null, legacy: true, needsBootstrap });
  } catch (err) {
    console.error('[admin/login]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
