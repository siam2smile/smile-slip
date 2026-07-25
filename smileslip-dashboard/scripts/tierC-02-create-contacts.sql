-- Tier C ข้อ 2 — ตาราง Supabase มิเรอร์แท็บ "ผู้ติดต่อ" (CONTACT_HEADERS, contacts.js)
-- ⚠️ ตามที่ตัดสินใจไว้: สร้างแค่ตาราง + wiring dual-write สำหรับ "ข้อมูลใหม่ที่จะเข้ามาต่อจากนี้"
-- เท่านั้น — ไม่ backfill ผู้ติดต่อเก่า 2,000+ แถวที่มีอยู่แล้วใน Sheets (ประหยัด token/effort
-- ตามที่ผู้ใช้สั่ง) ถ้าต้องการให้ Supabase มีข้อมูลเก่าครบ ให้ import ใหม่ทีหลังแยกเป็นงานของตัวเอง

CREATE TABLE IF NOT EXISTS pos_contacts (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id                uuid NOT NULL REFERENCES shop_profiles(id) ON DELETE CASCADE,
  contact_id             text NOT NULL,
  name                   text,
  contact_type           text,
  phone                  text,
  email                  text,
  address_1              text,
  maps_1                 text,
  address_2              text,
  maps_2                 text,
  company_name           text,
  tax_id                 text,
  tax_address            text,
  tax_branch             text,
  debt                   numeric DEFAULT 0,
  cylinders              numeric DEFAULT 0,
  shop_name              text,
  aliases                text,
  notes                  text,
  contact_created_at     text,   -- วันที่เพิ่มดิบตามที่ Sheets เก็บ (คนละคอลัมน์กับ created_at ของแถว Supabase เอง)
  contact_updated_at     text,
  person_type            text,
  contact_person_name    text,
  contact_person_phone   text,
  cylinder_limit         numeric DEFAULT 0,
  deleted_at             timestamptz,  -- soft-delete แทนการ blank แถวทิ้งของ Sheets
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, contact_id)  -- makeContactId() มีส่วนสุ่มอยู่แล้ว แต่ยังคง constraint ไว้เพื่อความปลอดภัย
);

CREATE INDEX IF NOT EXISTS idx_pos_contacts_shop_type ON pos_contacts (shop_id, contact_type);
