-- ระบบจองคิว/นัดหมาย (บริการแบบใช้เวลา — ร้านนวด, คอร์สเรียนยิงปืน ฯลฯ) — โมดูลใหม่แยกจาก POS
-- เจตนา: ใช้ร่วมกับ POS ได้ (ถ้าร้านเปิดทั้งคู่) แต่ไม่บังคับต้องมี POS ก่อนถึงจะใช้ระบบจองได้
-- (ตาราง booking_providers จึงแยกจาก pos_staff โดยเจตนา — ไม่ใช่ทุกร้านที่จองคิวจะมี POS เลย)
--
-- ตั้งชื่อตารางแบบ booking_* (ไม่มี prefix pos_) ตามธรรมเนียมเดียวกับ delivery_*/shop_* —
-- โมดูลระดับบนที่เป็นอิสระจากกัน ต่างจาก pos_payroll_* ที่ยังผูกกับ POS staff/branch อยู่บ้าง

-- ── การตั้งค่าของร้าน (1 แถวต่อร้าน) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS booking_configs (
  shop_id                   uuid PRIMARY KEY REFERENCES shop_profiles(id) ON DELETE CASCADE,
  enabled                   boolean NOT NULL DEFAULT false,
  -- {"mon":[{"start":"09:00","end":"18:00"}], "tue":[...], ...} — รองรับหลายช่วงต่อวัน (เช่น พักเที่ยง)
  business_hours            jsonb NOT NULL DEFAULT '{}'::jsonb,
  advance_booking_days      int NOT NULL DEFAULT 30,  -- จองล่วงหน้าได้ไกลสุดกี่วัน
  no_show_refund_pct        numeric NOT NULL DEFAULT 0,   -- เบี้ยวนัด (ไม่แจ้งล่วงหน้าเลย) คืนกี่% — ไม่ผูกกับจำนวนวัน
  -- [{"min_days_before":7,"refund_pct":100}, {"min_days_before":3,"refund_pct":50}, {"min_days_before":0,"refund_pct":0}]
  -- เรียงจากมากไปน้อย ระบบหา tier แรกที่ "จำนวนวันจริงก่อนถึงนัด >= min_days_before" มาใช้
  cancellation_tiers        jsonb NOT NULL DEFAULT '[]'::jsonb,
  cancellation_policy_text  text,     -- ข้อความอิสระ โชว์คู่กับตัวเลขด้านบนเสมอ (ร้านเขียนเงื่อนไขพิเศษเองได้)
  line_reminder_enabled     boolean NOT NULL DEFAULT true,  -- โชว์ปุ่มชวนแอดไลน์ Smile Slip หลังจ่ายมัดจำสำเร็จ
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

-- ── บริการที่ลูกค้าจองได้ (เมนู) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS booking_services (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id               uuid NOT NULL REFERENCES shop_profiles(id) ON DELETE CASCADE,
  service_no            text NOT NULL,
  name                  text NOT NULL,
  description           text,
  duration_minutes      int NOT NULL,           -- ตั้งเองต่อบริการ (นวด 60 นาที ≠ คอร์สยิงปืน 120 นาที)
  price                 numeric NOT NULL DEFAULT 0,
  requires_staff_selection boolean NOT NULL DEFAULT false,  -- ให้ลูกค้าเลือกพนักงาน/ผู้สอนไหม
  deposit_required      boolean NOT NULL DEFAULT false,
  deposit_type          text CHECK (deposit_type IN ('percent','fixed')),
  deposit_value         numeric,                -- ตีความตาม deposit_type (% หรือบาทตรงๆ)
  max_concurrent         int NOT NULL DEFAULT 1,  -- รับกี่คิวพร้อมกันในช่วงเวลาเดียวกัน (เตียงนวด 3 เตียง = 3)
  branch_name           text,                    -- ว่าง = ทุกสาขา (เฉพาะร้านที่มีหลายสาขาจริง)
  is_active             boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz,
  UNIQUE (shop_id, service_no)
);

CREATE INDEX IF NOT EXISTS idx_booking_services_shop ON booking_services (shop_id) WHERE deleted_at IS NULL;

-- ── พนักงาน/ผู้ให้บริการที่เลือกได้ตอนจอง (ถ้าบริการนั้นเปิด requires_staff_selection) ──────
-- แยกจาก pos_staff โดยเจตนา — ร้านที่ใช้แค่ระบบจองอย่างเดียว (ไม่มี POS เลย) ต้องใช้ได้เต็มรูปแบบ
CREATE TABLE IF NOT EXISTS booking_providers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id       uuid NOT NULL REFERENCES shop_profiles(id) ON DELETE CASCADE,
  name          text NOT NULL,
  branch_name   text,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_booking_providers_shop ON booking_providers (shop_id) WHERE deleted_at IS NULL;

-- ── การจองจริง ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS booking_reservations (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id                   uuid NOT NULL REFERENCES shop_profiles(id) ON DELETE CASCADE,
  booking_no                text NOT NULL,
  service_id                uuid REFERENCES booking_services(id) ON DELETE SET NULL,
  service_name              text NOT NULL,   -- snapshot ชื่อบริการ ณ ตอนจอง (กันชื่อเปลี่ยน/ถูกลบทีหลัง)
  provider_id               uuid REFERENCES booking_providers(id) ON DELETE SET NULL,
  provider_name             text,
  customer_name             text NOT NULL,
  customer_phone            text NOT NULL,
  customer_line_id          text,            -- รู้ก็ต่อเมื่อเปิดจากลิงก์ในแชทไลน์ (LIFF) ใช้ส่งแจ้งเตือนก่อนถึงนัด
  branch_name               text,
  start_at                  timestamptz NOT NULL,
  end_at                    timestamptz NOT NULL,   -- คำนวณจาก start_at + duration_minutes ณ ตอนจอง (snapshot)
  price                     numeric NOT NULL DEFAULT 0,   -- snapshot ราคา ณ ตอนจอง
  deposit_required_amount   numeric NOT NULL DEFAULT 0,   -- snapshot ยอดมัดจำที่ต้องจ่าย ณ ตอนจอง (0 = ไม่ต้องมัดจำ)
  deposit_slip_url          text,
  deposit_slip_hash         text,            -- กันเอาสลิปใบเดียวมาใช้จองซ้ำ (เทียบกับ ledger_transactions ที่ทำแบบนี้อยู่แล้ว)
  deposit_verified_amount   numeric,         -- ยอดที่ OCR อ่านได้ หรือแอดมินยืนยันเอง
  deposit_status            text NOT NULL DEFAULT 'not_required'
                              CHECK (deposit_status IN ('not_required','pending','auto_confirmed','manual_confirmed','mismatch')),
  status                    text NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','confirmed','cancelled','no_show','completed')),
  cancel_refund_pct         numeric,         -- คำนวณ/บันทึกตอนยกเลิกจริง (มาจาก cancellation_tiers หรือ no_show_refund_pct)
  notes                     text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  confirmed_at              timestamptz,
  cancelled_at              timestamptz,
  UNIQUE (shop_id, booking_no),
  -- กันสลิปเดิมถูกใช้จองซ้ำในร้านเดียวกัน (hash ว่างได้ถ้ายังไม่มีสลิป จึงกันเฉพาะแถวที่มีค่าจริง)
  UNIQUE (shop_id, deposit_slip_hash)
);

CREATE INDEX IF NOT EXISTS idx_booking_reservations_shop_time ON booking_reservations (shop_id, start_at) WHERE status IN ('pending','confirmed');
