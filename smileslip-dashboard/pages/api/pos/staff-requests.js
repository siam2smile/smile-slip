/**
 * GET   /api/pos/staff-requests?shopId              → คำขอสมัครพนักงานส่ง/ผู้จัดการสาขาทั้งหมด
 * PATCH /api/pos/staff-requests { shopId, requestId, action: 'approve'|'reject' }
 *
 * มาจาก #สมัครพนักงานขนส่ง / #สมัครผู้จัดการสาขา ในกลุ่ม LINE ของแต่ละสาขา (บอทเขียนลง
 * ตาราง branch_role_requests เป็น status: pending) — เจ้าของร้าน/แอดมินมาอนุมัติที่นี่
 *
 * อนุมัติ delivery_staff → สร้างแถวใน pos_staff ทันที (ใช้งานได้เลย)
 * อนุมัติ branch_manager → แค่เปลี่ยนสถานะ (ยังไม่มีระบบสิทธิ์แยกตามสาขาต่างหาก)
 *
 * Phase 2 (write-primary flip, 2026-07-29): sync เข้า Supabase (pos_staff) แทน Google Sheets แล้ว
 */
import { createClient } from '@supabase/supabase-js';
import { makeStaffId } from '../../../lib/google-pos';
import { blockIfTrialExpired } from '../../../lib/shop-access';
import { requirePermission } from '../../../lib/pos-auth';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

// ส่งลิงก์ "ตั้งรหัส PIN" ให้พนักงานหลังได้รับการอนุมัติ — ลิงก์นี้เองคือตัวยืนยันตัวตน
async function sendPinSetupLink(lineId, shopId, staffId, staffName) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token || !lineId) return;
  const url = `${process.env.FRONTEND_URL}/pos-staff?shopId=${shopId}&staff_id=${staffId}&setpin=1`;
  const message = {
    type: 'text',
    text: `✅ อนุมัติแล้ว! ตั้งรหัส PIN ส่วนตัวของคุณ${staffName ? ` (${staffName})` : ''}\nใช้ PIN นี้เข้าหน้าพนักงานได้เลย ตั้งได้ที่ลิงก์นี้:\n${url}`,
  };
  try {
    await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: lineId, messages: [message] }),
    });
  } catch (err) {
    console.error('[staff-requests] sendPinSetupLink error:', err.message);
  }
}

export default async function handler(req, res) {
  const shopId = req.query.shopId || req.body?.shopId;
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });

  // เขียนไม่ได้ถ้าทดลองใช้ 30 วันหมดอายุแล้ว (อ่าน/GET ยังทำได้ปกติเสมอ)
  if (req.method !== 'GET' && (await blockIfTrialExpired(req, res, shopId))) return;

  // ── GET ───────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('branch_role_requests')
      .select('*')
      .eq('shop_id', shopId)
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ requests: data || [] });
  }

  // ── PATCH — อนุมัติ/ปฏิเสธ ──────────────────────────────────────────────
  if (req.method === 'PATCH') {
    // อนุมัติคำขอ = สร้างพนักงานใหม่จริง (สิทธิ์เดียวกับ staff.js) กันพนักงานที่ถือ session
    // ใดๆ ก็ตามอนุมัติคำขอสมัครให้ตัวเอง/พรรคพวกได้เอง
    if (!(await requirePermission(req, res, shopId, 'perm_manage_staff'))) return;
    const { requestId, action } = req.body;
    if (!requestId || !['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Missing requestId or invalid action' });
    }

    const { data: reqRow, error: fetchErr } = await supabase
      .from('branch_role_requests').select('*').eq('id', requestId).eq('shop_id', shopId).single();
    if (fetchErr || !reqRow) return res.status(404).json({ error: 'ไม่พบคำขอ' });

    if (action === 'reject') {
      const { error } = await supabase.from('branch_role_requests')
        .update({ status: 'rejected' }).eq('id', requestId);
      if (error) return res.status(500).json({ error: error.message });
      return res.json({ ok: true });
    }

    // approve
    if (reqRow.role === 'delivery_staff') {
      try {
        const staff_id = makeStaffId();
        const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
        const { error } = await supabase.from('pos_staff').insert({
          shop_id: shopId, staff_id, name: reqRow.display_name || 'พนักงานส่ง',
          phone: '', line_id: reqRow.line_user_id, role: 'พนักงานส่ง', notes: '',
          branch_name: reqRow.branch_name || '', staff_created_at: now,
        });
        if (error) throw error;
        sendPinSetupLink(reqRow.line_user_id, shopId, staff_id, reqRow.display_name).catch(() => {});
      } catch (err) {
        console.error('[staff-requests] sync to pos_staff failed:', err.message);
        return res.status(500).json({ error: 'อนุมัติไม่สำเร็จ: ' + err.message });
      }
    }

    const { error } = await supabase.from('branch_role_requests')
      .update({ status: 'approved', approved_at: new Date().toISOString() }).eq('id', requestId);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
