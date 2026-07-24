-- Tier A (migration Sheets → Supabase) — ตาราง Supabase มิเรอร์แท็บ "กะเงินสด" (CASH_SHIFT_HEADERS)
-- ระยะ dual-write: เขียนคู่กับ Sheets ทั้งสองที่ ไม่มีการอ่านจากตารางนี้จริงในโค้ดยัง (แค่เขียน
-- เพื่อสะสมข้อมูลไว้เทียบ parity ก่อน — คู่มือ scripts/verify-parity.js)

CREATE TABLE IF NOT EXISTS pos_cash_shifts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id           uuid NOT NULL REFERENCES shop_profiles(id) ON DELETE CASCADE,
  shift_no          text NOT NULL,
  staff_id          text,
  staff_name        text,
  branch_name       text,
  opened_at         timestamptz,
  opening_cash      numeric NOT NULL DEFAULT 0,
  closed_at         timestamptz,
  expected_cash     numeric,
  counted_cash      numeric,
  variance          numeric,
  notes             text,
  withdrawn_amount  numeric,
  carried_forward   numeric,
  status            text NOT NULL DEFAULT 'เปิดอยู่',
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, shift_no)  -- shift_no มาจาก makeShiftNo() (timestamp วินาที ไม่มีส่วนสุ่ม)
                              -- ไม่การันตี unique ข้ามร้าน ต้องคู่กับ shop_id เสมอ
);

CREATE INDEX IF NOT EXISTS idx_pos_cash_shifts_shop_status ON pos_cash_shifts (shop_id, status);
CREATE INDEX IF NOT EXISTS idx_pos_cash_shifts_shop_staff  ON pos_cash_shifts (shop_id, staff_id);
