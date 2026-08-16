import { createClient } from '@supabase/supabase-js';
import { requireOwnerAuth } from '../../../lib/owner-auth';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

/**
 * GET   /api/shop/notification-settings?shopId  → อ่านค่าตั้งวัน/เวลาแจ้งเตือนสรุปยอด
 * PATCH /api/shop/notification-settings { shopId, notify_weekly_enabled, notify_weekly_day,
 *        notify_weekly_hour, notify_monthly_enabled, notify_monthly_day, notify_monthly_hour }
 *
 * ข้อ 93 — ให้เจ้าของร้านตั้งวัน+เวลาแจ้งเตือนสรุปยอดรายสัปดาห์/รายเดือนเองได้ (บอทเช็คค่านี้ทุก
 * ชั่วโมงใน /cron/weekly-summary + /cron/monthly-summary) — สรุปยอดรายวันไม่มีให้ตั้งเวลาที่นี่
 * เพราะเปลี่ยนเป็น trigger ตอนปิดกะเงินสดสุดท้ายของวันแทนแล้ว (ดู api/pos/cash-shifts.js)
 *
 * fail-safe ถ้ายังไม่ได้รัน SQL เพิ่มคอลัมน์ (scripts/notify-schedule-01-add-columns.sql) — GET คืน
 * ค่าเริ่มต้นเงียบๆ, PATCH คืน error สุภาพแทนที่จะ 500 ดิบ
 */
const DEFAULTS = {
  notify_weekly_enabled: true,
  notify_weekly_day: 1,
  notify_weekly_hour: 18,
  notify_monthly_enabled: false,
  notify_monthly_day: 1,
  notify_monthly_hour: 18,
};

export default async function handler(req, res) {
  const shopId = req.query.shopId || req.body?.shopId;
  if (!shopId) return res.status(400).json({ error: 'ไม่พบ shopId' });

  if (req.method === 'GET') {
    const { data, error } = await supabase.from('shop_profiles')
      .select('notify_weekly_enabled, notify_weekly_day, notify_weekly_hour, notify_monthly_enabled, notify_monthly_day, notify_monthly_hour')
      .eq('id', shopId).maybeSingle();
    if (error) {
      console.error('[notification-settings] GET failed, falling back to defaults:', error.message);
      return res.status(200).json({ settings: DEFAULTS, columnsReady: false });
    }
    return res.status(200).json({ settings: { ...DEFAULTS, ...(data || {}) }, columnsReady: true });
  }

  if (!requireOwnerAuth(req, res, shopId, { enforce: true })) return;

  if (req.method === 'PATCH') {
    const body = req.body || {};
    const updates = {};

    if (body.notify_weekly_enabled !== undefined) updates.notify_weekly_enabled = !!body.notify_weekly_enabled;
    if (body.notify_weekly_day !== undefined) {
      const d = parseInt(body.notify_weekly_day, 10);
      if (Number.isNaN(d) || d < 0 || d > 6) return res.status(400).json({ error: 'วันในสัปดาห์ต้องอยู่ระหว่าง 0-6' });
      updates.notify_weekly_day = d;
    }
    if (body.notify_weekly_hour !== undefined) {
      const h = parseInt(body.notify_weekly_hour, 10);
      if (Number.isNaN(h) || h < 0 || h > 23) return res.status(400).json({ error: 'ชั่วโมงต้องอยู่ระหว่าง 0-23' });
      updates.notify_weekly_hour = h;
    }
    if (body.notify_monthly_enabled !== undefined) updates.notify_monthly_enabled = !!body.notify_monthly_enabled;
    if (body.notify_monthly_day !== undefined) {
      const d = parseInt(body.notify_monthly_day, 10);
      if (Number.isNaN(d) || d < 1 || d > 28) return res.status(400).json({ error: 'วันที่ต้องอยู่ระหว่าง 1-28 (กันเดือนสั้นไม่มีวันนั้น)' });
      updates.notify_monthly_day = d;
    }
    if (body.notify_monthly_hour !== undefined) {
      const h = parseInt(body.notify_monthly_hour, 10);
      if (Number.isNaN(h) || h < 0 || h > 23) return res.status(400).json({ error: 'ชั่วโมงต้องอยู่ระหว่าง 0-23' });
      updates.notify_monthly_hour = h;
    }

    if (!Object.keys(updates).length) return res.status(400).json({ error: 'ไม่มีค่าที่จะบันทึก' });

    const { data, error } = await supabase.from('shop_profiles').update(updates).eq('id', shopId)
      .select('notify_weekly_enabled, notify_weekly_day, notify_weekly_hour, notify_monthly_enabled, notify_monthly_day, notify_monthly_hour')
      .maybeSingle();
    if (error) {
      console.error('[notification-settings] PATCH failed:', error.message);
      return res.status(500).json({ error: 'บันทึกไม่สำเร็จ อาจยังไม่ได้รัน SQL เพิ่มคอลัมน์ — ' + error.message });
    }
    return res.status(200).json({ settings: { ...DEFAULTS, ...(data || {}) } });
  }

  return res.status(405).end();
}
