-- Tier A ข้อ 4 (ตัวสุดท้าย) — ตาราง Supabase มิเรอร์แท็บ "ยืมสินค้า" (LOAN_HEADERS, loans.js)

CREATE TABLE IF NOT EXISTS pos_loans (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         uuid NOT NULL REFERENCES shop_profiles(id) ON DELETE CASCADE,
  loan_no         text NOT NULL,
  due_date        text,
  contact_id      text,
  contact_name    text,
  contact_phone   text,
  items           jsonb,
  notes           text,
  status          text NOT NULL DEFAULT 'ยืมอยู่',
  returned_at     text,
  branch_name     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, loan_no)  -- makeLoanNo() ไม่มีส่วนสุ่ม (แค่ timestamp วินาที) เสี่ยงชนกันได้ถ้าเรียก
                             -- ในลูปเดียวกัน — insert Supabase (secondary, best-effort) จะ fail
                             -- แค่ฝั่งนี้เฉยๆ ไม่กระทบ Sheets (primary) เลย
);

CREATE INDEX IF NOT EXISTS idx_pos_loans_shop_status ON pos_loans (shop_id, status);
