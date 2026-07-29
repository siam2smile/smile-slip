-- Phase 2 Tier 140 — เพิ่มคอลัมน์ที่ pos_loans ยังขาด (เดิมสร้างไว้ตอน Tier A เป็นแค่ dual-write
-- secondary ไม่เคยต้องอ่านค่า stock_deducted กลับมาเลย ตอนนี้ตัด Sheets ออกแล้วต้องมีคอลัมน์นี้จริง
-- ถึงจะรู้ว่าใบยืมนี้เคยตัดสต็อคจริงตอนสร้างไหม (กันสต็อคเฟ้อตอนคืนสินค้า — ดู CLAUDE.md ข้อ 52.5/#136)

ALTER TABLE pos_loans ADD COLUMN IF NOT EXISTS stock_deducted boolean NOT NULL DEFAULT true;
