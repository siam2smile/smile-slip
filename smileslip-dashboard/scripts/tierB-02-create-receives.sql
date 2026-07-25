-- Tier B ข้อ 2 — ตาราง Supabase มิเรอร์แท็บ "รับสินค้า" (RECEIVE_HEADERS, receives.js)
-- receives.js เขียนสองที่เสมอ (แบบเดียวกับ expenses.js/sales.js): POS tab "รับสินค้า" (รายละเอียด) +
-- Sheets บัญชีหลัก (tab ปี, type="รายจ่าย" หมวดหมู่ "ซื้อสินค้าเข้าสต็อค (POS)") — ตารางนี้มิเรอร์
-- POS tab, ส่วนบัญชีหลักมิเรอร์เข้า ledger_transactions ที่มีอยู่แล้ว (ไม่มี DELETE handler ในไฟล์นี้
-- จึงไม่ต้องมี deleted_at)

CREATE TABLE IF NOT EXISTS pos_receives (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         uuid NOT NULL REFERENCES shop_profiles(id) ON DELETE CASCADE,
  receive_no      text NOT NULL,
  transaction_at  text,   -- วันที่-เวลาไทย ดิบตามที่กรอก (อาจ backdate) เก็บตรงกับ Sheets เพื่อ parity เป๊ะ
  supplier        text,
  items           jsonb,
  total_cost      numeric,
  notes           text,
  supplier_id     text,
  subtotal        numeric,
  vat_total       numeric,
  photo_url       text,
  branch_name     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, receive_no)  -- makeReceiveNo() ไม่มีส่วนสุ่ม เสี่ยงชนกันได้ต่ำๆ ถ้าเรียกในลูปเดียวกัน
                                -- insert Supabase (secondary, best-effort) จะ fail แค่ฝั่งนี้เฉยๆ ไม่กระทบ Sheets เลย
);

CREATE INDEX IF NOT EXISTS idx_pos_receives_shop_branch ON pos_receives (shop_id, branch_name);
