-- Tier C ข้อ 3 — ตาราง Supabase มิเรอร์แท็บ "สินค้า" (PRODUCT_HEADERS, products.js)
-- ตามธรรมเนียมเดิมของ migration นี้ (ไม่มีตารางไหนถูก backfill เลย): มิเรอร์แค่การเขียนใหม่
-- ที่จะเกิดขึ้นต่อจากนี้เท่านั้น ของเดิมที่มีอยู่แล้วใน Sheets ไม่ถูกย้อนกลับมา backfill

CREATE TABLE IF NOT EXISTS pos_products (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         uuid NOT NULL REFERENCES shop_profiles(id) ON DELETE CASCADE,
  sku             text NOT NULL,
  name            text,
  category        text,
  price           numeric DEFAULT 0,
  cost            numeric DEFAULT 0,
  stock           numeric DEFAULT 0,
  unit            text,
  aliases         text,
  notes           text,
  product_updated_at  text,  -- "วันที่อัปเดต" ดิบตามที่ Sheets เก็บ (คนละคอลัมน์กับ created_at ของแถว Supabase เอง)
  type            text DEFAULT 'นับสต็อค',
  at_customer     numeric DEFAULT 0,
  empty_waiting   numeric DEFAULT 0,
  product_code    text,
  barcode         text,
  description     text,
  vat_type        text,
  is_active       boolean DEFAULT true,
  empty_ceiling   numeric DEFAULT 0,
  branches        text,   -- comma-separated ชื่อสาขา, ว่าง = ขายได้ทุกสาขา
  deleted_at      timestamptz,  -- soft-delete แทนการ blank แถวทิ้งของ Sheets
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, sku)  -- makeSKU() มีส่วนสุ่มอยู่แล้ว แต่ยังคง constraint ไว้เพื่อความปลอดภัย
);

CREATE INDEX IF NOT EXISTS idx_pos_products_shop_category ON pos_products (shop_id, category);
