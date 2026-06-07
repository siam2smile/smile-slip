import { createClient } from '@supabase/supabase-js';
import axios from 'axios';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { shopId } = req.query;
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
      .select('google_refresh_token')
      .eq('shop_id', shopId)
      .single();

    if (!shop?.google_sheet_id || !gConfig?.google_refresh_token) {
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

    // อ่านข้อมูลจาก Google Sheets (คอลัมน์ A ถึง J)
    const sheetsRes = await axios.get(
      `https://sheets.googleapis.com/v4/spreadsheets/${shop.google_sheet_id}/values/A:J`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    const allRows = sheetsRes.data.values || [];
    // แถวแรกคือ header — ข้ามออก
    const dataRows = allRows.slice(1).map((row, idx) => ({
      index: idx + 1,
      date: row[0] || '-',
      time: row[1] || '-',
      type: row[2] || '-',
      amount: row[3] || '0',
      sender: row[4] || '-',
      receiver: row[5] || '-',
      note: row[6] || '-',
      slipUrl: row[7] || null,
    })).reverse(); // เรียงใหม่สุดขึ้นก่อน

    return res.status(200).json({ rows: dataRows, connected: true });

  } catch (err) {
    console.error('[API/sheets/transactions] Error:', err.response?.data || err.message);
    return res.status(500).json({ error: err.message });
  }
}
