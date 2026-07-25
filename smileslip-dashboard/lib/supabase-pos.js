/**
 * ตัวช่วยสำหรับข้อมูลธุรกรรม POS ที่กำลังย้ายจาก Google Sheets มา Supabase (migration แบบ
 * strangler-fig — ดูแผนเต็มใน git history/แชท) — ตั้งใจให้หน้าตาคล้าย lib/google-pos.js
 * (retry, fail-loud บน infra error, soft-delete แทนลบจริง) เพื่อลดความสับสนตอนเขียนคู่
 * ระหว่างสองฝั่ง — ข้อมูลจริง (ตัวเลข/วันที่/หมวดหมู่) ย้ายมาที่นี่ ส่วนรูปสลิป/ใบเสร็จยังอยู่
 * Google Drive ของลูกค้าเหมือนเดิมเสมอ (ตารางที่นี่เก็บแค่ drive_url อ้างอิง ไม่เก็บรูปเอง)
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

// PostgREST คืน error แบบ HTTP-ish — 503/504 มักเป็นปัญหาชั่วคราว (คล้าย 429/5xx ของ Sheets API)
// ต่างจาก constraint violation (23505 ซ้ำคีย์) หรือ validation error ที่ retry ไปก็ไม่หาย
const RETRYABLE_STATUS = ['503', '504'];
async function withRetry(fn, retries = 3) {
  let lastErr;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!RETRYABLE_STATUS.includes(String(err.status)) || attempt === retries - 1) throw err;
      await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  throw lastErr;
}

// เช็คว่าตารางมีอยู่จริงหรือยัง (ระหว่าง migration บางร้าน/บาง environment อาจยังไม่ได้รัน SQL) —
// ห้ามใช้ `{ head: true }` เด็ดขาด: พิสูจน์แล้วว่า Supabase คืน error:null/count:null เสมอกับ
// head:true request แม้ตารางไม่มีอยู่จริงเลยก็ตาม (บั๊กจริงที่เจอตอนทำระบบ multi-admin) —
// ต้องใช้ select แบบไม่ head ถึงจะได้ error PGRST205 กลับมาจริงเวลาตารางยังไม่ถูกสร้าง
export async function tableExists(table) {
  try {
    const { error } = await supabase.from(table).select('id', { count: 'exact' }).limit(1);
    return !error;
  } catch {
    return false;
  }
}

export async function insertRow(table, row) {
  return withRetry(async () => {
    const { data, error } = await supabase.from(table).insert(row).select().maybeSingle();
    if (error) throw Object.assign(new Error(`Supabase insert error (${table}): ${error.message}`), { status: error.code });
    return data;
  });
}

export async function insertRows(table, rows) {
  if (!rows.length) return [];
  return withRetry(async () => {
    const { data, error } = await supabase.from(table).insert(rows).select();
    if (error) throw Object.assign(new Error(`Supabase bulk insert error (${table}): ${error.message}`), { status: error.code });
    return data;
  });
}

// `match` เป็น object เสมอ (ไม่ใช่คอลัมน์เดียว) — คีย์ธุรกิจหลายตัวในระบบนี้ (เช่น shift_no จาก
// makeShiftNo(), bill_no ฯลฯ) generate จาก timestamp โดยไม่มีส่วนสุ่ม จึงไม่การันตีว่า unique
// ข้ามร้าน ต้องเทียบคู่กับ shop_id เสมอกันแก้ผิดแถวข้ามร้าน (เช่น { shop_id, shift_no })
export async function updateRow(table, match, updates) {
  return withRetry(async () => {
    let q = supabase.from(table).update(updates);
    for (const [col, val] of Object.entries(match)) q = q.eq(col, val);
    const { data, error } = await q.select().maybeSingle();
    if (error) throw Object.assign(new Error(`Supabase update error (${table}): ${error.message}`), { status: error.code });
    return data;
  });
}

// soft-delete แทนการลบจริง — ตรงกับธรรมเนียมเดิมฝั่ง Sheets (blank แถวทิ้งแทนลบจริงใน
// updateSheetRow) เพื่อให้ parity-check เทียบสองฝั่งง่าย และเก็บ audit trail ไว้เผื่อกู้คืน
export async function softDeleteRow(table, match) {
  return updateRow(table, match, { deleted_at: new Date().toISOString() });
}

/**
 * ตัวประสานงานเขียนคู่ (dual-write) ระหว่างช่วง migration — Sheets เขียนก่อนเสมอ (ยังเป็นตัวจริง
 * ระหว่าง burn-in) แล้วเขียน Supabase ตามหลังแบบ fire-and-forget (ผิดพลาดแค่ log ไม่ throw กัน
 * Supabase ที่ยังไม่นิ่งพังงานเขียนจริงของผู้ใช้) — เมื่อพิสูจน์ parity แล้วค่อยสลับให้ Supabase
 * เป็นฝั่งบังคับ (primary) แทนในเฟสถัดไป — เขียนเป็น helper กลางจุดเดียวแทนการ copy-paste
 * try/catch แบบเดียวกันซ้ำทุกไฟล์ (ต่างจาก writeToMainSheets() เดิมที่ทำซ้ำ 4 ที่)
 */
export async function dualWrite({ primary, secondary, label }) {
  const result = await primary();
  try {
    await secondary();
  } catch (err) {
    console.error(`[dual-write:${label}] secondary (Supabase) write failed:`, err.message);
  }
  return result;
}

// ledger_transactions.type มี CHECK constraint รับแค่ 'income'/'expense' (อังกฤษ) เท่านั้น —
// พิสูจน์จริงด้วยการยิงทดสอบ (ตอน migrate expenses.js) พบว่า 'รายจ่าย'/'รายรับ' ตรงๆ (ตามที่ Sheets
// column C ใช้) ถูก constraint ปฏิเสธ — ทุกจุดที่ dual-write เข้าตารางนี้ (expenses.js, receives.js,
// sales.js ฯลฯ) ต้องแปลงเป็น 'income'/'expense' ก่อนเสมอ ห้ามใช้ค่าภาษาไทยตรงๆ
export const LEDGER_TYPE = { INCOME: 'income', EXPENSE: 'expense' };

export { supabase };
