/**
 * สวิตช์เดียวคุมว่าฟีเจอร์ Verified Market Price Index / Procurement Fraud Detection
 * "เปิดให้ลูกค้าเห็นผลลัพธ์" หรือยัง (2026-07-20) — ดู CLAUDE.md ข้อ 30
 *
 * แยกไฟล์นี้ออกจาก lib/market-price.js (ซึ่งใช้ service role key + crypto ฝั่งเซิร์ฟเวอร์เท่านั้น)
 * เพื่อให้ฝั่ง client (pages/pos.js) import ค่านี้ตรงๆ ได้อย่างปลอดภัยโดยไม่ดึงโค้ด/secret
 * ฝั่งเซิร์ฟเวอร์เข้าไปใน client bundle ด้วย
 *
 * รอทนาย/ที่ปรึกษากฎหมายยืนยันเรื่อง anti-trust/price-signaling ก่อนเปลี่ยนเป็น true
 * ระหว่างนี้การเก็บข้อมูล (insertAnonymousMarketPrices) และตรวจ red flag
 * (checkProcurementFraud → procurement_alerts) ยังทำงานเบื้องหลังตามปกติเสมอ ไม่ปิด —
 * ที่ปิดคือแค่การแสดงผลให้ลูกค้าเห็น (warnings ใน receives.js, แท็บ "🚩 ราคาผิดปกติ" ใน pos.js)
 */
export const MARKET_PRICE_FEATURE_LIVE = false;
