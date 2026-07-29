/**
 * GET    /api/pos/staff?shopId          → รายชื่อพนักงาน/คนส่ง
 * POST   /api/pos/staff { shopId, name, phone, line_id, role, notes }
 *   → ถ้ามี line_id จะส่งลิงก์ "ตั้งรหัส PIN" ให้พนักงานทาง LINE ทันที
 * PATCH  /api/pos/staff { shopId, staff_id, ...fields, reset_pin, resend_pin_link }
 *   → reset_pin: true = ล้าง PIN เดิมทิ้ง (กันพนักงานที่ออกจากงานแล้วแอบเข้า)
 *   → resend_pin_link: true = ส่งลิงก์ตั้งรหัส PIN ใหม่อีกครั้ง (ต้องมี line_id อยู่แล้ว)
 * DELETE /api/pos/staff { shopId, staff_id }
 *
 * Phase 2 (write-primary flip, 2026-07-29): อ่าน/เขียนจาก Supabase (pos_staff) โดยตรงแล้ว
 * ไม่ผ่าน Google Sheets/Google connection อีกต่อไป — ตาราง pos_staff ไม่เคย backfill ข้อมูลเก่า
 * ที่มีอยู่ใน Sheets เลย (ตามธรรมเนียม migration นี้ทั้งหมด) ต้องสร้างพนักงานใหม่ผ่านหน้านี้
 */
import { supabase } from '../../../lib/supabase-pos';
import { blockIfTrialExpired } from '../../../lib/shop-access';
import { requirePermission } from '../../../lib/pos-auth';
import { makeStaffId, staffFromRow } from '../../../lib/google-pos';

// ส่งลิงก์ "ตั้งรหัส PIN" ให้พนักงานทาง LINE — ลิงก์นี้เองคือตัวยืนยันตัวตน (ส่งหาแค่ line_id
// เจ้าของ PIN เท่านั้น) เหมือน pattern เดียวกับลิงก์ยืนยันงานจัดส่ง/เก็บเงินที่มีอยู่แล้ว
async function sendPinSetupLink(lineId, shopId, staffId, staffName) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token || !lineId) return;
  const url = `${process.env.FRONTEND_URL}/pos-staff?shopId=${shopId}&staff_id=${staffId}&setpin=1`;
  const message = {
    type: 'text',
    text: `🔐 ตั้งรหัส PIN ส่วนตัวของคุณ${staffName ? ` (${staffName})` : ''}\nใช้ PIN นี้เข้าหน้าพนักงานแทนรหัสเดิมของร้าน ตั้งได้ที่ลิงก์นี้เลยค่ะ:\n${url}`,
  };
  try {
    await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: lineId, messages: [message] }),
    });
  } catch (err) {
    console.error('[staff] sendPinSetupLink error:', err.message);
  }
}

export default async function handler(req, res) {
  const shopId = req.query.shopId || req.body?.shopId;
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });

  // เขียนไม่ได้ถ้าทดลองใช้ 30 วันหมดอายุแล้ว (อ่าน/GET ยังทำได้ปกติเสมอ)
  if (req.method !== 'GET' && (await blockIfTrialExpired(req, res, shopId))) return;

  // การจัดการพนักงาน (เพิ่ม/แก้ไข/ลบ) ต้องมีสิทธิ์ perm_manage_staff ถ้าเรียกจาก session
  // แคชเชียร์/พนักงาน (ไม่มี header = เจ้าของ/แอดมิน ทำงานเหมือนเดิมทุกประการ) — นี่คือ
  // endpoint ที่ตั้งค่าสิทธิ์เอง จึงต้องเข้มงวดเป็นพิเศษ กันพนักงานเปิดสิทธิ์ให้ตัวเองหรือคนอื่น
  if (req.method !== 'GET' && !(await requirePermission(req, res, shopId, 'perm_manage_staff'))) return;

  try {
    // ── GET ─────────────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      const { data, error } = await supabase.from('pos_staff').select('*')
        .eq('shop_id', shopId).is('deleted_at', null).order('created_at', { ascending: true });
      if (error) throw error;
      const staff = (data || []).map(staffFromRow).filter(s => s.staff_id && s.name);
      return res.json({ staff });
    }

    // ── POST ─────────────────────────────────────────────────────────────────
    if (req.method === 'POST') {
      const {
        name, phone = '', line_id = '', role = 'พนักงานส่ง', notes = '', branch_name = '',
        perm_view_revenue = false, perm_view_pl = false, perm_manage_stock = false, perm_export_vat = false,
        perm_process_sales = false, perm_void_sales = false, perm_manage_customers = false, perm_manage_expenses = false,
        perm_manage_delivery = false, perm_manage_receiving = false, perm_issue_tax_invoice = false, perm_manage_staff = false,
      } = req.body;
      if (!name) return res.status(400).json({ error: 'ต้องระบุชื่อ' });

      const staff_id = makeStaffId();
      const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
      const { error } = await supabase.from('pos_staff').insert({
        shop_id: shopId, staff_id, name, phone, line_id, role, notes, branch_name,
        staff_created_at: now,
        perm_view_revenue, perm_view_pl, perm_manage_stock, perm_export_vat,
        perm_process_sales, perm_void_sales, perm_manage_customers, perm_manage_expenses,
        perm_manage_delivery, perm_manage_receiving, perm_issue_tax_invoice, perm_manage_staff,
      });
      if (error) throw error;

      if (line_id) sendPinSetupLink(line_id, shopId, staff_id, name).catch(() => {});
      return res.json({ ok: true, staff_id, name });
    }

    // ── PATCH ────────────────────────────────────────────────────────────────
    if (req.method === 'PATCH') {
      const {
        staff_id, name, phone, line_id, role, notes, branch_name, reset_pin, resend_pin_link,
        perm_view_revenue, perm_view_pl, perm_manage_stock, perm_export_vat,
        perm_process_sales, perm_void_sales, perm_manage_customers, perm_manage_expenses,
        perm_manage_delivery, perm_manage_receiving, perm_issue_tax_invoice, perm_manage_staff,
      } = req.body;
      if (!staff_id) return res.status(400).json({ error: 'Missing staff_id' });

      const { data: existing, error: fetchErr } = await supabase.from('pos_staff').select('*')
        .eq('shop_id', shopId).eq('staff_id', staff_id).is('deleted_at', null).maybeSingle();
      if (fetchErr) throw fetchErr;
      if (!existing) return res.status(404).json({ error: 'ไม่พบพนักงาน' });

      const updates = {};
      if (name        !== undefined) updates.name = name;
      if (phone       !== undefined) updates.phone = phone;
      if (line_id     !== undefined) updates.line_id = line_id;
      if (role        !== undefined) updates.role = role;
      if (notes       !== undefined) updates.notes = notes;
      if (branch_name !== undefined) updates.branch_name = branch_name;
      // รีเซ็ต PIN — กันพนักงานที่ออกจากงานแล้วแอบใช้ PIN เดิมเข้าระบบ ต้องตั้งใหม่ถึงจะเข้าได้
      if (reset_pin) updates.pin = null;
      if (perm_view_revenue      !== undefined) updates.perm_view_revenue = perm_view_revenue;
      if (perm_view_pl           !== undefined) updates.perm_view_pl = perm_view_pl;
      if (perm_manage_stock      !== undefined) updates.perm_manage_stock = perm_manage_stock;
      if (perm_export_vat        !== undefined) updates.perm_export_vat = perm_export_vat;
      if (perm_process_sales     !== undefined) updates.perm_process_sales = perm_process_sales;
      if (perm_void_sales        !== undefined) updates.perm_void_sales = perm_void_sales;
      if (perm_manage_customers  !== undefined) updates.perm_manage_customers = perm_manage_customers;
      if (perm_manage_expenses   !== undefined) updates.perm_manage_expenses = perm_manage_expenses;
      if (perm_manage_delivery   !== undefined) updates.perm_manage_delivery = perm_manage_delivery;
      if (perm_manage_receiving  !== undefined) updates.perm_manage_receiving = perm_manage_receiving;
      if (perm_issue_tax_invoice !== undefined) updates.perm_issue_tax_invoice = perm_issue_tax_invoice;
      if (perm_manage_staff      !== undefined) updates.perm_manage_staff = perm_manage_staff;

      const { error } = await supabase.from('pos_staff').update(updates)
        .eq('shop_id', shopId).eq('staff_id', staff_id);
      if (error) throw error;

      if (resend_pin_link) {
        const lineIdForPush = line_id !== undefined ? line_id : existing.line_id;
        const nameForPush = name !== undefined ? name : existing.name;
        if (lineIdForPush) sendPinSetupLink(lineIdForPush, shopId, staff_id, nameForPush).catch(() => {});
      }

      return res.json({ ok: true, staff_id });
    }

    // ── DELETE ───────────────────────────────────────────────────────────────
    if (req.method === 'DELETE') {
      const { staff_id } = req.body;
      if (!staff_id) return res.status(400).json({ error: 'Missing staff_id' });

      const { data: existing, error: fetchErr } = await supabase.from('pos_staff').select('staff_id')
        .eq('shop_id', shopId).eq('staff_id', staff_id).is('deleted_at', null).maybeSingle();
      if (fetchErr) throw fetchErr;
      if (!existing) return res.status(404).json({ error: 'ไม่พบพนักงาน' });

      const { error } = await supabase.from('pos_staff')
        .update({ deleted_at: new Date().toISOString() })
        .eq('shop_id', shopId).eq('staff_id', staff_id);
      if (error) throw error;
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('[pos/staff]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
