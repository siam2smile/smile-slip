/**
 * GET   /api/booking/reservations?shopId&date=YYYY-MM-DD | month=YYYY-MM | depositStatus=mismatch — เจ้าของ/แอดมิน
 *   date  → รายการทั้งวัน (ทุกสถานะ) เรียงตามเวลานัด — ใช้กับมุมมองปฏิทินรายวัน
 *   month → รายการทั้งเดือน (ทุกสถานะ) เรียงตามเวลานัด — ใช้กับมุมมองปฏิทินตาราง (คำนวณจำนวน
 *           รายการต่อวันฝั่งเว็บเองจากผลลัพธ์นี้ ไม่มีตารางสรุปแยกเก็บไว้ล่วงหน้า — pattern เดียวกับ
 *           ทุก report ในระบบที่คำนวณสดเสมอ ไม่ cache)
 *   depositStatus → รายการข้ามวันที่ที่ deposit_status ตรงกับที่ระบุ (ไม่กรองวัน) — ใช้กับคิว
 *                    "รอตรวจสอบมัดจำ" (deposit_status='mismatch') ที่ Phase 3 ทิ้งไว้ให้แอดมินตรวจ
 *   ระบุได้หลายตัวพร้อมกัน (AND) แต่ปกติฝั่งเว็บจะเรียกแยกกันตามมุมมองที่ใช้อยู่
 * PATCH /api/booking/reservations { shopId, booking_no, action } — เจ้าของ/แอดมิน
 *   action: 'confirm' | 'cancel' | 'no_show' | 'complete'
 *   - confirm: pending → confirmed (ยืนยันมือ — ใช้กับบริการไม่มัดจำ หรือ mismatch ที่ตรวจสลิปเองแล้ว
 *     ว่าถูกต้อง) ถ้ามีมัดจำและยังไม่เคย auto_confirmed จะตั้ง deposit_status='manual_confirmed' ด้วย
 *   - cancel: pending/confirmed → cancelled, คำนวณ % คืนเงินจาก cancellation_tiers ของวันนี้เทียบ
 *     วันนัดจริง (ไม่ใช่วันที่จองไว้แต่แรก)
 *   - no_show: pending/confirmed → no_show (เฉพาะนัดที่ถึงเวลาแล้ว) คำนวณ % คืนเงินจาก
 *     no_show_refund_pct ตรงๆ
 *   - complete: confirmed → completed (เฉพาะนัดที่ถึงเวลาแล้ว)
 */
import { createClient } from '@supabase/supabase-js';
import { requireOwnerAuth } from '../../../lib/owner-auth';
import { configFromRow, reservationFromRow, computeCancelRefundPct, bangkokMidnightUTC, bangkokTodayParts } from '../../../lib/booking';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  const body = req.method === 'GET' ? req.query : req.body;
  const { shopId } = body || {};
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });
  if (!requireOwnerAuth(req, res, shopId, { enforce: true })) return;

  if (req.method === 'GET') {
    const { date, month, depositStatus } = req.query;
    let query = supabase.from('booking_reservations').select('*').eq('shop_id', shopId);

    if (date) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date));
      if (!m) return res.status(400).json({ error: 'รูปแบบวันที่ไม่ถูกต้อง' });
      const dayStart = bangkokMidnightUTC(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10));
      const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000);
      query = query.gte('start_at', dayStart.toISOString()).lt('start_at', dayEnd.toISOString());
    }
    if (month) {
      const mm = /^(\d{4})-(\d{2})$/.exec(String(month));
      if (!mm) return res.status(400).json({ error: 'รูปแบบเดือนไม่ถูกต้อง' });
      const y = parseInt(mm[1], 10), mo = parseInt(mm[2], 10);
      const monthStart = bangkokMidnightUTC(y, mo, 1);
      const nextY = mo === 12 ? y + 1 : y;
      const nextMo = mo === 12 ? 1 : mo + 1;
      const monthEnd = bangkokMidnightUTC(nextY, nextMo, 1);
      query = query.gte('start_at', monthStart.toISOString()).lt('start_at', monthEnd.toISOString());
    }
    if (depositStatus) query = query.eq('deposit_status', depositStatus);
    if (!date && !month && !depositStatus) {
      // ไม่ระบุตัวกรองเลย — จำกัดไว้แค่ตั้งแต่วันนี้เป็นต้นไป กันดึงประวัติทั้งหมดมาทีเดียวถ้าเผลอลืมใส่ตัวกรอง
      const t = bangkokTodayParts();
      query = query.gte('start_at', bangkokMidnightUTC(t.year, t.month, t.day).toISOString());
    }

    query = query.order('start_at', { ascending: true });
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ reservations: (data || []).map(reservationFromRow) });
  }

  if (req.method === 'PATCH') {
    const { booking_no, action } = req.body || {};
    if (!booking_no || !action) return res.status(400).json({ error: 'ข้อมูลไม่ครบ' });
    if (!['confirm', 'cancel', 'no_show', 'complete'].includes(action)) return res.status(400).json({ error: 'action ไม่ถูกต้อง' });

    try {
      const [{ data: reservation }, { data: configRow }] = await Promise.all([
        supabase.from('booking_reservations').select('*').eq('shop_id', shopId).eq('booking_no', booking_no).maybeSingle(),
        supabase.from('booking_configs').select('*').eq('shop_id', shopId).maybeSingle(),
      ]);
      if (!reservation) return res.status(404).json({ error: 'ไม่พบรายการจองนี้' });
      const config = configFromRow(configRow) || configFromRow({});
      const now = new Date();
      const hasStarted = new Date(reservation.start_at) <= now;

      const updates = {};
      if (action === 'confirm') {
        if (reservation.status !== 'pending') return res.status(400).json({ error: 'ยืนยันได้เฉพาะรายการที่ยังรอดำเนินการเท่านั้น' });
        updates.status = 'confirmed';
        updates.confirmed_at = now.toISOString();
        if (reservation.deposit_required_amount > 0 && !['auto_confirmed', 'manual_confirmed'].includes(reservation.deposit_status)) {
          updates.deposit_status = 'manual_confirmed';
        }
      } else if (action === 'cancel') {
        if (!['pending', 'confirmed'].includes(reservation.status)) return res.status(400).json({ error: 'ยกเลิกได้เฉพาะรายการที่ยังไม่จบสถานะเท่านั้น' });
        updates.status = 'cancelled';
        updates.cancelled_at = now.toISOString();
        updates.cancel_refund_pct = computeCancelRefundPct(config, reservation.start_at, false);
      } else if (action === 'no_show') {
        if (!['pending', 'confirmed'].includes(reservation.status)) return res.status(400).json({ error: 'บันทึกเบี้ยวนัดได้เฉพาะรายการที่ยังไม่จบสถานะเท่านั้น' });
        if (!hasStarted) return res.status(400).json({ error: 'ยังไม่ถึงเวลานัด บันทึกเบี้ยวนัดไม่ได้' });
        updates.status = 'no_show';
        updates.cancelled_at = now.toISOString();
        updates.cancel_refund_pct = computeCancelRefundPct(config, reservation.start_at, true);
      } else if (action === 'complete') {
        if (reservation.status !== 'confirmed') return res.status(400).json({ error: 'ทำรายการสำเร็จได้เฉพาะรายการที่ยืนยันแล้วเท่านั้น' });
        if (!hasStarted) return res.status(400).json({ error: 'ยังไม่ถึงเวลานัด ทำรายการสำเร็จไม่ได้' });
        updates.status = 'completed';
      }

      const { error } = await supabase.from('booking_reservations').update(updates).eq('shop_id', shopId).eq('booking_no', booking_no);
      if (error) throw error;
      return res.json({ ok: true, ...updates });
    } catch (err) {
      console.error('[booking/reservations PATCH]', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  res.setHeader('Allow', ['GET', 'PATCH']);
  return res.status(405).json({ error: 'Method not allowed' });
}
