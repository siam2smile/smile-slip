/**
 * POST /api/pos/confirm-payment
 * { shopId, billNo, slipUrl, slipSender, slipRefNo }
 * อัปเดตสถานะบิล "รอยืนยัน" → "ชำระแล้ว" + เขียน main Sheets
 */
import { createClient } from '@supabase/supabase-js';
import {
  getAccessToken, readSheet, updateSheetRow, appendSheet, ensureTabExists,
  rowToSale, SALE_HEADERS,
} from '../../../lib/google-pos';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { shopId, billNo, slipUrl = '', slipSender = '', slipRefNo = '' } = req.body || {};
  if (!shopId || !billNo) return res.status(400).json({ error: 'Missing shopId or billNo' });

  try {
    const [{ data: pc }, { data: gc }, { data: sp }] = await Promise.all([
      supabase.from('pos_configs').select('pos_sheet_id').eq('shop_id', shopId).single(),
      supabase.from('shop_google_configs').select('google_refresh_token, google_sheet_id').eq('shop_id', shopId).single(),
      supabase.from('shop_profiles').select('shop_name, branch_name').eq('id', shopId).single(),
    ]);

    if (!pc?.pos_sheet_id || !gc?.google_refresh_token) {
      return res.status(400).json({ error: 'ยังไม่ได้ตั้งค่า POS หรือ Google' });
    }

    const token = await getAccessToken(gc.google_refresh_token);
    await ensureTabExists(token, pc.pos_sheet_id, 'ยอดขาย', SALE_HEADERS);

    // หาแถวบิลนั้นใน POS Sheets
    const rows = await readSheet(token, pc.pos_sheet_id, 'ยอดขาย!A:L');
    const dataRows = rows.slice(1);
    const idx = dataRows.findIndex(r => r[0] === billNo);
    if (idx === -1) return res.status(404).json({ error: 'ไม่พบบิล' });

    const rowNum = idx + 2;
    const existing = [...dataRows[idx]];
    while (existing.length < 12) existing.push('');

    if (existing[11] === 'ชำระแล้ว') {
      return res.json({ ok: true, message: 'บิลนี้ยืนยันแล้ว' });
    }

    // อัปเดตสถานะ → ชำระแล้ว
    existing[11] = 'ชำระแล้ว';
    await updateSheetRow(token, pc.pos_sheet_id, 'ยอดขาย', rowNum, existing);

    // เขียนรายได้เข้า Main Sheets
    if (gc.google_sheet_id) {
      try {
        const sale = rowToSale(dataRows[idx]);
        const now = new Date();
        const thaiLocale = { timeZone: 'Asia/Bangkok' };
        const year = now.getFullYear().toString();
        const thaiDate = now.toLocaleDateString('th-TH', { ...thaiLocale, day: '2-digit', month: '2-digit', year: 'numeric' });
        const thaiTime = now.toLocaleTimeString('th-TH', thaiLocale);
        const todayISO = now.toLocaleDateString('en-CA', thaiLocale);

        // ตรวจ/สร้าง tab ปี
        const metaRes = await fetch(`${SHEETS_BASE}/${gc.google_sheet_id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const meta = await metaRes.json();
        if (!meta.sheets?.some(s => s.properties.title === year)) {
          await fetch(`${SHEETS_BASE}/${gc.google_sheet_id}:batchUpdate`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ requests: [{ addSheet: { properties: { title: year } } }] }),
          });
          const hdrs = [
            'วันที่สลิป','เวลา','ประเภท (รายรับ/รายจ่าย)','จำนวนเงิน (บาท)',
            'ผู้โอน','ผู้รับ','หมายเหตุ','ลิงก์สลิป (Drive)','วันที่บันทึก (recorded_at)',
            'ชื่อสาขา','เลขอ้างอิง/Hash','เลขภาษี','ชื่อผู้เสียภาษี','ยอดภาษี (บาท)',
            'ที่อยู่ผู้เสียภาษี','หมวดหมู่','วิธีรับ-จ่าย (โอน/เงินสด)','ผู้บันทึก',
          ];
          await appendSheet(token, gc.google_sheet_id, year, hdrs);
        }

        const itemsSummary = sale.items.map(i => `${i.name}×${i.qty}`).join(', ');
        const senderName = slipSender || 'โอนหน้าร้าน';
        const noteText = [`ขายหน้าร้าน`, itemsSummary, sale.notes].filter(Boolean).join(' | ');

        await appendSheet(token, gc.google_sheet_id, year, [
          thaiDate, thaiTime, 'รายรับ', sale.total,
          senderName,
          sp?.shop_name || '',
          noteText,
          slipUrl || '',
          todayISO,
          sp?.branch_name || sp?.shop_name || '',
          slipRefNo || billNo,
          '', '', '', '',
          'ขายหน้าร้าน',
          'โอน',
          '',
        ]);
      } catch (sheetErr) {
        console.error('[confirm-payment] main sheets error:', sheetErr.message);
      }
    }

    return res.json({ ok: true, billNo });

  } catch (err) {
    console.error('[confirm-payment]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
