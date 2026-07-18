/**
 * GET /api/admin/google/callback
 * รับ code จาก Google OAuth สำหรับ admin
 * — แลก access token + refresh token
 * — สร้าง Google Sheet สำหรับบันทึกใบกำกับภาษี (ถ้ายังไม่มี)
 * — บันทึก token ลง admin_settings table
 */
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

const BASE = process.env.NEXT_PUBLIC_BASE_URL || process.env.FRONTEND_URL;
const REDIRECT_URI = `${BASE}/api/admin/google/callback`;

async function upsertSetting(key, value) {
  await supabase.from('admin_settings').upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
}

async function getSetting(key) {
  const { data } = await supabase.from('admin_settings').select('value').eq('key', key).maybeSingle();
  return data?.value || null;
}

async function getOrCreateInvoiceSheet(accessToken, existingSheetId) {
  // ถ้ามี sheet แล้ว ตรวจสอบว่ายังใช้ได้
  if (existingSheetId) {
    try {
      await axios.get(`https://sheets.googleapis.com/v4/spreadsheets/${existingSheetId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      return existingSheetId;
    } catch { /* sheet หายหรือ access หมด — สร้างใหม่ */ }
  }

  // สร้าง Spreadsheet ใหม่
  const createRes = await axios.post(
    'https://sheets.googleapis.com/v4/spreadsheets',
    {
      properties: { title: 'SMILE SLIP — ใบกำกับภาษี / Tax Invoice Register' },
      sheets: [{ properties: { title: 'invoices' } }],
    },
    { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
  );
  const sheetId = createRes.data.spreadsheetId;

  // เขียน header row
  const headers = [
    'วันที่ออก', 'เลขที่ใบกำกับภาษี', 'อ้างอิงใบแจ้งหนี้',
    'ชื่อผู้ซื้อ', 'เลขประจำตัวผู้เสียภาษี', 'สาขา',
    'แพ็กเกจ', 'รายปี/เดือน',
    'ราคาก่อน VAT (บาท)', 'VAT 7% (บาท)', 'ราคารวม VAT (บาท)',
    'ภาษีหัก ณ ที่จ่าย 3%', 'ยอดสุทธิ (บาท)',
    'อีเมลผู้ซื้อ', 'เบอร์โทร',
  ];
  await axios.put(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/invoices!A1?valueInputOption=USER_ENTERED`,
    { values: [headers] },
    { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
  );

  return sheetId;
}

export default async function handler(req, res) {
  const { code, state, error } = req.query;

  if (error || state !== 'admin_connect') {
    return res.redirect('/admin?error=google_connect_failed');
  }
  if (!code) return res.redirect('/admin?error=no_code');

  try {
    // แลก authorization code → tokens
    const tokenRes = await axios.post('https://oauth2.googleapis.com/token', {
      code,
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri:  REDIRECT_URI,
      grant_type:    'authorization_code',
    });
    const { access_token, refresh_token } = tokenRes.data;

    // ดึง Google email
    const profileRes = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const googleEmail = profileRes.data.email;

    // สร้าง / ตรวจสอบ invoice Sheet
    const existingSheetId = await getSetting('admin_invoice_sheet_id');
    const sheetId = await getOrCreateInvoiceSheet(access_token, existingSheetId);

    // บันทึก token + sheet id
    await Promise.all([
      upsertSetting('admin_google_refresh_token', refresh_token),
      upsertSetting('admin_invoice_sheet_id', sheetId),
      upsertSetting('admin_google_email', googleEmail),
    ]);

    return res.redirect('/admin?tab=settings&google=connected');
  } catch (err) {
    console.error('[Admin Google Callback]', err.response?.data || err.message);
    return res.redirect('/admin?error=google_token_failed');
  }
}
