/**
 * GET    /api/pos/payroll-runs?shopId=xxx[&yearMonth=YYYY-MM][&employeeId=xxx]  → ประวัติจ่ายเงินเดือน
 * POST   /api/pos/payroll-runs   → รันจ่ายเงินเดือน 1 คน/เดือน — คำนวณประกันสังคม+ประมาณการณ์ภาษี
 *                                   หัก ณ ที่จ่ายให้อัตโนมัติ (ฝั่งเว็บแก้ไขค่าที่คำนวณได้ก่อนส่งมา)
 *                                   แล้วเขียนรวมเป็นรายจ่าย "เงินเดือนพนักงาน" เข้าบัญชีหลัก
 * DELETE /api/pos/payroll-runs { shopId, id }  → ยกเลิกรอบจ่าย (soft-delete + ลบรายจ่ายคู่ในบัญชีหลัก)
 *
 * ข้อมูลอ่อนไหวระดับ HR — บล็อก staff session ทุกกรณี เฉพาะเจ้าของร้าน/แอดมินร้านเท่านั้น (เหมือน
 * payroll-employees.js) — ต้นทุนรวมที่บันทึกเข้าบัญชี = gross_pay + sso_employer (ต้นทุนจริงทั้งหมด
 * ที่บริษัทจ่ายออก ไม่ใช่แค่ net_pay ที่พนักงานได้รับจริง เพราะเงินสมทบนายจ้างเป็นต้นทุนเพิ่มต่างหาก)
 */
import { createClient } from '@supabase/supabase-js';
import { blockIfTrialExpired } from '../../../lib/shop-access';
import { blockAllStaffSessions } from '../../../lib/pos-auth';
import { getAccessToken, appendSheet, resolveRecordDateTime } from '../../../lib/google-pos';
import { dualWrite, insertRow, LEDGER_TYPE } from '../../../lib/supabase-pos';
import {
  calcSSO, estimateMonthlyWithholding, makePayrollRunNo, payrollRunFromRow,
} from '../../../lib/payroll';

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

async function getMainLedgerConfig(shopId) {
  const [{ data: gc }, { data: sp }] = await Promise.all([
    supabase.from('shop_google_configs').select('google_refresh_token, google_sheet_id').eq('shop_id', shopId).maybeSingle(),
    supabase.from('shop_profiles').select('shop_name, branch_name').eq('id', shopId).maybeSingle(),
  ]);
  return {
    mainSheetId: gc?.google_sheet_id || null,
    refreshToken: gc?.google_refresh_token || null,
    shopName: sp?.shop_name || '',
    branchName: sp?.branch_name || '',
  };
}

// เขียนรายจ่าย "เงินเดือนพนักงาน" ลง Sheets บัญชีหลัก + ledger_transactions (best-effort, ไม่บล็อค
// การรันจ่ายเงินเดือนถ้าเขียนไม่สำเร็จ — เหมือน pattern เดียวกับ expenses.js/receives.js)
async function writePayrollToMainSheets(refreshToken, mainSheetId, { shopId, runNo, employeeName, totalCost, shopName, branchName, paidDate }) {
  if (!mainSheetId || !refreshToken) return;
  try {
    const token = await getAccessToken(refreshToken);
    const { thaiDate, thaiTime, isoYear: year } = resolveRecordDateTime(paidDate);
    const todayISO = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });

    const metaRes = await fetch(`${SHEETS_BASE}/${mainSheetId}`, { headers: { Authorization: `Bearer ${token}` } });
    const meta = await metaRes.json();
    const yearTabExists = meta.sheets?.some(s => s.properties.title === year);
    if (!yearTabExists) {
      await fetch(`${SHEETS_BASE}/${mainSheetId}:batchUpdate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests: [{ addSheet: { properties: { title: year } } }] }),
      });
      const mainHeaders = [
        'วันที่สลิป','เวลา','ประเภท (รายรับ/รายจ่าย)','จำนวนเงิน (บาท)',
        'ผู้โอน','ผู้รับ','หมายเหตุ','ลิงก์สลิป (Drive)','วันที่บันทึก (recorded_at)',
        'ชื่อสาขา','เลขอ้างอิง/Hash','เลขภาษี','ชื่อผู้เสียภาษี','ยอดภาษี (บาท)',
        'ที่อยู่ผู้เสียภาษี','หมวดหมู่','วิธีรับ-จ่าย (โอน/เงินสด)','ผู้บันทึก',
      ];
      await appendSheet(token, mainSheetId, year, mainHeaders);
    }

    const noteText = `เงินเดือน ${employeeName} | เลขที่ ${runNo}`;
    const category = 'เงินเดือนพนักงาน';

    const txDate = paidDate ? new Date(`${paidDate}T00:00:00+07:00`) : new Date();
    const now = new Date();
    const transactionAt = new Date(
      txDate.getFullYear(), txDate.getMonth(), txDate.getDate(),
      now.getHours(), now.getMinutes(), now.getSeconds()
    );

    await dualWrite({
      label: 'payroll-mainledger',
      primary: () => appendSheet(token, mainSheetId, year, [
        thaiDate, thaiTime, 'รายจ่าย', totalCost,
        shopName, employeeName, noteText,
        '', todayISO, branchName || shopName,
        '', '', '', '', '',
        category, 'เงินสด', '',
      ]),
      secondary: () => insertRow('ledger_transactions', {
        shop_id: shopId, type: LEDGER_TYPE.EXPENSE, amount: totalCost, category,
        note: noteText, sender_name: shopName, receiver_name: employeeName,
        branch_name: branchName || shopName, payment_method: 'เงินสด',
        transaction_at: transactionAt.toISOString(),
        raw_data: { source: 'pos-payroll', run_no: runNo, employee_name: employeeName },
      }),
    });
  } catch (err) {
    console.error('[pos/payroll-runs] writePayrollToMainSheets error:', err.message);
  }
}

export default async function handler(req, res) {
  const shopId = req.query.shopId || req.body?.shopId;
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });

  if (!blockAllStaffSessions(req, res, shopId)) return;
  if (req.method !== 'GET' && (await blockIfTrialExpired(req, res, shopId))) return;

  try {
    if (req.method === 'GET') {
      let query = supabase.from('pos_payroll_runs').select('*').eq('shop_id', shopId).is('deleted_at', null);
      if (req.query.yearMonth) query = query.eq('year_month', req.query.yearMonth);
      if (req.query.employeeId) query = query.eq('employee_id', req.query.employeeId);
      const { data, error } = await query.order('created_at', { ascending: false });
      if (error) throw error;
      const runs = (data || []).map(payrollRunFromRow);
      return res.json({
        runs,
        summary: {
          count: runs.length,
          total_gross: runs.reduce((s, r) => s + r.gross_pay, 0),
          total_net: runs.reduce((s, r) => s + r.net_pay, 0),
          total_sso_employee: runs.reduce((s, r) => s + r.sso_employee, 0),
          total_sso_employer: runs.reduce((s, r) => s + r.sso_employer, 0),
          total_withholding: runs.reduce((s, r) => s + r.withholding_tax, 0),
        },
      });
    }

    if (req.method === 'POST') {
      const {
        employeeId = '', employeeName = '', yearMonth = '',
        baseSalary = 0, additions = 0, additionNote = '', deductions = 0, deductionNote = '',
        ssoEnrolled = true,
        // ค่าที่คำนวณอัตโนมัติแล้วแต่ฝั่งเว็บแก้ไขได้ก่อนส่งมา (ประมาณการณ์เท่านั้น ไม่ใช่ตัวเลขบังคับ)
        ssoEmployeeOverride, ssoEmployerOverride, withholdingTaxOverride,
        branch = '', notes = '', paidDate = '',
      } = req.body;

      if (!employeeName.trim()) return res.status(400).json({ error: 'กรุณาระบุชื่อพนักงาน' });
      if (!yearMonth) return res.status(400).json({ error: 'กรุณาระบุเดือนที่จ่าย' });
      const numBase = parseFloat(baseSalary) || 0;
      const numAdd = parseFloat(additions) || 0;
      const numDeduct = parseFloat(deductions) || 0;
      if (numBase < 0 || numAdd < 0 || numDeduct < 0) return res.status(400).json({ error: 'ยอดเงินต้องไม่ติดลบ' });

      const grossPay = Math.max(0, numBase + numAdd - numDeduct);
      const ssoCalc = calcSSO(grossPay, ssoEnrolled);
      const ssoEmployee = ssoEmployeeOverride !== undefined ? Math.max(0, parseFloat(ssoEmployeeOverride) || 0) : ssoCalc.employee;
      const ssoEmployer = ssoEmployerOverride !== undefined ? Math.max(0, parseFloat(ssoEmployerOverride) || 0) : ssoCalc.employer;
      const withholdingTax = withholdingTaxOverride !== undefined ? Math.max(0, parseFloat(withholdingTaxOverride) || 0) : estimateMonthlyWithholding(grossPay);
      const netPay = Math.max(0, grossPay - ssoEmployee - withholdingTax);

      const runNo = makePayrollRunNo();
      const { error } = await supabase.from('pos_payroll_runs').insert({
        shop_id: shopId, run_no: runNo, employee_id: employeeId || null, employee_name: employeeName.trim(),
        year_month: yearMonth, base_salary: numBase, additions: numAdd, addition_note: additionNote.trim(),
        deductions: numDeduct, deduction_note: deductionNote.trim(), gross_pay: grossPay,
        sso_employee: ssoEmployee, sso_employer: ssoEmployer, withholding_tax: withholdingTax, net_pay: netPay,
        branch_name: branch, notes: notes.trim(), paid_at: paidDate ? new Date(`${paidDate}T00:00:00+07:00`).toISOString() : new Date().toISOString(),
      });
      if (error) throw error;

      // ต้นทุนรวมที่บริษัทจ่ายออกจริง = gross_pay (ก่อนหักประกันสังคม/ภาษีของพนักงาน) + เงินสมทบนายจ้าง
      const { mainSheetId, refreshToken, shopName, branchName } = await getMainLedgerConfig(shopId);
      await writePayrollToMainSheets(refreshToken, mainSheetId, {
        shopId, runNo, employeeName: employeeName.trim(), totalCost: grossPay + ssoEmployer,
        shopName, branchName: branch || branchName, paidDate,
      });

      return res.json({ ok: true, runNo, grossPay, ssoEmployee, ssoEmployer, withholdingTax, netPay });
    }

    if (req.method === 'DELETE') {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing id' });

      const { data: existing, error: fetchErr } = await supabase.from('pos_payroll_runs').select('*')
        .eq('shop_id', shopId).eq('id', id).is('deleted_at', null).maybeSingle();
      if (fetchErr) throw fetchErr;
      if (!existing) return res.status(404).json({ error: 'ไม่พบรอบจ่ายเงินเดือนนี้' });

      const { error } = await supabase.from('pos_payroll_runs')
        .update({ deleted_at: new Date().toISOString() }).eq('shop_id', shopId).eq('id', id);
      if (error) throw error;

      // ลบแถวคู่ในบัญชีหลัก (best-effort — จับคู่ด้วย raw_data->>run_no)
      try {
        await supabase.from('ledger_transactions').delete()
          .eq('shop_id', shopId).eq('raw_data->>run_no', existing.run_no);
      } catch (err) {
        console.error('[pos/payroll-runs] delete ledger row error:', err.message);
      }

      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[pos/payroll-runs] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
