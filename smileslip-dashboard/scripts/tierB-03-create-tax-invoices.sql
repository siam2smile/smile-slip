-- Tier B ข้อ 3 — ตาราง Supabase มิเรอร์แท็บ "ใบกำกับภาษี" (TAX_INVOICE_HEADERS, tax-invoice.js)
-- ใบกำกับภาษีที่ร้านออกให้ลูกค้าของร้านเอง (ไม่มี DELETE handler, ไม่มีเขียนเข้าบัญชีหลัก
-- เพราะยอดขายที่แท้จริงถูกบันทึกแยกผ่าน sales.js อยู่แล้ว — นี่เป็นแค่เอกสารทางการ)

CREATE TABLE IF NOT EXISTS pos_tax_invoices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         uuid NOT NULL REFERENCES shop_profiles(id) ON DELETE CASCADE,
  invoice_no      text NOT NULL,
  issued_at       text,   -- วันที่-เวลาไทย ดิบตามที่ออกจริง เก็บตรงกับ Sheets เพื่อ parity เป๊ะ
  ref_bill_no     text,
  customer_id     text,
  buyer_name      text,
  buyer_tax_id    text,
  buyer_address   text,
  buyer_branch    text,
  items           jsonb,
  subtotal        numeric,
  vat             numeric,
  total           numeric,
  issued_by       text,
  buyer_phone     text,
  seller_name     text,
  seller_address  text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, invoice_no)  -- invoice_no วิ่งเลขต่อปีจากการนับแถวที่มีอยู่ (ไม่ atomic) เสี่ยงชนกัน
                                -- ได้จริงถ้ายิงพร้อมกัน — insert Supabase (secondary) จะ fail แค่ฝั่งนี้
                                -- เฉยๆ ไม่กระทบ Sheets เลย (Sheets เองก็เสี่ยงเลขซ้ำแบบเดียวกันอยู่แล้ว
                                -- เป็น known gap เดิมที่ migration นี้ไม่ได้แก้)
);
