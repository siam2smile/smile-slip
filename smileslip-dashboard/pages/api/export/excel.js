/**
 * GET /api/export/excel?shopId=xxx&year=2026&month=06
 * Export รายการธุรกรรมของร้านค้าเป็นไฟล์ Excel (.xlsx)
 *
 * เดิมอ่านจาก Google Sheets ตรงๆ — ย้ายมา ledger_transactions (Supabase) แล้ว (ดูเหตุผลใน
 * lib/ledger-supabase.js) จึง export ได้แม้ร้านไม่เคยเชื่อมต่อ Google Sheets เลยก็ตาม
 */
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import { hasFeature } from '../../../lib/tier-features';
import { sanitizeFilenamePart } from '../../../lib/branding';
import { requireOwnerAuth } from '../../../lib/owner-auth';
import { fetchLedgerRows } from '../../../lib/ledger-supabase';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { shopId, year, month } = req.query;
  if (!shopId) return res.status(400).json({ error: 'shopId is required' });
  // เรียกจาก handleExportExcel() (ปุ่มกด) ใน dashboard.js — ผ่าน fetch() override เสมอ ปลอดภัย
  if (!requireOwnerAuth(req, res, shopId, { enforce: true })) return;

  try {
    // ดึงข้อมูลร้านค้า
    const { data: shop } = await supabase
      .from('shop_profiles')
      .select('shop_name, subscription_tier')
      .eq('id', shopId)
      .single();

    if (!shop) return res.status(404).json({ error: 'ไม่พบร้านค้า' });

    const isWhiteLabel = hasFeature(shop.subscription_tier, 'white_label');
    const targetYear = year || new Date().getFullYear().toString();

    // เรียงเก่า→ใหม่สำหรับไฟล์ export (fetchLedgerRows คืนใหม่→เก่าไว้ใช้กับตารางในหน้าเว็บ)
    const rows = (await fetchLedgerRows(shopId, { year: targetYear, month })).reverse();

    // สรุปยอด
    let totalIncome = 0, totalExpense = 0, countIn = 0, countOut = 0;
    for (const r of rows) {
      if (r.type === 'รายรับ') { totalIncome += Number(r.amount) || 0; countIn++; }
      if (r.type === 'รายจ่าย') { totalExpense += Number(r.amount) || 0; countOut++; }
    }

    // สร้าง Excel workbook
    const wb = XLSX.utils.book_new();

    // Sheet 1: รายการทั้งหมด
    const headers = ['วันที่สลิป','เวลา','ประเภท','จำนวนเงิน (บาท)','ผู้โอน','ผู้รับ','หมายเหตุ','ลิงก์สลิป','วันที่บันทึก','ชื่อสาขา','เลขอ้างอิง/Hash'];
    const dataRows = rows.map(r => [r.date, r.time, r.type, r.amount, r.sender, r.receiver, r.note, r.slipUrl || '', r.recordedAt, r.branch, r.refNo]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
    ws['!cols'] = [
      { wch: 14 }, { wch: 8 }, { wch: 18 }, { wch: 16 },
      { wch: 20 }, { wch: 20 }, { wch: 24 }, { wch: 36 },
      { wch: 14 }, { wch: 16 }, { wch: 20 },
    ];
    const sheetLabel = month ? `${month.padStart(2,'0')}-${targetYear}` : targetYear;
    XLSX.utils.book_append_sheet(wb, ws, sheetLabel);

    // Sheet 2: สรุปยอด
    const summaryData = [
      [isWhiteLabel ? 'รายงานสรุป' : 'รายงานสรุป Smile Slip Pro', `ร้าน: ${shop.shop_name}`],
      ['ช่วงเวลา', month ? `${month}/${targetYear}` : `ปี ${targetYear}`],
      [''],
      ['ประเภท', 'จำนวนเงิน (บาท)', 'จำนวนรายการ'],
      ['รายรับ', totalIncome, countIn],
      ['รายจ่าย', totalExpense, countOut],
      ['กำไร / ขาดทุน', totalIncome - totalExpense, countIn + countOut],
      [''],
      ['Export วันที่', new Date().toLocaleDateString('th-TH')],
    ];
    const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
    wsSummary['!cols'] = [{ wch: 22 }, { wch: 18 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, wsSummary, 'สรุป');

    // ส่งไฟล์กลับ
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const fileName = isWhiteLabel
      ? `${sanitizeFilenamePart(shop.shop_name)}_${sheetLabel}.xlsx`
      : `SmileSlip_${sanitizeFilenamePart(shop.shop_name)}_${sheetLabel}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    return res.send(buffer);

  } catch (err) {
    console.error('[ERROR] /api/export/excel:', err.message);
    return res.status(500).json({ error: 'Export ล้มเหลว: ' + err.message });
  }
}
