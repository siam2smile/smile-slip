-- Tier C ข้อ 1 — ตาราง Supabase มิเรอร์แท็บ "ออเดอร์จัดส่ง" (ORDER_HEADERS, delivery.js)
-- มิเรอร์แค่ตัวออเดอร์เอง (ไม่ใช่ผลข้างเคียงที่ไปแก้ ผู้ติดต่อ/สินค้า — สองตารางนั้นเป็นคนละ
-- Tier C item ที่ยังไม่ได้ migrate เขียนแค่ฝั่ง Sheets เหมือนเดิมตามปกติ จนกว่าจะถึงคิวของมันเอง)

CREATE TABLE IF NOT EXISTS pos_delivery_orders (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id           uuid NOT NULL REFERENCES shop_profiles(id) ON DELETE CASCADE,
  order_no          text NOT NULL,
  transaction_at    text,   -- วันที่-เวลาไทย ดิบตามที่บันทึกจริง เก็บตรงกับ Sheets เพื่อ parity เป๊ะ
  customer_id       text,
  customer_name     text,
  phone             text,
  address           text,
  maps_link         text,
  items             jsonb,
  total             numeric,
  payment_method    text,
  staff_id          text,
  staff_name        text,
  status            text NOT NULL DEFAULT 'รอจัดส่ง',
  notes             text,
  slip_url          text,
  confirmed_at      text,
  confirmed_by      text,
  cash_received     boolean DEFAULT false,
  goods_received    boolean DEFAULT false,
  created_by        text,
  credit_settled    boolean DEFAULT false,
  deleted_at        timestamptz,  -- soft-delete แทนการ blank แถวทิ้งของ Sheets
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, order_no)  -- makeOrderNo() ไม่มีส่วนสุ่ม เสี่ยงชนกันได้ต่ำๆ ถ้าเรียกในลูปเดียวกัน
                              -- insert Supabase (secondary, best-effort) จะ fail แค่ฝั่งนี้เฉยๆ
                              -- ไม่กระทบ Sheets (primary) เลย
);

CREATE INDEX IF NOT EXISTS idx_pos_delivery_orders_shop_status ON pos_delivery_orders (shop_id, status);
