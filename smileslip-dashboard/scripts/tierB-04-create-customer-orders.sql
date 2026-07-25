-- Tier B ข้อ 4 — ตาราง Supabase มิเรอร์แท็บ "ออเดอร์ลูกค้ารอยืนยัน" (CUSTOMER_ORDER_HEADERS, customer-orders.js)
-- เขียนจากหน้าเว็บสาธารณะ /order (ไม่ต้อง login) — คิวรอแอดมินตรวจสอบก่อนสร้างเป็นออเดอร์จัดส่งจริง

CREATE TABLE IF NOT EXISTS pos_customer_orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         uuid NOT NULL REFERENCES shop_profiles(id) ON DELETE CASCADE,
  order_no        text NOT NULL,
  transaction_at  text,   -- วันที่-เวลาไทย ดิบตามที่บันทึกจริง เก็บตรงกับ Sheets เพื่อ parity เป๊ะ
  customer_name   text,
  phone           text,
  address         text,
  branch_name     text,
  items           jsonb,
  total           numeric,
  payment_method  text,
  slip_url        text,
  notes           text,
  status          text NOT NULL DEFAULT 'รอตรวจสอบ',
  deleted_at      timestamptz,  -- soft-delete แทนการ blank แถวทิ้งของ Sheets (แอดมินปฏิเสธ/ยืนยันสร้างออเดอร์จริงแล้ว)
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, order_no)  -- makeCustomerOrderNo() มีส่วนสุ่มอยู่แล้ว (ชนกันยากกว่า ID generator อื่น)
                              -- แต่ยังคง constraint ไว้เพื่อความปลอดภัย — insert Supabase (secondary)
                              -- จะ fail แค่ฝั่งนี้เฉยๆ ไม่กระทบ Sheets เลย
);

CREATE INDEX IF NOT EXISTS idx_pos_customer_orders_shop_status ON pos_customer_orders (shop_id, status);
