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
  if (feature === 'excel_report_templates') return level >= TIER_LEVEL.business;
  if (feature === 'market_price_index') return level >= TIER_LEVEL.enterprise;
  if (feature === 'white_label') return level >= TIER_LEVEL.enterprise;
  // Customer 360/RFM (ข้อมูลสมาชิกร้านจริง — ชื่อ/เบอร์โทร จาก pos_contacts ไม่ใช่ sender_name
  // จากสลิป) ล็อก Enterprise เท่านั้นตามที่ผู้ใช้ยืนยัน (เทียบเท่าระดับเดียวกับ Marketing
  // Intelligence เดิมที่ใช้ข้อมูล hash — งานกลยุทธ์ "6P Data Matrix" ข้อ 89)
  if (feature === 'customer_360_rfm') return level >= TIER_LEVEL.enterprise;
  // ส่วนที่เหลือของงานกลยุทธ์ "6P Data Matrix" เดียวกัน (ช่วงราคา/สินค้าคู่กัน, ชั่วโมงขายดี,
  // สรุปยอด AI) — ผู้ใช้ตัดสินใจ (2026-08-16) ให้ล็อก Enterprise ทั้งชุดเพื่อสร้างความแตกต่างจาก
  // แพ็กเกจอื่นชัดเจน (แยกคีย์จาก customer_360_rfm เผื่ออนาคตอยากแยก gate กัน)
  if (feature === 'strategy_analytics') return level >= TIER_LEVEL.enterprise;
  // บันทึกประจำวันของพนักงาน (ปัญหา/คำชม/สต็อกใกล้หมด) — ล็อก Enterprise ตามที่ผู้ใช้ตัดสินใจ
  if (feature === 'daily_staff_log') return level >= TIER_LEVEL.enterprise;
  // ระบบเงินเดือน — ล็อก Business ขึ้นไป ตามที่ผู้ใช้ยืนยัน (2026-08-16) — กะเงินสด (cash-shifts.js)
  // ตั้งใจไม่ล็อก คงฟรีทุก tier ตลอดไป (เป็นฟีเจอร์จัดการเงินสดพื้นฐาน ไม่ใช่ตัว upsell)
  if (feature === 'payroll') return level >= TIER_LEVEL.business;
  // ระบบจองคิว/นัดหมาย (ร้านนวด/คอร์สเรียน ฯลฯ) — ล็อก Advance ขึ้นไป ตามที่ผู้ใช้ยืนยัน
  // (2026-08-25) — ไม่ล็อกถึง Enterprise เพราะร้านบริการรายเล็ก (เป้าหมายหลักของฟีเจอร์นี้)
  // มักจ่ายไหวระดับกลางมากกว่า ไม่ใช่ Starter เพราะเป็นฟีเจอร์สร้างมูลค่าเพิ่มชัดเจน เหมาะเป็น
  // จุดขายให้อัปเกรด
  if (feature === 'booking') return level >= TIER_LEVEL.advance;

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
  excel_report_templates: 'รายงาน Excel สำเร็จรูป (ภ.พ.30/สรุปยอดขาย/คลังสินค้าหมุนเวียน)',
  market_price_index: 'ดัชนีราคากลาง + ตรวจทุจริตจัดซื้อ',
  white_label: 'White-Label (ลบชื่อ Smile Slip Pro ออกจากใบเสร็จ/ใบกำกับภาษี/รายงาน)',
  customer_360_rfm: 'Customer 360 / วิเคราะห์กลุ่มลูกค้าสมาชิกร้าน (RFM)',
  strategy_analytics: 'วิเคราะห์เชิงกลยุทธ์ (ช่วงราคา/สินค้าคู่กัน/ชั่วโมงขายดี/สรุปยอด AI)',
  daily_staff_log: 'บันทึกประจำวันของพนักงาน',
  payroll: 'ระบบเงินเดือน (คำนวณเงินเดือน/ประกันสังคม/ภาษีหัก ณ ที่จ่าย)',
  booking: 'ระบบจองคิว/นัดหมาย (ร้านนวด/คอร์สเรียน ฯลฯ)',
};

const TIER_LABEL = { normal: 'Starter', pro: 'Shop Pro', advance: 'Advance', business: 'Business', enterprise: 'Enterprise' };
// หาแพ็กเกจต่ำสุดที่ปลดล็อกฟีเจอร์นี้ได้ (สแกนจาก tier ต่ำไปสูง) — เดิม hardcode ข้อความ
// "ต้องใช้แพ็กเกจ Advance ขึ้นไป" ทุกฟีเจอร์เหมือนกันหมด ทั้งที่บาง feature (เช่น
// market_price_index/white_label/customer_360_rfm) ล็อกไว้ที่ Enterprise ไม่ใช่ Advance —
// ข้อความเดิมจะบอกผิด tier สำหรับกรณีเหล่านั้น แก้ให้คำนวณจริงแทน
function minTierFor(feature) {
  for (const t of ['pro', 'advance', 'business', 'enterprise']) {
    if (hasFeature(t, feature)) return t;
  }
  return 'enterprise';
}

export function upgradeMessage(feature) {
  const label = FEATURE_LABEL[feature] || 'ฟีเจอร์นี้';
  const tierLabel = TIER_LABEL[minTierFor(feature)] || 'Advance';
  return `${label} ต้องใช้แพ็กเกจ ${tierLabel} ขึ้นไป — อัปเกรดแพ็กเกจเพื่อใช้งานต่อได้ที่หน้าราคา`;
}
