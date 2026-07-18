/**
 * GET /api/sheets/transactions?shopId=xxx&year=2026&month=06&limit=200
 * อ่านรายการธุรกรรมจาก Google Sheets ของร้านค้า
 * รองรับ filter ตามปี/เดือน และ limit จำนวนแถว
 */
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { shopId, year, month, limit = '200' } = req.query;
  if (!shopId) return res.status(400).json({ error: 'shopId is required' });

  try {
    // ดึง sheet ID จาก shop_profiles
    const { data: shop } = await supabase
      .from('shop_profiles')
      .select('google_sheet_id')
      .eq('id', shopId)
      .single();

    // ดึง refresh token จาก shop_google_configs
    const { data: gConfig } = await supabase
      .from('shop_google_configs')
      .select('google_refresh_token, google_sheet_id')
      .eq('shop_id', shopId)
      .single();

    const sheetId = gConfig?.google_sheet_id || shop?.google_sheet_id;
    if (!sheetId || !gConfig?.google_refresh_token) {
      return res.status(200).json({ rows: [], connected: false });
    }

    // แลก access token
    const tokenRes = await axios.post('https://oauth2.googleapis.com/token', {
      refresh_token: gConfig.google_refresh_token,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
    });
    const accessToken = tokenRes.data.access_token;

    // เลือก tab ปีที่ต้องการ (ถ้าไม่ระบุ = ปีปัจจุบัน)
    const targetYear = year || new Date().getFullYear().toString();
    const sheetRange = encodeURIComponent(`${targetYear}!A:R`);

    // อ่านข้อมูลจาก Google Sheets (A-R รวม ref_no, หมวดหมู่, วิธีรับ-จ่าย, ผู้บันทึก)
    const sheetsRes = await axios.get(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${sheetRange}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    const allRows = sheetsRes.data.values || [];
    // แถวแรกคือ header — ข้ามออก
    let dataRows = allRows.slice(1).map((row, idx) => ({
      index: idx + 1,
      date:     row[0] || '-',
      time:     row[1] || '-',
      type:     row[2] || '-',
      amount:   row[3] || '0',
      sender:   row[4] || '-',
      receiver: row[5] || '-',
      note:     row[6] || '-',
      slipUrl:  row[7] || null,
      recordedAt: row[8] || '',  // คอลัมน์ I — ใช้ filter เดือน
      branch:   row[9] || '-',   // คอลัมน์ J
      refNo:    row[10] || '-',  // คอลัมน์ K — เลขอ้างอิง/Hash
      category: row[15] || '-', // คอลัมน์ P — หมวดหมู่
      method:   row[16] || '-', // คอลัมน์ Q — วิธีรับ-จ่าย (โอน/เงินสด)
      recorder: row[17] || '-', // คอลัมน์ R — ผู้บันทึก
    }));

    // filter ตามเดือน (ถ้าระบุ)
    if (month) {
      const prefix = `${targetYear}-${month.padStart(2, '0')}`;
      dataRows = dataRows.filter(row => row.recordedAt.startsWith(prefix));
    }

    // เรียงใหม่สุดขึ้นก่อน + จำกัดจำนวน
    dataRows = dataRows.reverse().slice(0, parseInt(limit));

    return res.status(200).json({ rows: dataRows, connected: true, total: dataRows.length });

  } catch (err) {
    // token หมดอายุ
    if (err.response?.data?.error === 'invalid_grant') {
      return res.status(200).json({ rows: [], connected: false, tokenExpired: true });
    }
    console.error('[API/sheets/transactions] Error:', err.response?.data || err.message);
    return res.status(500).json({ error: err.message });
  }
}
