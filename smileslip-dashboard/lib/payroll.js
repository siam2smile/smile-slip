/**
 * ตัวช่วยคำนวณเงินเดือน — ประกันสังคม (มาตรา 33) + ประมาณการณ์ภาษีหัก ณ ที่จ่าย (PND1)
 *
 * **สำคัญ — นี่คือตัวประมาณการณ์ ไม่ใช่เครื่องมือคำนวณภาษีที่แม่นยำ 100%:**
 * - สมมติว่าพนักงานเป็นโสด ไม่มีคู่สมรส/บุตร/ค่าลดหย่อนอื่นนอกจากค่าใช้จ่าย+ค่าลดหย่อนส่วนตัวมาตรฐาน
 * - ไม่รองรับเงินได้ไม่สม่ำเสมอ (โบนัสก้อนใหญ่/คอมมิชชั่นผันแปร) ตามวิธีคำนวณพิเศษของกรมสรรพากร
 * - ทุกจุดที่ใช้ตัวเลขนี้ต้องแก้ไขเองได้เสมอ (ไม่บังคับใช้ตัวเลขที่คำนวณให้)
 */

// ── ประกันสังคม (มาตรา 33) ──────────────────────────────────────────────────
// อัตรามาตรฐาน 5% ทั้งฝั่งลูกจ้าง+นายจ้าง คำนวณจากฐานเงินเดือน 1,650-15,000 บาท/เดือน
// (สูงสุด 750 บาท/เดือน/ฝั่ง) — ถ้า สปส. ประกาศลดอัตราชั่วคราว (เคยเกิดขึ้นจริงช่วงเศรษฐกิจไม่ดี)
// ต้องแก้ค่าคงที่นี้ตรงๆ
export const SSO_RATE = 0.05;
export const SSO_MIN_WAGE_BASE = 1650;
export const SSO_MAX_WAGE_BASE = 15000;

export function calcSSO(grossPay, ssoEnrolled = true) {
  if (!ssoEnrolled || !(grossPay > 0)) return { employee: 0, employer: 0, wageBase: 0 };
  const wageBase = Math.min(Math.max(grossPay, SSO_MIN_WAGE_BASE), SSO_MAX_WAGE_BASE);
  const contribution = Math.round(wageBase * SSO_RATE * 100) / 100;
  return { employee: contribution, employer: contribution, wageBase };
}

// ── ภาษีเงินได้บุคคลธรรมดา แบบขั้นบันได (ใช้ทั้งประมาณการณ์หัก ณ ที่จ่ายรายเดือน และรายงานภาษี
//    ปลายปีของบุคคลธรรมดาใน Phase 3) ──────────────────────────────────────────
export const PIT_BRACKETS = [
  { upTo: 150000, rate: 0 },
  { upTo: 300000, rate: 0.05 },
  { upTo: 500000, rate: 0.10 },
  { upTo: 750000, rate: 0.15 },
  { upTo: 1000000, rate: 0.20 },
  { upTo: 2000000, rate: 0.25 },
  { upTo: 5000000, rate: 0.30 },
  { upTo: Infinity, rate: 0.35 },
];

export function calcAnnualPIT(netTaxableIncome) {
  const income = Math.max(0, netTaxableIncome);
  let tax = 0, prevCap = 0;
  for (const b of PIT_BRACKETS) {
    if (income <= prevCap) break;
    tax += (Math.min(income, b.upTo) - prevCap) * b.rate;
    prevCap = b.upTo;
  }
  return Math.round(tax * 100) / 100;
}

// ค่าลดหย่อนมาตรฐานของเงินได้ประเภทเงินเดือน (มาตรา 40(1)): หักค่าใช้จ่าย 50% ของเงินได้
// สูงสุด 100,000 บาท/ปี + ค่าลดหย่อนส่วนตัว 60,000 บาท/ปี (สมมติโสด ไม่มีคู่สมรส/บุตร/ลดหย่อนอื่น)
export const PIT_EXPENSE_DEDUCTION_RATE = 0.5;
export const PIT_EXPENSE_DEDUCTION_CAP = 100000;
export const PIT_PERSONAL_ALLOWANCE = 60000;

/** ประมาณการณ์ภาษีหัก ณ ที่จ่ายต่อเดือน จากเงินเดือนสม่ำเสมอ (วิธี annualization ตามมาตรฐาน PND1) */
export function estimateMonthlyWithholding(monthlyGrossPay) {
  if (!(monthlyGrossPay > 0)) return 0;
  const annualIncome = monthlyGrossPay * 12;
  const expenseDeduction = Math.min(annualIncome * PIT_EXPENSE_DEDUCTION_RATE, PIT_EXPENSE_DEDUCTION_CAP);
  const netTaxableIncome = annualIncome - expenseDeduction - PIT_PERSONAL_ALLOWANCE;
  const annualTax = calcAnnualPIT(netTaxableIncome);
  return Math.round((annualTax / 12) * 100) / 100;
}

// ── ประเภทการจ่ายค่าแรง (pay_type) — ร้านค้าแต่ละร้านมีรูปแบบพนักงานไม่เหมือนกัน (รายเดือน/
// รายวัน/แทรค N วัน เช่น "แทรค 10 วัน" ของธุรกิจขนส่ง/แก๊ส) — เก็บทุกแบบไว้ในระบบเงินเดือน
// เดียวกัน (เลือกประเภทตอนเพิ่มพนักงาน) แทนแยกเป็นคนละหน้า เพราะทุกแบบยังเป็นค่าใช้จ่ายสาขา
// ที่ต้องเข้า P&L เดียวกัน — ตัดสินใจตามที่ผู้ใช้เลือกเมื่อ 2026-08-10
export const PAY_TYPES = [
  { value: 'monthly', label: 'รายเดือน' },
  { value: 'daily', label: 'รายวัน' },
  { value: 'cycle', label: 'แทรค (จ่ายเป็นรอบ)' },
];

// ── นโยบายวันหยุด/หักเงินกรณีหยุดเกินสิทธิ์ (เฉพาะพนักงานรายเดือน) ────────────────
// สูตร: อัตราต่อวัน = เงินเดือน ÷ จำนวนวันจริงในเดือนนั้น (28-31 วันตามเดือนจริง ไม่ใช่ 30 วัน
// คงที่) แล้วหักเฉพาะจำนวนวันที่เกินสิทธิ์ที่ได้รับอนุญาต — "สิทธิ์" เป็น**โควตาวันหยุดตรงๆ ต่อเดือน**
// (ตั้งเป็นค่ากลางของร้านใน pos_configs.payroll_days_off_per_month ปรับต่อคนได้ผ่าน
// employee.days_off_per_month_override) — **เดิม (ก่อน 2026-08-10) ใช้สูตรคูณจาก "วันหยุด/
// สัปดาห์" ผิดสมมติฐาน เพราะธุรกิจจริงหลายเจ้าให้วันหยุดเป็นโควตารายเดือนแบบยืดหยุ่น (เช่น หยุด 6
// วัน/เดือน เลือกวันไหนก็ได้ ไม่ผูกกับรอบสัปดาห์เลย) — แก้เป็นโควตาต่อเดือนตรงๆ ไม่ต้องคูณ/หารแปลง
export function computeDaysOffDeduction({ baseSalary, daysInMonth, daysOffAllowedPerMonth, daysAbsent }) {
  const salary = Math.max(0, parseFloat(baseSalary) || 0);
  const totalDays = Math.max(1, parseInt(daysInMonth) || 30);
  const allowedThisMonth = Math.max(0, parseFloat(daysOffAllowedPerMonth) || 0);
  const absent = Math.max(0, parseFloat(daysAbsent) || 0);
  const dailyRate = Math.round((salary / totalDays) * 100) / 100;
  const excessDays = Math.max(0, Math.round((absent - allowedThisMonth) * 100) / 100);
  const deduction = Math.round(dailyRate * excessDays * 100) / 100;
  return { dailyRate, allowedThisMonth, excessDays, deduction };
}

/** ค่า OT — ไม่คำนวณอัตราให้อัตโนมัติ (กฎหมายแรงงานไทยมีหลายอัตราต่างกันตามวันธรรมดา/วันหยุด/
 * กลางคืน) ให้ร้านกรอกอัตรา/ชม. ที่ตกลงกับพนักงานเองเสมอ กันคำนวณผิดกฎหมายโดยไม่รู้ตัว */
export function computeOtPay({ hours, ratePerHour }) {
  const h = Math.max(0, parseFloat(hours) || 0);
  const rate = Math.max(0, parseFloat(ratePerHour) || 0);
  return Math.round(h * rate * 100) / 100;
}

/** จำนวนวันจริงในเดือนนั้น (28-31) จาก yearMonth แบบ "YYYY-MM" */
export function daysInYearMonth(yearMonth) {
  const [y, m] = String(yearMonth || '').split('-').map(Number);
  if (!y || !m) return 30;
  return new Date(y, m, 0).getDate();
}

export function makePayrollEmployeeNo() {
  const now = new Date();
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  return `EMP${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}${Math.random().toString(36).slice(2, 5)}`;
}

export function makePayrollRunNo() {
  const now = new Date();
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  return `PR${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}${Math.random().toString(36).slice(2, 5)}`;
}

export function payrollEmployeeFromRow(r) {
  return {
    id: r.id, employee_no: r.employee_no || '', name: r.name || '',
    id_card_number: r.id_card_number || '', position: r.position || '',
    base_salary: Number(r.base_salary) || 0, sso_enrolled: r.sso_enrolled !== false,
    branch: r.branch_name || '', start_date: r.start_date || '',
    status: r.status || 'active', notes: r.notes || '',
    // คอลัมน์ใหม่ — เพิ่ม 2026-08-10 (ยังไม่ได้รัน SQL, ดู CLAUDE.md) ใช้ || '' /
    // Number(...)||0 กันพังถ้าคอลัมน์ยังไม่มีจริงในแถวที่ query กลับมา
    pay_type: r.pay_type || 'monthly',
    daily_rate: Number(r.daily_rate) || 0,
    cycle_days: r.cycle_days ? Number(r.cycle_days) : 10,
    cycle_rate: Number(r.cycle_rate) || 0,
    address: r.address || '', phone: r.phone || '',
    // days_off_per_month_override — เพิ่ม 2026-08-10 แทนที่ days_off_per_week_override เดิม
    // (ออกแบบผิดสมมติฐานตั้งแต่วันแรกที่ shipped ดู CLAUDE.md ข้อ 81 — ยังไม่มีข้อมูลจริงใช้ค่าเก่า
    // เลยสักแถวตอนแก้ จึงแทนที่ตรงๆ ได้โดยไม่ต้อง migrate ข้อมูล)
    days_off_per_month_override: r.days_off_per_month_override === null || r.days_off_per_month_override === undefined
      ? '' : Number(r.days_off_per_month_override),
  };
}

export function payrollRunFromRow(r) {
  return {
    id: r.id, run_no: r.run_no || '', employee_id: r.employee_id || '',
    employee_name: r.employee_name || '', year_month: r.year_month || '',
    base_salary: Number(r.base_salary) || 0, additions: Number(r.additions) || 0,
    addition_note: r.addition_note || '', deductions: Number(r.deductions) || 0,
    deduction_note: r.deduction_note || '', gross_pay: Number(r.gross_pay) || 0,
    sso_employee: Number(r.sso_employee) || 0, sso_employer: Number(r.sso_employer) || 0,
    withholding_tax: Number(r.withholding_tax) || 0, net_pay: Number(r.net_pay) || 0,
    branch: r.branch_name || '', notes: r.notes || '',
    paid_at: r.paid_at || '', created_at: r.created_at || '',
  };
}
