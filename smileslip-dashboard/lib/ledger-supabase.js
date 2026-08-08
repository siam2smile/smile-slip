import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

/**
 * Helper กลางอ่าน ledger_transactions (Supabase) สำหรับหน้าเว็บฝั่งลูกค้า (บัญชี → รายรับ-รายจ่าย,
 * Export Excel, รายงานภาษี) — แทนที่การอ่าน Google Sheets โดยตรงที่เคยใช้มาตลอด
 *
 * เหตุผลที่ต้องย้าย: Phase 3 Tier 6 (ดู CLAUDE.md) ตัดบอทไม่ให้เขียนลง Google Sheets อีกต่อไป
 * (เขียนเข้า ledger_transactions อย่างเดียวทั้งสลิป OCR และคีย์เอง) แต่ 4 endpoint นี้ยังอ่าน/เขียน
 * Sheets ตรงๆ ไม่เคยถูกย้ายตาม ทำให้รายการใหม่ทุกรายการหลัง Tier 6 deploy ไม่โผล่ในหน้าเว็บเลย —
 * มีแค่ /api/sheets/update-transaction.js (แก้ไขรายการเดี่ยว) ที่ถูกย้ายไปแล้วก่อนหน้านี้ (Tier 5.5)
 *
 * หมายเหตุสำคัญ: ตั้งใจไม่ backfill ข้อมูลเก่าจาก Sheets เข้า Supabase (ตามธรรมเนียมเดียวกับทุก
 * ตารางที่ย้ายมาก่อนหน้านี้ในโปรเจกต์นี้ — ดู CLAUDE.md) รายการเก่าก่อนหน้าที่ Tier 6 deploy จะไม่
 * โผล่ในหน้าเว็บอีกต่อไป (ยังดูได้จาก Google Sheet ตรงๆ ผ่านลิงก์ "เปิด Google Sheet" ในหน้าตั้งค่า
 * เสมอ เพราะไฟล์เดิมไม่ได้ถูกลบ) — รายการใหม่ตั้งแต่นี้ไปจะเห็นตรงกันทั้งบอทและหน้าเว็บ
 */

/** แปลง "ปีปฏิทินกรุงเทพ" (UTC+7 คงที่ ไม่มี DST) เป็นขอบเขต UTC ตรงๆ ไม่พึ่ง timezone ของเครื่อง/
 * container ที่รัน (pattern เดียวกับ bangkokMidnightUTC() ของบอทใน lib/ledger-google.js — กันบั๊ก
 * double-shift ของ getThaiDateTime() แบบเดิมที่เคยเจอจริงตอน timezone เครื่อง dev ไม่ใช่ UTC) */
function bangkokMidnightUTC(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day, -7, 0, 0));
}

export function bangkokYearMonthRangeISO(year, month) {
  const y = parseInt(year, 10);
  if (month) {
    const m = parseInt(month, 10);
    const start = bangkokMidnightUTC(y, m, 1);
    const end = m === 12 ? bangkokMidnightUTC(y + 1, 1, 1) : bangkokMidnightUTC(y, m + 1, 1);
    return { startISO: start.toISOString(), endISO: end.toISOString() };
  }
  const start = bangkokMidnightUTC(y, 1, 1);
  const end = bangkokMidnightUTC(y + 1, 1, 1);
  return { startISO: start.toISOString(), endISO: end.toISOString() };
}

export function formatThaiDate(date) {
  return date.toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' });
}
export function formatThaiTime(date) {
  return date.toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false });
}
export function formatIsoDate(date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  return `${parts.find(p => p.type === 'year').value}-${parts.find(p => p.type === 'month').value}-${parts.find(p => p.type === 'day').value}`;
}

/** แปลงสตริงวันที่/เวลาไทย (D/M/พ.ศ. หรือ ค.ศ., H:mm) → UTC ISO timestamp — เหมือน
 * parseThaiDateTimeToUTC() ใน update-transaction.js เป๊ะ (กันวันที่เพี้ยนถ้าผู้ใช้กรอกปีผิด) */
export function parseThaiDateTimeToUTC(dateStr, timeStr) {
  try {
    const parts = (dateStr || '').split('/');
    if (parts.length === 3) {
      let [d, m, y] = parts.map(p => parseInt(p.trim(), 10));
      if (y > 2500) y -= 543;
      if (y < 100) y += 2000;
      const currentYear = new Date(new Date().getTime() + 7 * 60 * 60 * 1000).getFullYear();
      if (y < currentYear - 1 || y > currentYear + 1) y = currentYear;
      const [hh, mm, ss] = (timeStr || '00:00:00').split(':').map(p => parseInt(p, 10) || 0);
      if (d && m && y) {
        const dt = new Date(Date.UTC(y, m - 1, d, (hh || 0) - 7, mm || 0, ss || 0));
        if (!isNaN(dt.getTime())) return dt.toISOString();
      }
    }
  } catch { /* ignore — fallback ด้านล่าง */ }
  return null;
}

/** แปลงแถว ledger_transactions → shape เดียวกับที่หน้าเว็บ (Ledger tab, Export, Tax report) คาดหวัง
 * มาตลอด (field names ตรงกับที่ Sheets เคยคืนให้ ให้ frontend ไม่ต้องแก้เลย) */
export function rowToLedgerRow(row) {
  const createdAt = new Date(row.created_at);
  const txAt = row.transaction_at ? new Date(row.transaction_at) : createdAt;
  return {
    date: formatThaiDate(txAt),
    time: formatThaiTime(txAt),
    // วันที่ทำธุรกรรมจริง (ปฏิทินกรุงเทพ) แบบ ISO YYYY-MM-DD — ต่างจาก recordedAt (วันที่บันทึก
    // จริง ไม่ backdate) ใช้สำหรับ group รายวัน/รายเดือนที่ควรอิงวันที่ธุรกรรมจริงเสมอ (เช่น
    // shop/analytics.js) ไม่ใช่วันที่พิมพ์เข้าระบบ
    transactionIsoDate: formatIsoDate(txAt),
    type: row.type === 'income' ? 'รายรับ' : 'รายจ่าย',
    amount: row.amount,
    sender: row.sender_name || '-',
    receiver: row.receiver_name || '-',
    note: row.note || '-',
    slipUrl: row.slip_url || null,
    recordedAt: formatIsoDate(createdAt),
    branch: row.branch_name || '-',
    refNo: row.slip_hash || '-',
    // POS (ขาย/รับสินค้า/รายจ่าย) เขียนเข้าที่นี่แบบ dual-write เหมือนกันหมด แต่ไม่เคยตั้ง slip_hash
    // เลยสักจุด — refNo เป็น '-' เสมอสำหรับแถวเหล่านี้ ทำให้ปุ่ม "แก้ไข" (ผูกกับ refNo) ไม่โผล่เลย
    // ไม่ใช่บั๊ก แต่หน้าเว็บต้องรู้ที่มาไว้โชว์ badge อธิบายแทนปล่อยว่างเปล่าดูเหมือนพัง
    source: row.raw_data?.source || null,
    category: row.category || '-',
    method: row.payment_method || '-',
    recorder: row.recorder_name || '-',
    taxId: row.tax_id || '-',
    taxpayerName: row.taxpayer_name || '-',
    taxAmount: row.tax_amount != null ? Number(row.tax_amount) : 0,
    taxAddress: row.tax_address || '-',
  };
}

/**
 * ดึงรายการธุรกรรมของร้านในช่วงปี/เดือนที่กำหนด (ปฏิทินกรุงเทพ) — คืน array แปลงเป็น shape
 * ของหน้าเว็บแล้ว เรียงใหม่สุดขึ้นก่อนเสมอ
 * @param {string} shopId
 * @param {{year?:string, month?:string, limit?:number}} opts
 */
export async function fetchLedgerRows(shopId, { year, month, limit } = {}) {
  let query = supabase.from('ledger_transactions').select('*').eq('shop_id', shopId);
  if (year) {
    const { startISO, endISO } = bangkokYearMonthRangeISO(year, month);
    query = query.gte('transaction_at', startISO).lt('transaction_at', endISO);
  }
  query = query.order('transaction_at', { ascending: false });
  if (limit) query = query.limit(limit);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(rowToLedgerRow);
}
