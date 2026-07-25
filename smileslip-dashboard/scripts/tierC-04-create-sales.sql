-- Tier C ข้อ 4 (ตัวสุดท้ายของ migration ตามแผนที่วางไว้) — ตาราง Supabase มิเรอร์แท็บ "ยอดขาย"
-- (SALE_HEADERS, sales.js) — sales.js เขียนสองที่เสมอ (แบบเดียวกับ expenses.js/receives.js):
-- POS tab "ยอดขาย" (รายละเอียดบิล) + Sheets บัญชีหลัก (tab ปี, type="รายรับ" เฉพาะบิลที่ชำระแล้ว) —
-- ตารางนี้มิเรอร์ POS tab, ส่วนบัญชีหลักมิเรอร์เข้า ledger_transactions ที่มีอยู่แล้ว
-- ตามธรรมเนียมเดิมของ migration นี้ ไม่ backfill บิลเก่าที่มีอยู่แล้วใน Sheets

CREATE TABLE IF NOT EXISTS pos_sales (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         uuid NOT NULL REFERENCES shop_profiles(id) ON DELETE CASCADE,
  bill_no         text NOT NULL,
  transaction_at  text,   -- วันที่-เวลาไทย ดิบตามที่บันทึกจริง (อาจ backdate) เก็บตรงกับ Sheets เพื่อ parity เป๊ะ
  items           jsonb,
  subtotal        numeric,
  discount        numeric,
  total           numeric,
  payment_method  text,
  cash_received   numeric,
  change_amount   numeric,  -- "change" เป็นคำสงวนในหลาย SQL dialect เลี่ยงใช้ change_amount แทน
  cashier         text,
  notes           text,
  status          text NOT NULL DEFAULT 'ชำระแล้ว',
  customer_id     text,
  customer_name   text,
  paid_at         text,
  branch_name     text,
  vat_subtotal    numeric,
  vat_amount      numeric,
  shift_no        text,
  deleted_at      timestamptz,  -- soft-delete แทนการ blank แถวทิ้งของ Sheets (ยกเลิกบิล)
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, bill_no)  -- makeBillNo() ไม่มีส่วนสุ่ม เสี่ยงชนกันได้ต่ำๆ ถ้าเรียกในลูปเดียวกัน
                             -- insert Supabase (secondary, best-effort) จะ fail แค่ฝั่งนี้เฉยๆ
                             -- ไม่กระทบ Sheets (primary) เลย
);

CREATE INDEX IF NOT EXISTS idx_pos_sales_shop_branch ON pos_sales (shop_id, branch_name);
CREATE INDEX IF NOT EXISTS idx_pos_sales_shop_status ON pos_sales (shop_id, status);
