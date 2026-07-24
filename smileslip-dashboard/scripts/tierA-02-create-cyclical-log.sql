-- Tier A ข้อ 2 — ตาราง Supabase มิเรอร์แท็บ "บันทึกแลกเปลี่ยน" (CYCLICAL_LOG_HEADERS)
-- append-only audit log — ไม่มีจุดไหนในระบบอ่านย้อนกลับแบบ synchronous จึงเสี่ยงต่ำสุดในการย้าย

CREATE TABLE IF NOT EXISTS pos_cyclical_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         uuid NOT NULL REFERENCES shop_profiles(id) ON DELETE CASCADE,
  log_no          text NOT NULL,
  transaction_at  timestamptz,
  sku             text,
  product_name    text,
  source          text,   -- 'ขายหน้าร้าน'|'จัดส่ง'|'เก็บเงิน/ของ'
  action          text,   -- 'แลกเปลี่ยน'|'ยืม'|'คืน'
  qty             numeric,
  customer_id     text,
  customer_name   text,
  branch_name     text,
  performed_by    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, log_no)  -- makeCyclicalLogNo() มีส่วนสุ่มต่อท้ายแล้ว แต่ยังคู่กับ shop_id เพื่อความชัวร์
);

CREATE INDEX IF NOT EXISTS idx_pos_cyclical_log_shop_customer ON pos_cyclical_log (shop_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_pos_cyclical_log_shop_sku      ON pos_cyclical_log (shop_id, sku);
