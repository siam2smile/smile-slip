-- Tier B ข้อ 1 — ตาราง Supabase มิเรอร์แท็บ "รายจ่าย" (EXPENSE_HEADERS, expenses.js)
-- expenses.js เขียนสองที่เสมอ (แบบเดียวกับ sales.js): POS tab "รายจ่าย" (รายละเอียด) +
-- Sheets บัญชีหลัก (tab ปี, type="รายจ่าย") — ตารางนี้มิเรอร์ POS tab, ส่วนบัญชีหลักมิเรอร์เข้า
-- ledger_transactions ที่มีอยู่แล้ว (ALTER ไว้แล้วใน phase0-alter-ledger-transactions.sql)

CREATE TABLE IF NOT EXISTS pos_expenses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         uuid NOT NULL REFERENCES shop_profiles(id) ON DELETE CASCADE,
  expense_no      text NOT NULL,
  transaction_at  text,   -- วันที่-เวลาไทย ดิบตามที่กรอก (อาจ backdate) เก็บตรงกับ Sheets เพื่อ parity เป๊ะ
  label           text,
  total           numeric,
  vat_type        text,
  subtotal        numeric,
  vat_amount      numeric,
  payment_method  text,
  photo_url       text,
  notes           text,
  recorded_by     text,
  branch_name     text,
  shift_no        text,
  deleted_at      timestamptz,  -- soft-delete แทนการ blank แถวทิ้งของ Sheets (updateRow/softDeleteRow ใน supabase-pos.js)
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, expense_no)  -- makeExpenseNo() ไม่มีส่วนสุ่ม เสี่ยงชนกันได้ต่ำๆ ถ้าเรียกในลูปเดียวกัน
                                -- insert Supabase (secondary, best-effort) จะ fail แค่ฝั่งนี้เฉยๆ ไม่กระทบ Sheets เลย
);

CREATE INDEX IF NOT EXISTS idx_pos_expenses_shop_branch ON pos_expenses (shop_id, branch_name);
