-- Phase 3 Tier 0 — dedup backstop สำหรับแทนที่ checkDuplicateInSheets ของบอท (Tier 4)
-- ตอนนี้ ledger_transactions มี 6 แถวทั้งหมด และไม่มีค่า slip_hash ที่ไม่ว่างเลยสักแถวจากการ
-- สุ่มตรวจ 1000 แถว จึงปลอดภัยที่จะรันกับข้อมูลจริงได้เลย — ค่า NULL ใน slip_hash ไม่ถูกนับว่า
-- ซ้ำกัน (Postgres ถือว่า NULL แต่ละตัวไม่เท่ากันเอง) ดังนั้นแถวที่ไม่มี fingerprint จะไม่ชนกัน

ALTER TABLE ledger_transactions
  ADD CONSTRAINT ledger_transactions_shop_slip_hash_unique
  UNIQUE (shop_id, slip_hash);
