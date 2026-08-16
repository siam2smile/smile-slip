-- ข้อ 93: ให้เจ้าของร้านตั้งวัน+เวลาแจ้งเตือนสรุปยอดรายสัปดาห์/รายเดือนเองได้ (หน้าแดชบอร์ด →
-- จัดการสาขา) แทนเวลาคงที่เดิม (จันทร์ 18:00 กรุงเทพ) + เพิ่มสรุปรายเดือนใหม่ (เดิมไม่มี)
--
-- ค่าเริ่มต้นตั้งให้ตรงกับพฤติกรรมเดิมเป๊ะสำหรับรายสัปดาห์ (จันทร์=1, 18:00) เพื่อไม่กระทบร้านเดิม
-- ที่ไม่เข้าไปปรับแต่งเอง — รายเดือนเป็นฟีเจอร์ใหม่ทั้งหมด ปิดไว้เป็นค่าเริ่มต้น (opt-in)
ALTER TABLE shop_profiles
  ADD COLUMN IF NOT EXISTS notify_weekly_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_weekly_day smallint NOT NULL DEFAULT 1,      -- 0=อาทิตย์..6=เสาร์
  ADD COLUMN IF NOT EXISTS notify_weekly_hour smallint NOT NULL DEFAULT 18,    -- ชั่วโมงกรุงเทพ 0-23
  ADD COLUMN IF NOT EXISTS notify_weekly_last_sent date,
  ADD COLUMN IF NOT EXISTS notify_monthly_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notify_monthly_day smallint NOT NULL DEFAULT 1,     -- 1-28 (กันเดือนสั้น)
  ADD COLUMN IF NOT EXISTS notify_monthly_hour smallint NOT NULL DEFAULT 18,
  ADD COLUMN IF NOT EXISTS notify_monthly_last_sent text;                     -- "YYYY-MM"
