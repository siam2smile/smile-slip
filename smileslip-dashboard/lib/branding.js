/**
 * White-Label branding helpers — ใช้ร่วมกันทั้งฝั่ง client (pos.js, pos-staff.js, order.js)
 * และฝั่ง server (api/pos/export.js, api/export/excel.js, lib/*-pdf.js) จึงต้องเป็น pure JS
 * ล้วนๆ ห้าม import อะไรที่รันได้แค่ฝั่งเซิร์ฟเวอร์ (fs, googleapis ฯลฯ)
 *
 * กติกา: ร้าน Enterprise (hasFeature(tier,'white_label')) ไม่โชว์ชื่อเราที่ไหนเลย
 * (ใบเสร็จ/ใบกำกับภาษี/รายงาน/ชื่อไฟล์ export) ร้านแพ็กเกจอื่นโชว์ชื่อเราทุกจุดเป็นค่าเริ่มต้น
 */

export const BRAND_FOOTER_LINE = 'ออกโดย Smile Slip Pro · smileslippro.com';

// ต่อท้าย footer เดิมของเอกสาร (ใบเสร็จ/ใบส่งของ) ด้วยบรรทัดแบรนด์ ถ้าไม่ใช่ White-Label
export function withBrandFooter(existingFooter, isWhiteLabel) {
  const base = existingFooter || '';
  if (isWhiteLabel) return base;
  return base ? `${base}\n${BRAND_FOOTER_LINE}` : BRAND_FOOTER_LINE;
}

// กันอักขระที่ผิดกฎ filename (Windows/Mac/Linux ร่วมกัน) + ตัดความยาว + กันสตริงว่างหลัง sanitize
export function sanitizeFilenamePart(str, maxLen = 60) {
  const cleaned = String(str || '')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const truncated = cleaned.slice(0, maxLen).trim();
  return truncated || 'ร้านค้า';
}
