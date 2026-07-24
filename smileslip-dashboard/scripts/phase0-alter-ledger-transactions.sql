-- Phase 0.5 ของแผน migration Sheets → Supabase — ขยาย ledger_transactions ที่มีอยู่แล้ว
-- (แต่ยังไม่เคยถูก insert เลยตาม PDPA เดิม) ให้ครบ 18 คอลัมน์เทียบเท่าชีตบัญชีหลักของบอท
--
-- คอลัมน์เดิมที่มีอยู่แล้ว (ไม่แตะ): id, shop_id, type, amount, category, note, slip_url,
-- slip_hash, status, created_at, sender_name, raw_data
--
-- เพิ่มคอลัมน์ที่ขาด (เทียบจาก schema 18 คอลัมน์ A-R ของชีตบัญชีหลัก):
ALTER TABLE ledger_transactions
  ADD COLUMN IF NOT EXISTS transaction_at   timestamptz,  -- วันที่-เวลาของสลิปจริง (คอลัมน์ A+B) แยกจาก created_at ที่หมายถึงตอนบันทึกเข้าระบบ (recorded_at เดิม) — รองรับ backdate เหมือนฟีเจอร์แก้วันที่ย้อนหลังที่มีอยู่แล้วฝั่ง Sheets
  ADD COLUMN IF NOT EXISTS receiver_name    text,          -- ผู้รับ (คอลัมน์ F)
  ADD COLUMN IF NOT EXISTS branch_name      text,          -- ชื่อสาขา (คอลัมน์ J)
  ADD COLUMN IF NOT EXISTS tax_id           text,          -- เลขภาษี (คอลัมน์ L)
  ADD COLUMN IF NOT EXISTS taxpayer_name    text,          -- ชื่อผู้เสียภาษี (คอลัมน์ M)
  ADD COLUMN IF NOT EXISTS tax_amount       numeric,       -- ยอดภาษี (คอลัมน์ N)
  ADD COLUMN IF NOT EXISTS tax_address      text,          -- ที่อยู่ผู้เสียภาษี (คอลัมน์ O)
  ADD COLUMN IF NOT EXISTS payment_method   text,          -- วิธีรับ-จ่าย โอน/เงินสด (คอลัมน์ Q)
  ADD COLUMN IF NOT EXISTS recorder_name    text;          -- ผู้บันทึก (คอลัมน์ R)

-- index สำหรับ query สรุปยอด (แทนที่การอ่านทั้งชีตมากรองด้วย JS แบบเดิมของบอท)
CREATE INDEX IF NOT EXISTS idx_ledger_transactions_shop_date
  ON ledger_transactions (shop_id, transaction_at);

CREATE INDEX IF NOT EXISTS idx_ledger_transactions_shop_branch
  ON ledger_transactions (shop_id, branch_name);
