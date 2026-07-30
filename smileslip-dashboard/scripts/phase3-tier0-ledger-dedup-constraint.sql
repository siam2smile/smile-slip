-- Phase 3 Tier 0 — dedup backstop สำหรับแทนที่ checkDuplicateInSheets ของบอท (Tier 4)
-- ตอนนี้ ledger_transactions มี 6 แถวทั้งหมด และไม่มีค่า slip_hash ที่ไม่ว่างเลยสักแถวจากการ
-- สุ่มตรวจ 1000 แถว จึงปลอดภัยที่จะรันกับข้อมูลจริงได้เลย — ค่า NULL ใน slip_hash ไม่ถูกนับว่า
-- ซ้ำกัน (Postgres ถือว่า NULL แต่ละตัวไม่เท่ากันเอง) ดังนั้นแถวที่ไม่มี fingerprint จะไม่ชนกัน
--
-- ⚠️ พบบั๊กจริงระหว่างตรวจสอบก่อนรัน (2026-07-30): ตาราง ledger_transactions มี UNIQUE
-- constraint เดิมอยู่แล้วบนคอลัมน์ slip_hash เดี่ยวๆ (ชื่อ `ledger_transactions_slip_hash_key`
-- — คอลัมน์นี้ไม่ได้ผูกกับ shop_id เลย) พิสูจน์แล้วจริงว่าบล็อกข้าม "คนละร้าน" กันได้ (ยิง insert
-- slip_hash เดียวกันจากร้าน A แล้วร้าน B → ร้าน B ถูกปฏิเสธด้วย 23505 ทั้งที่เป็นคนละร้านกัน
-- โดยสิ้นเชิง) — เป็นบั๊กที่มีอยู่ก่อนแล้วในตาราง ไม่เกี่ยวกับงาน migration นี้โดยตรง แต่ต้องแก้ก่อน
-- ใช้เป็น dedup backstop จริงจัง เพราะ fingerprint (เลขอ้างอิงธนาคาร/hash รูป) มีโอกาสซ้ำกันข้ามร้าน
-- ได้จริง (เช่น ธนาคารเดียวกัน รูปแบบเลขอ้างอิงคล้ายกัน) — ถ้าไม่แก้ ร้าน B จะบันทึกรายการจริงไม่ได้
-- เงียบๆ ทันทีที่ Tier 5 เปลี่ยนให้การ insert นี้เป็น required (ตอนนี้ยัง fire-and-forget อยู่เลย
-- ไม่กระทบอะไร แต่ต้องรันก่อนถึง Tier 5)

ALTER TABLE ledger_transactions
  DROP CONSTRAINT IF EXISTS ledger_transactions_slip_hash_key;

ALTER TABLE ledger_transactions
  ADD CONSTRAINT ledger_transactions_shop_slip_hash_unique
  UNIQUE (shop_id, slip_hash);
