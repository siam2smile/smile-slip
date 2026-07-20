/**
 * Package Tier & Feature Gating Matrix (เพิ่ม 2026-07-20 — ดู CLAUDE.md)
 *
 * โมเดลใหม่: Starter ไม่ใช่ freemium ถาวรอีกต่อไป แต่เป็น "ทดลองใช้ฟรีเต็มรูปแบบ 30 วัน"
 * (ดู trial_started_at/trial_ends_at/status ใน shop_profiles + api/cron/expire-trials.js)
 *
 * ตาราง feature gating (ตรงตามสเปกที่ผู้ใช้ส่งมา 2026-07-20):
 *   - POS ขายหน้าร้าน/หลายบิล        → ทุก tier ใช้ได้เสมอ (ไม่ gate)
 *   - สต็อกถังหมุนเวียน/แอปพนักงานส่งของ/ระบบเงินเชื่อ
 *       → ✅ normal (Starter/trial), ❌ pro (Shop Pro), ✅ advance ขึ้นไปทั้งหมด
 *         (Shop Pro ตั้งใจ "ลด" ฟีเจอร์เหล่านี้ลงเทียบกับตอน trial เพื่อดันให้อัปเกรดเป็น Advance)
 *   - รายงานภาษี VAT               → business ขึ้นไปเท่านั้น (ตรงกับที่ tax-report.js เช็คอยู่แล้ว)
 *   - ดัชนีราคากลาง + ตรวจทุจริต     → enterprise เท่านั้น (และต้องรอ MARKET_PRICE_FEATURE_LIVE ด้วย)
 */

export const TIER_LEVEL = { normal: 0, pro: 1, advance: 2, business: 3, enterprise: 4, super: 4 };

const GATED_AT_PRO_ONLY = new Set(['cyclical_stock', 'delivery_staff_app', 'credit_ar']);

export function hasFeature(tier, feature) {
  const t = (tier || 'normal').toLowerCase();
  const level = TIER_LEVEL[t] ?? 0;

  if (feature === 'vat_report') return level >= TIER_LEVEL.business;
  if (feature === 'market_price_index') return level >= TIER_LEVEL.enterprise;

  if (GATED_AT_PRO_ONLY.has(feature)) {
    // Shop Pro (pro) ล็อกเฉพาะ 3 ฟีเจอร์นี้ — ส่วน normal (trial/ร้านเก่า grandfather) และ advance ขึ้นไปผ่านหมด
    return t !== 'pro';
  }

  return true; // ฟีเจอร์อื่น (ขายหน้าร้าน, หลายบิล ฯลฯ) ใช้ได้ทุก tier เสมอ
}

// ข้อความอัปเกรดมาตรฐาน ใช้ทั้งฝั่ง API error message และ UI
export const FEATURE_LABEL = {
  cyclical_stock: 'สต็อกสินค้าหมุนเวียน (เช่น ถังแก๊ส/ขวดน้ำ)',
  delivery_staff_app: 'แอปพนักงานส่งของ',
  credit_ar: 'ระบบลงบัญชีเงินเชื่อ/ลูกหนี้',
  vat_report: 'รายงานภาษีมูลค่าเพิ่ม (VAT)',
  market_price_index: 'ดัชนีราคากลาง + ตรวจทุจริตจัดซื้อ',
};

export function upgradeMessage(feature) {
  const label = FEATURE_LABEL[feature] || 'ฟีเจอร์นี้';
  return `${label} ต้องใช้แพ็กเกจ Advance ขึ้นไป — อัปเกรดแพ็กเกจเพื่อใช้งานต่อได้ที่หน้าราคา`;
}
