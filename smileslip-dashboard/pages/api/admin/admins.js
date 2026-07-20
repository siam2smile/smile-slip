/**
 * GET   /api/admin/admins            → รายชื่อแอดมินทั้งหมด (เฉพาะ owner)
 * POST  /api/admin/admins            → เพิ่มแอดมินใหม่ (เฉพาะ owner) หรือ bootstrap คนแรก
 *   body ปกติ: { email, password, display_name, role }
 *   body bootstrap (ตอนยังไม่มีแอดมินเลย): { email, password, display_name, bootstrapPassword }
 *     — bootstrapPassword ต้องตรงกับ ADMIN_PASSWORD (พิสูจน์ว่าเป็นคนที่มีรหัสฉุกเฉินจริง)
 * PATCH /api/admin/admins            → แก้ไข { id, display_name?, role?, status?, new_password?, current_password? }
 *   - แก้ข้อมูลตัวเอง (display_name/รหัสผ่านตัวเอง) ทำได้เสมอ (ต้องกรอก current_password ถ้าจะเปลี่ยนรหัส)
 *   - เปลี่ยน role/status ของใคร หรือ ตั้งรหัสผ่านให้คนอื่น ต้องเป็น owner เท่านั้น
 *   - ห้ามระงับ/ลดสิทธิ์ owner คนสุดท้ายของระบบ (กันล็อกตัวเองออกจากระบบทั้งหมด)
 */
import { createClient } from '@supabase/supabase-js';
import { hashPassword, verifyPassword, verifyAdminRequest, countActiveOwners } from '../../../lib/admin-auth';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const { admin } = await verifyAdminRequest(req);
      if (!admin || admin.role !== 'owner') return res.status(403).json({ error: 'เฉพาะเจ้าของระบบเท่านั้นที่ดูรายชื่อแอดมินได้' });
      const { data, error } = await supabase
        .from('company_admins')
        .select('id, email, display_name, role, status, created_at, last_login_at')
        .order('created_at', { ascending: true });
      if (error) throw error;
      return res.json({ admins: data || [] });
    }

    if (req.method === 'POST') {
      const { email, password, display_name, role = 'staff', bootstrapPassword } = req.body || {};
      if (!email || !password) return res.status(400).json({ error: 'กรุณากรอกอีเมลและรหัสผ่าน' });
      if (password.length < 8) return res.status(400).json({ error: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร' });

      // ห้ามใช้ head:true — Supabase คืน error:null/count:null เสมอแม้ตารางไม่มีอยู่จริง (bug จริงที่เจอตอนทดสอบ)
      const { count, error: countErr } = await supabase.from('company_admins').select('id', { count: 'exact' }).limit(1);
      if (countErr) return res.status(500).json({ error: 'ยังไม่ได้สร้างตาราง company_admins — ต้องรัน SQL ก่อน (ดู CLAUDE.md)' });

      if ((count || 0) === 0) {
        // ── Bootstrap เจ้าของระบบคนแรก — พิสูจน์ตัวด้วยรหัสฉุกเฉินเดิมก่อนเสมอ ──
        if (!bootstrapPassword || bootstrapPassword !== process.env.ADMIN_PASSWORD) {
          return res.status(403).json({ error: 'ต้องยืนยันด้วยรหัสผ่านแอดมิน (ฉุกเฉิน) เดิมก่อนตั้งบัญชีแรก' });
        }
        const { data: created, error } = await supabase.from('company_admins')
          .insert({ email, password_hash: hashPassword(password), display_name: display_name || email, role: 'owner', status: 'active' })
          .select().single();
        if (error) throw error;
        return res.json({ ok: true, admin: { id: created.id, email: created.email, role: created.role } });
      }

      // ── เพิ่มแอดมินคนใหม่ตามปกติ — ต้องเป็น owner เท่านั้น ──
      const { admin } = await verifyAdminRequest(req);
      if (!admin || admin.role !== 'owner') return res.status(403).json({ error: 'เฉพาะเจ้าของระบบเท่านั้นที่เพิ่มแอดมินใหม่ได้' });
      if (!['owner', 'staff'].includes(role)) return res.status(400).json({ error: 'สิทธิ์ไม่ถูกต้อง' });

      const { data: existing } = await supabase.from('company_admins').select('id').eq('email', email).maybeSingle();
      if (existing) return res.status(409).json({ error: 'มีอีเมลนี้อยู่ในระบบแล้ว' });

      const { data: created, error } = await supabase.from('company_admins')
        .insert({ email, password_hash: hashPassword(password), display_name: display_name || email, role, status: 'active', created_by: admin.id })
        .select().single();
      if (error) throw error;
      return res.json({ ok: true, admin: { id: created.id, email: created.email, role: created.role } });
    }

    if (req.method === 'PATCH') {
      const { id, display_name, role, status, new_password, current_password } = req.body || {};
      if (!id) return res.status(400).json({ error: 'Missing id' });

      const { admin } = await verifyAdminRequest(req);
      if (!admin) return res.status(403).json({ error: 'ต้อง login ด้วยบัญชีอีเมลของตัวเอง ไม่ใช่รหัสฉุกเฉิน' });

      const isSelf = admin.id === id;
      if (!isSelf && admin.role !== 'owner') return res.status(403).json({ error: 'แก้ไขได้เฉพาะบัญชีตัวเอง หรือต้องเป็นเจ้าของระบบ' });

      const { data: target } = await supabase.from('company_admins').select('*').eq('id', id).maybeSingle();
      if (!target) return res.status(404).json({ error: 'ไม่พบบัญชีนี้' });

      const updates = {};
      if (display_name !== undefined) updates.display_name = display_name;

      if (role !== undefined && role !== target.role) {
        if (admin.role !== 'owner') return res.status(403).json({ error: 'เฉพาะเจ้าของระบบเท่านั้นที่เปลี่ยนสิทธิ์ได้' });
        if (target.role === 'owner' && role !== 'owner' && (await countActiveOwners(target.id)) === 0) {
          return res.status(400).json({ error: 'ไม่สามารถลดสิทธิ์เจ้าของระบบคนสุดท้ายได้ — ต้องมี owner เหลืออย่างน้อย 1 คนเสมอ' });
        }
        updates.role = role;
      }

      if (status !== undefined && status !== target.status) {
        if (admin.role !== 'owner') return res.status(403).json({ error: 'เฉพาะเจ้าของระบบเท่านั้นที่ระงับ/เปิดใช้งานบัญชีได้' });
        if (status === 'disabled') {
          if (isSelf) return res.status(400).json({ error: 'ระงับบัญชีตัวเองไม่ได้' });
          if (target.role === 'owner' && (await countActiveOwners(target.id)) === 0) {
            return res.status(400).json({ error: 'ไม่สามารถระงับเจ้าของระบบคนสุดท้ายได้' });
          }
        }
        updates.status = status;
      }

      if (new_password) {
        if (new_password.length < 8) return res.status(400).json({ error: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร' });
        if (isSelf) {
          if (!current_password || !verifyPassword(current_password, target.password_hash)) {
            return res.status(401).json({ error: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' });
          }
        } else if (admin.role !== 'owner') {
          return res.status(403).json({ error: 'เฉพาะเจ้าของระบบเท่านั้นที่ตั้งรหัสผ่านให้คนอื่นได้' });
        }
        updates.password_hash = hashPassword(new_password);
      }

      if (!Object.keys(updates).length) return res.status(400).json({ error: 'ไม่มีข้อมูลให้แก้ไข' });

      const { error } = await supabase.from('company_admins').update(updates).eq('id', id);
      if (error) throw error;
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[admin/admins]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
