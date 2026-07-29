-- Phase 2 (write-primary flip) — Tier F ข้อ 1 — ตาราง Supabase มิเรอร์แท็บ "พนักงาน"
-- (STAFF_HEADERS, staff.js/staff-picker.js/staff-requests.js/staff-setpin.js/verify-pin.js)
-- ไม่เคยถูก migrate ใน Tier A-E เลย (staff ไม่ได้อยู่ใน 13 ตารางเดิม) — เป็นจุดที่ Sheets ถูกอ่าน
-- บ่อยที่สุดจุดหนึ่งในระบบ เพราะ getStaffPermissions() ถูกเรียกทุกครั้งที่มีการเช็คสิทธิ์พนักงาน
-- (ตั้งใจให้ถอนสิทธิ์มีผลทันที ไม่ใช่แค่ตอน login) — ตามธรรมเนียม migration นี้ทั้งหมด: ไม่ backfill
-- ข้อมูลเก่า (ชอบ D Gas 2 คนที่มีอยู่แล้วใน Sheets จะไม่ตามมาอัตโนมัติ ต้องสร้างใหม่ถ้าต้องการ)

CREATE TABLE IF NOT EXISTS pos_staff (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id                 uuid NOT NULL REFERENCES shop_profiles(id) ON DELETE CASCADE,
  staff_id                text NOT NULL,
  name                    text,
  phone                   text,
  line_id                 text,
  role                    text DEFAULT 'พนักงานส่ง',
  notes                   text,
  branch_name             text,
  pin                     text,
  perm_view_revenue       boolean DEFAULT false,
  perm_view_pl            boolean DEFAULT false,
  perm_manage_stock       boolean DEFAULT false,
  perm_export_vat         boolean DEFAULT false,
  perm_process_sales      boolean DEFAULT false,
  perm_void_sales         boolean DEFAULT false,
  perm_manage_customers   boolean DEFAULT false,
  perm_manage_expenses    boolean DEFAULT false,
  perm_manage_delivery    boolean DEFAULT false,
  perm_manage_receiving   boolean DEFAULT false,
  perm_issue_tax_invoice  boolean DEFAULT false,
  perm_manage_staff       boolean DEFAULT false,
  staff_created_at        text,   -- วันที่เพิ่มดิบแบบไทย (แสดงผลเท่านั้น ไม่ใช้ filter ช่วงวันที่)
  deleted_at              timestamptz,  -- soft-delete แทนการ blank แถวทิ้งของ Sheets
  created_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, staff_id)  -- makeStaffId() ไม่มีส่วนสุ่มจริงจัง (Date.now() ฐาน 36) เสี่ยงชนกัน
                              -- ได้ต่ำๆ ถ้าเรียกในลูปเดียวกัน
);

CREATE INDEX IF NOT EXISTS idx_pos_staff_shop_line ON pos_staff (shop_id, line_id);
CREATE INDEX IF NOT EXISTS idx_pos_staff_shop_pin ON pos_staff (shop_id, staff_id, pin);
