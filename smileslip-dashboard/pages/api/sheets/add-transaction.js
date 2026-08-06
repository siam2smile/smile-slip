/**
 * POST /api/sheets/add-transaction
 * บันทึกรายการรายรับ/รายจ่ายด้วยมือ (ปุ่ม "บันทึกเอง" ในหน้าบัญชี — เหมือนคำสั่ง รับ/จ่าย ใน LINE bot)
 * body: { shopId, type, amount, date, time, sender, receiver, note, method, branch }
 *
 * เดิมเขียนลง Google Sheets ตรงๆ (คนละที่เก็บกับที่บอทเขียนเข้า ledger_transactions ตั้งแต่
 * Phase 3 — ทำให้รายการที่คีย์ผ่านเว็บไม่เคยโผล่ตอนพิมพ์ #สรุปยอด ในบอทเลย) — ย้ายมาเขียน
 * ledger_transactions ที่เดียวกับบอทแล้ว (ดูเหตุผลใน lib/ledger-supabase.js)
 */
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { requireOwnerAuth } from '../../../lib/owner-auth';
import { parseThaiDateTimeToUTC } from '../../../lib/ledger-supabase';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { shopId, type, amount, date, time, sender, receiver, note, method, branch } = req.body;
  if (!shopId) return res.status(400).json({ error: 'shopId ไม่ถูกต้อง' });
  if (!requireOwnerAuth(req, res, shopId, { enforce: true })) return;
  if (type !== 'รายรับ' && type !== 'รายจ่าย') return res.status(400).json({ error: 'ประเภทต้องเป็น รายรับ หรือ รายจ่าย' });
  if (!branch) return res.status(400).json({ error: 'ต้องระบุสาขา' });
  const amountNum = parseFloat(amount);
  if (isNaN(amountNum) || amountNum <= 0) return res.status(400).json({ error: 'จำนวนเงินไม่ถูกต้อง' });

  try {
    const { data: shop } = await supabase.from('shop_profiles').select('shop_name').eq('id', shopId).maybeSingle();

    // ใช้วันที่/เวลาที่ผู้ใช้กรอกถ้ามี (แปลงเป็น UTC ตรงๆ) ไม่งั้นใช้เวลาปัจจุบัน
    const transactionAt = parseThaiDateTimeToUTC(date, time) || new Date().toISOString();

    // slip_hash — ใช้เป็น "ref" สำหรับหน้าแก้ไขรายการ (ดู /transaction/edit) เหมือนกับที่สลิป OCR
    // ใช้ image hash — เติมส่วนสุ่มกันชนกันถ้ากดบันทึกพร้อมกันหลายแท็บ
    const slipHash = 'manual-' + crypto.randomBytes(8).toString('hex');

    const { error } = await supabase.from('ledger_transactions').insert({
      shop_id: shopId,
      type: type === 'รายจ่าย' ? 'expense' : 'income',
      amount: amountNum,
      category: null,
      note: note || '-',
      slip_url: null,
      slip_hash: slipHash,
      status: 'completed',
      sender_name: sender || '-',
      receiver_name: receiver || '-',
      branch_name: branch || shop?.shop_name || '-',
      payment_method: method === 'เงินสด' ? 'เงินสด' : 'โอน',
      recorder_name: 'เจ้าของร้าน (เว็บ)',
      transaction_at: transactionAt,
      raw_data: { source: 'dashboard-manual-entry' },
    });
    if (error) throw error;

    return res.status(200).json({ success: true, ref: slipHash });
  } catch (err) {
    console.error('[API/sheets/add-transaction]', err.message);
    return res.status(500).json({ error: 'บันทึกไม่สำเร็จ: ' + err.message });
  }
}
