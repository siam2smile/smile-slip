-- ระบบเงินเดือน (Phase 2 ของแผนบัญชีเต็มรูปแบบ — ดู CLAUDE.md ข้อ 76) — 2 ตารางใหม่
--
-- pos_payroll_employees แยกจาก pos_staff โดยเจตนา: pos_staff คือ "คนที่เข้าระบบ POS ด้วย PIN"
-- (แคชเชียร์/พนักงานส่งของ) ซึ่งไม่ใช่ทุกคนที่ต้องอยู่ในระบบเงินเดือน (พนักงานบางคนไม่แตะ POS เลย
-- เช่น แม่ครัว/คนทำความสะอาด) และพนักงาน POS บางคนก็อาจเป็นแค่ part-time ไม่ได้อยู่ payroll —
-- สองแนวคิดนี้ทับซ้อนกันได้แต่ไม่ใช่เซตเดียวกันเป๊ะ จึงแยกตารางชัดเจน

CREATE TABLE IF NOT EXISTS pos_payroll_employees (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         uuid NOT NULL REFERENCES shop_profiles(id) ON DELETE CASCADE,
  employee_no     text NOT NULL,
  name            text NOT NULL,
  id_card_number  text,           -- เลขบัตรประชาชน — ใช้ตอนยื่น ภ.ง.ด.1/หนังสือรับรองหัก ณ ที่จ่าย
  position        text,
  base_salary     numeric NOT NULL DEFAULT 0,
  sso_enrolled    boolean NOT NULL DEFAULT true,  -- เข้าประกันสังคมมาตรา 33 หรือไม่
  branch_name     text,
  start_date      date,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  UNIQUE (shop_id, employee_no)
);

CREATE INDEX IF NOT EXISTS idx_pos_payroll_employees_shop ON pos_payroll_employees (shop_id) WHERE deleted_at IS NULL;

-- 1 แถวต่อพนักงานต่อเดือน — snapshot ชื่อ/เงินเดือนไว้ ณ ตอนรันจ่าย (employee_name/base_salary)
-- เผื่อพนักงานถูกลบ/เปลี่ยนชื่อ/ปรับเงินเดือนทีหลัง ประวัติเก่าจะยังถูกต้องตามที่จ่ายจริง ไม่เปลี่ยนย้อนหลัง
CREATE TABLE IF NOT EXISTS pos_payroll_runs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id           uuid NOT NULL REFERENCES shop_profiles(id) ON DELETE CASCADE,
  run_no            text NOT NULL,
  employee_id       uuid REFERENCES pos_payroll_employees(id) ON DELETE SET NULL,
  employee_name     text NOT NULL,
  year_month        text NOT NULL,  -- 'YYYY-MM' ปฏิทินไทย/สากล (เดือนที่จ่ายจริง)
  base_salary       numeric NOT NULL DEFAULT 0,
  additions         numeric NOT NULL DEFAULT 0,   -- โบนัส/OT ฯลฯ รวมเป็นยอดเดียว (ไม่แยกประเภท)
  addition_note     text,
  deductions        numeric NOT NULL DEFAULT 0,   -- เงินเบิกล่วงหน้า/หักอื่นๆ (ก่อนคำนวณประกันสังคม/ภาษี)
  deduction_note    text,
  gross_pay         numeric NOT NULL DEFAULT 0,   -- base_salary + additions - deductions
  sso_employee      numeric NOT NULL DEFAULT 0,   -- หักจากพนักงาน (5% ฐานเงินเดือน 1,650-15,000)
  sso_employer      numeric NOT NULL DEFAULT 0,   -- นายจ้างสมทบเพิ่ม (ไม่ได้หักจากพนักงาน แต่เป็นต้นทุนบริษัท)
  withholding_tax   numeric NOT NULL DEFAULT 0,   -- ประมาณการณ์ภาษีหัก ณ ที่จ่าย (แก้ไขเองได้)
  net_pay           numeric NOT NULL DEFAULT 0,   -- gross_pay - sso_employee - withholding_tax
  branch_name       text,
  notes             text,
  paid_at           timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  UNIQUE (shop_id, run_no)
);

CREATE INDEX IF NOT EXISTS idx_pos_payroll_runs_shop_month ON pos_payroll_runs (shop_id, year_month) WHERE deleted_at IS NULL;
