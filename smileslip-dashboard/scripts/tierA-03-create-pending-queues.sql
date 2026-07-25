-- Tier A ข้อ 3 — ตาราง Supabase มิเรอร์แท็บ "รับสินค้ารอยืนยัน" + "รายจ่ายรอยืนยัน"
-- (PENDING_RECEIVE_HEADERS / PENDING_EXPENSE_HEADERS) — เขียนจากฝั่งบอท (smileslip-pro/index.js)
-- ตอนพิมพ์ #รับสินค้า/#รายจ่าย แล้วส่งรูป คนละ codebase จาก dashboard แต่ตารางเดียวกันได้

CREATE TABLE IF NOT EXISTS pos_pending_receives (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         uuid NOT NULL REFERENCES shop_profiles(id) ON DELETE CASCADE,
  pending_no      text NOT NULL,
  supplier        text,
  invoice_no      text,
  invoice_date    text,
  items           jsonb,
  image_url       text,
  branch_name     text,
  status          text NOT NULL DEFAULT 'รอตรวจสอบ',
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, pending_no)  -- makePendingReceiveNo() ไม่มีส่วนสุ่ม เสี่ยงชนกันได้ต่ำๆ ถ้าชนจริง
                                -- insert Supabase (secondary, best-effort) จะ fail แค่ฝั่งนี้เฉยๆ
                                -- ไม่กระทบ Sheets (primary) เลย
);

CREATE TABLE IF NOT EXISTS pos_pending_expenses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         uuid NOT NULL REFERENCES shop_profiles(id) ON DELETE CASCADE,
  pending_no      text NOT NULL,
  label           text,
  vendor          text,
  amount          numeric,
  vat_type        text,
  invoice_no      text,
  invoice_date    text,
  image_url       text,
  branch_name     text,
  status          text NOT NULL DEFAULT 'รอตรวจสอบ',
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, pending_no)
);

CREATE INDEX IF NOT EXISTS idx_pos_pending_receives_shop_status ON pos_pending_receives (shop_id, status);
CREATE INDEX IF NOT EXISTS idx_pos_pending_expenses_shop_status ON pos_pending_expenses (shop_id, status);
