/**
 * ประมาณการณ์ภาษีเงินได้ปลายปี (Phase 3 ของแผนบัญชีเต็มรูปแบบ — ดู CLAUDE.md ข้อ 76)
 *
 * **สำคัญ — นี่คือตัวประมาณการณ์สำหรับวางแผนเท่านั้น ไม่ใช่เครื่องมือยื่นภาษีที่แม่นยำ 100%:**
 * ไม่รองรับรายการปรับปรุงทางภาษีที่แท้จริงหลายอย่าง เช่น ค่าเสื่อมราคาสินทรัพย์ถาวร, รายจ่าย
 * ต้องห้ามตามมาตรา 65 ตรี, ค่าลดหย่อนส่วนบุคคลอื่นๆ (คู่สมรส/บุตร/ประกันชีวิต/กองทุนสำรองเลี้ยงชีพ
 * ฯลฯ), ผลขาดทุนสะสมยกมา ฯลฯ — ใช้ "กำไรทางบัญชี" (accounting net profit) เป็นฐานตรงๆ ต้อง
 * ตรวจสอบกับนักบัญชี/ผู้ยื่นภาษีจริงก่อนใช้ตัวเลขนี้ยื่นจริงเสมอ
 */
import { calcAnnualPIT, PIT_PERSONAL_ALLOWANCE } from './payroll';

// ── นิติบุคคล (บริษัท/ห้างหุ้นส่วน) — อัตรา SME พิเศษ (กำไรสุทธิไม่เกิน 3 ล้านบาท/ปี) ──────────
// 0-300,000 = ยกเว้นภาษี, 300,001-3,000,000 = 15%, เกิน 3,000,000 = 20%
// (อัตรานี้ใช้ได้กับ SME ที่ทุนจดทะเบียนชำระแล้วไม่เกิน 5 ล้านบาทและรายได้ไม่เกิน 30 ล้านบาท/ปี —
// ธุรกิจขนาดใหญ่กว่านั้นอาจต้องใช้อัตราปกติ 20% ตั้งแต่บาทแรก ระบบไม่รู้ทุนจดทะเบียน/รายได้ทั้งกลุ่ม
// จึงสมมติว่าเป็น SME เสมอ — ต้องตรวจสอบเงื่อนไขนี้กับนักบัญชีเองด้วย)
export const CORPORATE_TAX_BRACKETS = [
  { upTo: 300000, rate: 0 },
  { upTo: 3000000, rate: 0.15 },
  { upTo: Infinity, rate: 0.20 },
];

export function calcCorporateTax(netProfit) {
  const profit = Math.max(0, netProfit);
  let tax = 0, prevCap = 0;
  for (const b of CORPORATE_TAX_BRACKETS) {
    if (profit <= prevCap) break;
    tax += (Math.min(profit, b.upTo) - prevCap) * b.rate;
    prevCap = b.upTo;
  }
  return Math.round(tax * 100) / 100;
}

/**
 * ประมาณการณ์ภาษีเงินได้ปลายปีตามประเภทนิติบุคคลที่ร้านลงทะเบียนไว้ (shop_profiles.user_type)
 * @param {'corporate'|'individual'} userType
 * @param {number} netProfit กำไรสุทธิทางบัญชีทั้งปี (รายรับ - ต้นทุน - ค่าใช้จ่าย - เงินเดือน, ไม่รวม VAT)
 */
export function estimateAnnualTax(userType, netProfit) {
  if (userType === 'corporate') {
    const taxableProfit = Math.max(0, netProfit);
    return {
      entityType: 'corporate',
      taxableIncome: taxableProfit,
      tax: calcCorporateTax(taxableProfit),
      brackets: CORPORATE_TAX_BRACKETS,
      note: 'ใช้อัตราภาษี SME (กำไรสุทธิไม่เกิน 3 ล้านบาท/ปี) — สมมติว่าเข้าเงื่อนไข SME ทุกกรณี ต้องตรวจสอบทุนจดทะเบียน/รายได้รวมกับนักบัญชีก่อนยื่นจริง',
    };
  }
  // บุคคลธรรมดา (เจ้าของคนเดียว) — เงินได้จากการค้าขายแบบหักค่าใช้จ่ายตามจริง (เราหักต้นทุน/ค่าใช้จ่าย/
  // เงินเดือนไปแล้วในการคำนวณ net_profit) เหลือแค่หักค่าลดหย่อนส่วนตัวมาตรฐานอีกชั้นก่อนเข้าขั้นบันได
  // (ไม่ใช้ 50%/100,000 ของเงินได้ประเภทเงินเดือน เพราะนี่คือเงินได้จากการค้า ใช้วิธีหักตามจริงแทน)
  const taxableIncome = Math.max(0, netProfit - PIT_PERSONAL_ALLOWANCE);
  return {
    entityType: 'individual',
    taxableIncome,
    tax: calcAnnualPIT(taxableIncome),
    personalAllowance: PIT_PERSONAL_ALLOWANCE,
    note: 'คำนวณแบบหักค่าใช้จ่ายตามจริง (ต้นทุน/ค่าใช้จ่าย/เงินเดือนหักไปแล้วในกำไรสุทธิ) + ค่าลดหย่อนส่วนตัว 60,000 บาท เท่านั้น (สมมติโสด ไม่มีค่าลดหย่อนอื่น) ต้องตรวจสอบกับนักบัญชีถ้ามีค่าลดหย่อนเพิ่มเติม',
  };
}
