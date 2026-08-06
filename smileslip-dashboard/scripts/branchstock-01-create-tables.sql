-- โอนย้ายสต็อกข้ามสาขา Phase 0 — ตารางสต็อกแยกตามสาขา + log การโอนย้าย
--
-- pos_product_stock: แหล่งความจริงใหม่ของ "มีสินค้า SKU นี้อยู่ที่สาขาไหนกี่ชิ้น"
-- branch_name='' (สตริงว่าง) = ยังไม่ระบุสาขา/กองกลาง ตรงกับที่ pos.js ส่ง
-- `selectedBranch?.branch_name || ''` อยู่แล้วทุกวันนี้ — ร้านสาขาเดียว (ไม่มีแถวใน
-- shop_branches เลย) จะใช้แถว '' นี้แถวเดียวตลอดไป ไม่กระทบความซับซ้อนเลย
--
-- ตั้งใจไม่ผูก FK ของ branch_name กับ shop_branches (จะทำให้ sentinel '' ใช้ไม่ได้ เพราะ
-- HQ ไม่มีแถวใน shop_branches) — ตรงกับ branch_name ใน pos_sales/pos_receives/pos_loans
-- ที่เป็น text เปล่าๆ ไม่ผูก FK อยู่แล้วเช่นกัน
--
-- pos_products.stock/at_customer/empty_waiting/empty_ceiling ยังคงอยู่เป็น cache ผลรวม
-- (SUM) ข้าม branch ของ SKU นั้น เขียนผ่าน lib/pos-stock.js's adjustBranchStock() เท่านั้น
-- (ไม่ใช้ DB trigger — ดูเหตุผลในแผน/plan file)

CREATE TABLE IF NOT EXISTS pos_product_stock (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         uuid NOT NULL REFERENCES shop_profiles(id) ON DELETE CASCADE,
  sku             text NOT NULL,
  branch_name     text NOT NULL DEFAULT '',
  qty             numeric NOT NULL DEFAULT 0,
  at_customer     numeric NOT NULL DEFAULT 0,
  empty_waiting   numeric NOT NULL DEFAULT 0,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, sku, branch_name),
  FOREIGN KEY (shop_id, sku) REFERENCES pos_products(shop_id, sku) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pos_product_stock_shop_sku ON pos_product_stock (shop_id, sku);

-- pos_stock_transfers: log ทุกครั้งที่โอนย้ายสต็อกระหว่างสาขา (audit trail)
-- status: pending (เริ่มโอน) -> committed (สำเร็จทั้งสองฝั่ง) / failed
-- ใช้ status เพื่อรองรับ optimistic-lock retry ใน Phase 2 (ดูแผน) — ถ้าค้างที่ pending
-- นานผิดปกติ (เช่น ฝั่งเพิ่มปลายทางล้มเหลวหลังหักต้นทางสำเร็จ) ต้องมาตรวจสอบด้วยมือ
CREATE TABLE IF NOT EXISTS pos_stock_transfers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         uuid NOT NULL REFERENCES shop_profiles(id) ON DELETE CASCADE,
  sku             text NOT NULL,
  from_branch     text NOT NULL DEFAULT '',
  to_branch       text NOT NULL DEFAULT '',
  qty             numeric NOT NULL,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','committed','failed')),
  transferred_by  text,
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  committed_at    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_pos_stock_transfers_shop ON pos_stock_transfers (shop_id, created_at DESC);
