-- โอนย้ายสต็อกข้ามสาขา Phase 0 — backfill: ใส่ 1 แถวต่อ (shop_id, sku) ที่มีอยู่จริงตอนนี้
-- ลง branch_name='' ด้วยค่าปัจจุบันของ pos_products.stock/at_customer/empty_waiting เป๊ะ —
-- คือ "สมมติว่าสต็อกที่มีอยู่ทั้งหมดตอนนี้อยู่ในกองกลาง/ยังไม่ระบุสาขา" (ตรงกับความเป็นจริง
-- 100% เพราะระบบไม่เคยแยกสต็อกตามสาขามาก่อนเลย ไม่มีการเดา/ตัดสินใจว่าจะแบ่งให้สาขาไหน)
--
-- ห้ามใช้ ON CONFLICT DO UPDATE เด็ดขาด — ถ้ารันซ้ำหลังมีการขาย/โอนย้ายจริงเกิดขึ้นแล้ว
-- DO UPDATE จะเขียนทับข้อมูลจริงกลับเป็นค่า snapshot เดิม ใช้ DO NOTHING ให้รันซ้ำเป็น no-op

INSERT INTO pos_product_stock (shop_id, sku, branch_name, qty, at_customer, empty_waiting)
SELECT shop_id, sku, '', COALESCE(stock, 0), COALESCE(at_customer, 0), COALESCE(empty_waiting, 0)
FROM pos_products
WHERE deleted_at IS NULL
ON CONFLICT (shop_id, sku, branch_name) DO NOTHING;
