/**
 * GET    /api/pos/payroll-employees?shopId=xxx           → รายชื่อพนักงานในระบบเงินเดือน
 * POST   /api/pos/payroll-employees                       → เพิ่มพนักงานใหม่
 * PATCH  /api/pos/payroll-employees { shopId, id, ... }    → แก้ไขข้อมูลพนักงาน
 * DELETE /api/pos/payroll-employees { shopId, id }         → ลบ (soft-delete)
 *
 * แยกจาก pos_staff (คนที่เข้า POS ด้วย PIN) โดยเจตนา — ดูเหตุผลใน scripts/payroll-01-create-tables.sql
 * ข้อมูลเงินเดือน/เลขบัตรประชาชนเป็นข้อมูลอ่อนไหวระดับ HR — บล็อก staff session ทุกกรณีไม่ว่าจะมี
 * สิทธิ์อะไรก็ตาม (เหมือน pos-config.js) เฉพาะเจ้าของร้าน/แอดมินร้านเท่านั้นที่จัดการได้
 */
import { createClient } from '@supabase/supabase-js';
import { blockIfTrialExpired } from '../../../lib/shop-access';
import { blockAllStaffSessions } from '../../../lib/pos-auth';
import { makePayrollEmployeeNo, payrollEmployeeFromRow } from '../../../lib/payroll';
import { hasFeature, upgradeMessage } from '../../../lib/tier-features';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  const shopId = req.query.shopId || req.body?.shopId;
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });

  if (!blockAllStaffSessions(req, res, shopId)) return;
  if (req.method !== 'GET' && (await blockIfTrialExpired(req, res, shopId))) return;

  // ระบบเงินเดือน — ล็อก Business ขึ้นไป (ผู้ใช้ยืนยัน 2026-08-16)
  const { data: shopRowForTier } = await supabase.from('shop_profiles').select('subscription_tier').eq('id', shopId).maybeSingle();
  if (!hasFeature((shopRowForTier?.subscription_tier || 'normal').toLowerCase(), 'payroll')) {
    return res.status(403).json({ error: upgradeMessage('payroll'), featureLocked: true });
  }

  try {
    if (req.method === 'GET') {
      const { data, error } = await supabase.from('pos_payroll_employees').select('*')
        .eq('shop_id', shopId).is('deleted_at', null).order('created_at', { ascending: true });
      if (error) throw error;
      return res.json({ employees: (data || []).map(payrollEmployeeFromRow) });
    }

    if (req.method === 'POST') {
      const {
        name, id_card_number = '', position = '', base_salary = 0, sso_enrolled = true, branch = '', start_date = '', notes = '',
        pay_type = 'monthly', daily_rate = 0, cycle_days = 10, cycle_rate = 0, address = '', phone = '', days_off_per_month_override = '',
      } = req.body;
      if (!name?.trim()) return res.status(400).json({ error: 'กรุณาระบุชื่อพนักงาน' });
      if (!['monthly', 'daily', 'cycle'].includes(pay_type)) return res.status(400).json({ error: 'ประเภทการจ่ายไม่ถูกต้อง' });
      const numSalary = parseFloat(base_salary) || 0;
      const numDaily = parseFloat(daily_rate) || 0;
      const numCycleRate = parseFloat(cycle_rate) || 0;
      const numCycleDays = Math.max(1, parseInt(cycle_days) || 10);
      if (numSalary < 0 || numDaily < 0 || numCycleRate < 0) return res.status(400).json({ error: 'อัตราค่าแรงต้องไม่ติดลบ' });

      const employeeNo = makePayrollEmployeeNo();
      const insertBody = {
        shop_id: shopId, employee_no: employeeNo, name: name.trim(), id_card_number: id_card_number.trim(),
        position: position.trim(), base_salary: numSalary, sso_enrolled: !!sso_enrolled,
        branch_name: branch, start_date: start_date || null, notes: notes.trim(),
      };
      const { error } = await supabase.from('pos_payroll_employees').insert(insertBody);
      if (error) throw error;

      // คอลัมน์ใหม่ (pay_type/rates/address/phone/days_off override) — เพิ่ม 2026-08-10 แยก
      // update ต่างหากหลัง insert หลักสำเร็จเสมอ + กันพัง (ต้องรัน ALTER TABLE ก่อน ดู CLAUDE.md)
      try {
        await supabase.from('pos_payroll_employees').update({
          pay_type, daily_rate: numDaily, cycle_days: numCycleDays, cycle_rate: numCycleRate,
          address: address.trim(), phone: phone.trim(),
          days_off_per_month_override: days_off_per_month_override === '' ? null : Math.max(0, parseFloat(days_off_per_month_override) || 0),
        }).eq('shop_id', shopId).eq('employee_no', employeeNo);
      } catch {}

      return res.json({ ok: true, employee_no: employeeNo });
    }

    if (req.method === 'PATCH') {
      const {
        id, name, id_card_number, position, base_salary, sso_enrolled, branch, start_date, status, notes,
        pay_type, daily_rate, cycle_days, cycle_rate, address, phone, days_off_per_month_override,
      } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing id' });

      const updates = { updated_at: new Date().toISOString() };
      if (name !== undefined) updates.name = name.trim();
      if (id_card_number !== undefined) updates.id_card_number = id_card_number.trim();
      if (position !== undefined) updates.position = position.trim();
      if (base_salary !== undefined) {
        const numSalary = parseFloat(base_salary) || 0;
        if (numSalary < 0) return res.status(400).json({ error: 'เงินเดือนต้องไม่ติดลบ' });
        updates.base_salary = numSalary;
      }
      if (sso_enrolled !== undefined) updates.sso_enrolled = !!sso_enrolled;
      if (branch !== undefined) updates.branch_name = branch;
      if (start_date !== undefined) updates.start_date = start_date || null;
      if (status !== undefined) updates.status = status;
      if (notes !== undefined) updates.notes = notes.trim();

      const { error } = await supabase.from('pos_payroll_employees').update(updates).eq('shop_id', shopId).eq('id', id);
      if (error) throw error;

      // คอลัมน์ใหม่ — แยก update ต่างหาก + กันพัง เหมือน POST ด้านบน
      const extraUpdates = {};
      if (pay_type !== undefined) {
        if (!['monthly', 'daily', 'cycle'].includes(pay_type)) return res.status(400).json({ error: 'ประเภทการจ่ายไม่ถูกต้อง' });
        extraUpdates.pay_type = pay_type;
      }
      if (daily_rate !== undefined) extraUpdates.daily_rate = Math.max(0, parseFloat(daily_rate) || 0);
      if (cycle_days !== undefined) extraUpdates.cycle_days = Math.max(1, parseInt(cycle_days) || 10);
      if (cycle_rate !== undefined) extraUpdates.cycle_rate = Math.max(0, parseFloat(cycle_rate) || 0);
      if (address !== undefined) extraUpdates.address = address.trim();
      if (phone !== undefined) extraUpdates.phone = phone.trim();
      if (days_off_per_month_override !== undefined) {
        extraUpdates.days_off_per_month_override = days_off_per_month_override === '' ? null : Math.max(0, parseFloat(days_off_per_month_override) || 0);
      }
      if (Object.keys(extraUpdates).length) {
        try { await supabase.from('pos_payroll_employees').update(extraUpdates).eq('shop_id', shopId).eq('id', id); } catch {}
      }

      return res.json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing id' });
      const { error } = await supabase.from('pos_payroll_employees')
        .update({ deleted_at: new Date().toISOString() }).eq('shop_id', shopId).eq('id', id);
      if (error) throw error;
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[pos/payroll-employees] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
