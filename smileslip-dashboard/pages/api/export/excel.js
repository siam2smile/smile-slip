/**
 * GET /api/export/excel?shopId=xxx&year=2026&month=06
 * Export รายการธุรกรรมจาก Google Sheets เป็นไฟล์ Excel (.xlsx)
 */
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import * as XLSX from 'xlsx';
import { hasFeature } from '../../../lib/tier-features';
import { sanitizeFilenamePart } from '../../../lib/branding';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { shopId, year, month } = req.query;
  if (!shopId) return res.status(400).json({ error: 'shopId is required' });

  try {
    // ดึงข้อมูลร้านค้า
    const { data: shop } = await supabase
      .from('shop_profiles')
      .select('shop_name, google_sheet_id, subscription_tier')
      .eq('id', shopId)
      .single();

    if (!shop) return res.status(404).json({ error: 'ไม่พบร้านค้า' });

    const isWhiteLabel = hasFeature(shop.subscription_tier, 'white_label');

    // ดึง Google config
    const { data: gConfig } = await supabase
      .from('shop_google_configs')
      .select('google_refresh_token, google_sheet_id')
      .eq('shop_id', shopId)
      .single();

    const sheetId = gConfig?.google_sheet_id || shop?.google_sheet_id;
    if (!sheetId || !gConfig?.google_refresh_token) {
      return res.status(400).json({ error: 'ยังไม่ได้เชื่อมต่อ Google Sheets' });
    }

    // แลก access token
    const tokenRes = await axios.post('https://oauth2.googleapis.com/token', {
      refresh_token: gConfig.google_refresh_token,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
    });
    const accessToken = tokenRes.data.access_token;

    // ดึงข้อมูลจาก Sheets
    const targetYear = year || new Date().getFullYear().toString();
    const sheetRange = encodeURIComponent(`${targetYear}!A:K`);
    const sheetsRes = await axios.get(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${sheetRange}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    let rows = (sheetsRes.data.values || []).slice(1); // ข้าม header

    // filter เดือน
    if (month) {
      const prefix = `${targetYear}-${month.padStart(2, '0')}`;
      rows = rows.filter(row => (row[8] || '').startsWith(prefix));
    }

    // สรุปยอด
    let totalIncome = 0, totalExpense = 0, countIn = 0, countOut = 0;
    for (const row of rows) {
      const type = row[2] || '';
      const amount = parseFloat(row[3]) || 0;
      if (type === 'รายรับ') { totalIncome += amount; countIn++; }
      if (type === 'รายจ่าย') { totalExpense += amount; countOut++; }
    }

    // สร้าง Excel workbook
    const wb = XLSX.utils.book_new();

    // Sheet 1: รายการทั้งหมด (11 คอลัมน์ รวม column K เลขอ้างอิง/Hash)
    const headers = ['วันที่สลิป','เวลา','ประเภท','จำนวนเงิน (บาท)','ผู้โอน','ผู้รับ','หมายเหตุ','ลิงก์สลิป','วันที่บันทึก','ชื่อสาขา','เลขอ้างอิง/Hash'];
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
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
