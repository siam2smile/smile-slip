-- Phase 5 — ผูก LINE userId ของลูกค้าเข้ากับการจอง (ผ่าน LINE Login OAuth, ดู
-- api/auth/line.js's intent=booking_link) + กันส่งแจ้งเตือนก่อนถึงนัดซ้ำจากการรัน cron
-- รายชั่วโมง (idempotent guard เดียวกับ pattern notify_weekly_last_sent/trial_day25_notified)
ALTER TABLE booking_reservations ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz;
