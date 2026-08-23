-- โฆษณา/แสดงโปรโมชั่นในใบเสร็จ — ข้อ 103 ใน CLAUDE.md (ข้อ 4/4 ที่ผู้ใช้ขอทำทีละข้อ)
-- รันครั้งเดียวใน Supabase SQL Editor ของโปรเจกต์

ALTER TABLE pos_promotions ADD COLUMN IF NOT EXISTS show_on_receipt boolean NOT NULL DEFAULT false;
ALTER TABLE pos_configs ADD COLUMN IF NOT EXISTS promo_advertise_on_receipt boolean NOT NULL DEFAULT false;
