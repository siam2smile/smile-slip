/**
 * POST /api/sheets/add-transaction
 * บันทึกรายการรายรับ/รายจ่ายด้วยมือลง Google Sheets (เหมือนคำสั่ง รับ/จ่าย ใน LINE bot)
 * body: { shopId, type, amount, date, time, sender, receiver, note }
 *
 * ใช้ "-" สำหรับ slipUrl (คีย์เอง), branch ใช้ main shop name, ref = MD5-like timestamp hash
 */
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import crypto from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

async function getSheetAccess(shopId) {
  const { data: shop } = await supabase
    .from('shop_profiles')
    .select('google_sheet_id, shop_name')
    .eq('id', shopId)
    .single();

  const { data: gConfig } = await supabase
    .from('shop_google_configs')
    .select('google_refresh_token, google_sheet_id')
    .eq('shop_id', shopId)
    .single();

  const sheetId = gConfig?.google_sheet_id || shop?.google_sheet_id;
  if (!sheetId || !gConfig?.google_refresh_token) return null;

  const tokenRes = await axios.post('https://oauth2.googleapis.com/token', {
    refresh_token: gConfig.google_refresh_token,
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    grant_type: 'refresh_token',
  });
  return { sheetId, accessToken: tokenRes.data.access_token, shopName: shop?.shop_name || '' };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { shopId, type, amount, date, time, sender, receiver, note, method, branch } = req.body;
  if (!shopId) return res.status(400).json({ error: 'shopId ไม่ถูกต้อง' });
  if (type !== 'รายรับ' && type !== 'รายจ่าย') return res.status(400).json({ error: 'ประเภทต้องเป็น รายรับ หรือ รายจ่าย' });
  if (!branch) return res.status(400).json({ error: 'ต้องระบุสาขา' });
  const amountNum = parseFloat(amount);
  if (isNaN(amountNum) || amountNum <= 0) return res.status(400).json({ error: 'จำนวนเงินไม่ถูกต้อง' });

  try {
    const access = await getSheetAccess(shopId);
    if (!access) return res.status(400).json({ error: 'ยังไม่ได้เชื่อมต่อ Google Sheets' });

    // กำหนดวันที่ — ถ้าไม่ส่งมาใช้วันนี้
    const now = new Date();
    const todayStr = `${String(now.getDate()).padStart(2,'0')}/${String(now.getMonth()+1).padStart(2,'0')}/${now.getFullYear()}`;
    const timeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    const recordedAt = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

    // ref hash — ใช้ timestamp เป็น fingerprint กันซ้ำ
    const ref = 'manual-' + crypto.createHash('md5').update(String(Date.now())).digest('hex').substring(0, 12);
    const targetYear = now.getFullYear().toString();

    // ตรวจว่า tab ปีมีอยู่ไหม — ถ้าไม่มีสร้างใหม่
    const sheetsMetaRes = await axios.get(
      `https://sheets.googleapis.com/v4/spreadsheets/${access.sheetId}`,
      { headers: { Authorization: `Bearer ${access.accessToken}` } }
    );
    const tabs = sheetsMetaRes.data.sheets.map(s => s.properties.title);
    if (!tabs.includes(targetYear)) {
      // สร้าง tab ปีใหม่
      await axios.post(
        `https://sheets.googleapis.com/v4/spreadsheets/${access.sheetId}:batchUpdate`,
        { requests: [{ addSheet: { properties: { title: targetYear } } }] },
        { headers: { Authorization: `Bearer ${access.accessToken}`, 'Content-Type': 'application/json' } }
      );
      // ใส่ header — ให้ตรงกับโครงสร้างเดียวกันกับที่บอท LINE ใช้ (18 คอลัมน์)
      await axios.put(
        `https://sheets.googleapis.com/v4/spreadsheets/${access.sheetId}/values/${encodeURIComponent(targetYear + '!A1:R1')}?valueInputOption=RAW`,
        { values: [['วันที่สลิป','เวลา','ประเภท (รายรับ/รายจ่าย)','จำนวนเงิน (บาท)','ผู้โอน','ผู้รับ','หมายเหตุ','ลิงก์สลิป (Drive)','วันที่บันทึก (recorded_at)','ชื่อสาขา','เลขอ้างอิง/Hash','เลขภาษี','ชื่อผู้เสียภาษี','ยอดภาษี (บาท)','ที่อยู่ผู้เสียภาษี','หมวดหมู่','วิธีรับ-จ่าย (โอน/เงินสด)','ผู้บันทึก']] },
        { headers: { Authorization: `Bearer ${access.accessToken}`, 'Content-Type': 'application/json' } }
      );
    }

    // Append แถวใหม่
    await axios.post(
      `https://sheets.googleapis.com/v4/spreadsheets/${access.sheetId}/values/${encodeURIComponent(targetYear + '!A:R')}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      { values: [[
        date || todayStr,
        time || timeStr,
        type,
        amountNum,
        sender || '-',
        receiver || '-',
        note || '-',
        'ไม่มีรูปภาพ (คีย์เอง)',
        recordedAt,
        branch || access.shopName || '-',
        ref,
        '-', '-', '-', '-',     // L-O: เลขภาษี/ชื่อผู้เสียภาษี/ยอดภาษี/ที่อยู่
        '-',                    // P: หมวดหมู่
        method === 'เงินสด' ? 'เงินสด' : 'โอน', // Q: วิธีรับ-จ่าย
        'เจ้าของร้าน (เว็บ)',    // R: ผู้บันทึก
      ]] },
      { headers: { Authorization: `Bearer ${access.accessToken}`, 'Content-Type': 'application/json' } }
    );

    return res.status(200).json({ success: true, ref });
  } catch (err) {
    console.error('[API/sheets/add-transaction]', err.response?.data || err.message);
    return res.status(500).json({ error: 'บันทึกไม่สำเร็จ: ' + (err.response?.data?.error?.message || err.message) });
  }
}
