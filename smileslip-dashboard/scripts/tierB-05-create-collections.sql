-- Tier B ข้อ 5 (ตัวสุดท้ายของ Tier B) — ตาราง Supabase มิเรอร์แท็บ "งานเก็บเงิน"
-- (COLLECTION_HEADERS, collections.js) — งานส่งพนักงานไปเก็บเงินเชื่อ/สินค้ายืมค้างจากลูกค้า

CREATE TABLE IF NOT EXISTS pos_collections (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id           uuid NOT NULL REFERENCES shop_profiles(id) ON DELETE CASCADE,
  collection_no     text NOT NULL,
  transaction_at    text,   -- วันที่-เวลาไทย ดิบตามที่บันทึกจริง เก็บตรงกับ Sheets เพื่อ parity เป๊ะ
  customer_id       text,
  customer_name     text,
  phone             text,
  task_type         text,
  debt_amount       numeric,
  items             jsonb,
  staff_id          text,
  staff_name        text,
  status            text NOT NULL DEFAULT 'รอดำเนินการ',
  notes             text,
  collected_amount  numeric,
  collected_items   jsonb,
  slip_url          text,
  confirmed_at      text,
  confirmed_by      text,
  staff_note        text,
  cash_received     boolean DEFAULT false,
  goods_received    boolean DEFAULT false,
  created_by        text,
  deleted_at        timestamptz,  -- soft-delete แทนการ blank แถวทิ้งของ Sheets (ยกเลิกงาน)
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, collection_no)  -- makeCollectionNo() ไม่มีส่วนสุ่ม เสี่ยงชนกันได้ต่ำๆ ถ้าเรียกในลูปเดียวกัน
                                   -- insert Supabase (secondary, best-effort) จะ fail แค่ฝั่งนี้เฉยๆ
                                   -- ไม่กระทบ Sheets (primary) เลย
);

CREATE INDEX IF NOT EXISTS idx_pos_collections_shop_status ON pos_collections (shop_id, status);
