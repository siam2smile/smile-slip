-- รูปโปรโมชั่นแนบใบเสร็จ (optional, ร้านค้าอัปโหลดเอง) — ต่อยอดข้อ 103 ตามคำขอผู้ใช้เพิ่มเติม
-- รันครั้งเดียวใน Supabase SQL Editor ของโปรเจกต์

ALTER TABLE pos_promotions ADD COLUMN IF NOT EXISTS image_data text;
