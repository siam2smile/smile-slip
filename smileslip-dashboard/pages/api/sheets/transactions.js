/**
 * GET /api/sheets/transactions?shopId=xxx&year=2026&month=06&limit=200
 * อ่านรายการธุรกรรมของร้านค้าจาก ledger_transactions (Supabase)
 * รองรับ filter ตามปี/เดือน และ limit จำนวนแถว
 *
 * เดิมอ่านจาก Google Sheets ตรงๆ — ย้ายมา Supabase แล้ว (ดูเหตุผลใน lib/ledger-supabase.js)
 * ตั้งใจไม่ backfill ข้อมูลเก่า รายการก่อนหน้า Phase 3 Tier 6 deploy จะไม่โผล่ที่นี่อีกต่อไป
 * (ยังดูได้จาก Google Sheet ตรงๆ ผ่านลิงก์ในหน้าตั้งค่าเสมอ)
 */
import { fetchLedgerRows } from '../../../lib/ledger-supabase';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { shopId, year, month, limit = '200' } = req.query;
  if (!shopId) return res.status(400).json({ error: 'shopId is required' });

  try {
    const rows = await fetchLedgerRows(shopId, { year, month, limit: parseInt(limit) });
    return res.status(200).json({ rows, connected: true, total: rows.length });
  } catch (err) {
    console.error('[API/sheets/transactions] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
