import { createClient } from '@supabase/supabase-js';
import axios from 'axios';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

const TIER_LEVEL = { normal: 0, pro: 1, advance: 2, business: 3, enterprise: 4, super: 4 };

async function getAccessToken(refreshToken) {
  const res = await axios.post('https://oauth2.googleapis.com/token', {
    refresh_token: refreshToken,
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    grant_type: 'refresh_token',
  });
  return res.data.access_token;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { shopId, year, month } = req.query;
  if (!shopId) return res.status(400).json({ error: 'ไม่พบ shopId' });

  const { data: profile } = await supabase
    .from('shop_profiles')
    .select('subscription_tier')
    .eq('id', shopId)
    .maybeSingle();

  const tier = (profile?.subscription_tier || 'normal').toLowerCase();
  if (TIER_LEVEL[tier] < TIER_LEVEL['business']) {
    return res.status(403).json({ error: 'ฟีเจอร์นี้รองรับเฉพาะแพ็กเกจ Business ขึ้นไป' });
  }

  const { data: googleConfig } = await supabase
    .from('shop_google_configs')
    .select('google_refresh_token, google_sheet_id')
    .eq('shop_id', shopId)
    .maybeSingle();

  if (!googleConfig?.google_refresh_token || !googleConfig?.google_sheet_id) {
    return res.status(400).json({ error: 'ยังไม่ได้เชื่อมต่อ Google Sheets' });
  }

  try {
    const accessToken = await getAccessToken(googleConfig.google_refresh_token);
    const sheetYear = year || new Date().getFullYear().toString();
    const sheetRange = encodeURIComponent(`${sheetYear}!A2:O`);

    const sheetsRes = await axios.get(
      `https://sheets.googleapis.com/v4/spreadsheets/${googleConfig.google_sheet_id}/values/${sheetRange}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    const rows = sheetsRes.data.values || [];

    // กรองเฉพาะแถวที่มีข้อมูลภาษีครบ: taxId (L) ต้องไม่ว่าง และ taxAmount (N) ต้องมากกว่า 0
    const taxRows = rows
      .filter(row => {
        const hasTaxId = row[11] && row[11] !== '-' && row[11].trim() !== '';
        const taxAmt = parseFloat(row[13]) || 0;
        return hasTaxId && taxAmt > 0;
      })
      .map(row => ({
        date:         row[0]  || '-',
        type:         row[2]  || '-',
        amount:       parseFloat(row[3]) || 0,
        note:         row[6]  || '-',
        branch:       row[9]  || '-',
        taxId:        row[11] || '-',
        taxpayerName: row[12] || '-',
        taxAmount:    parseFloat(row[13]) || 0,
        taxAddress:   row[14] || '-',
      }));

    // กรองตามเดือน (ถ้าระบุ)
    const filtered = month
      ? taxRows.filter(r => {
          const parts = (r.date || '').split('/');
          const m = parts[1];
          return m === String(month).padStart(2, '0') || m === String(month);
        })
      : taxRows;

    // สรุปตาม tax_id
    const byTaxId = {};
    for (const row of filtered) {
      const key = row.taxId;
      if (!byTaxId[key]) {
        byTaxId[key] = {
          taxId: row.taxId,
          taxpayerName: row.taxpayerName,
          taxAddress: row.taxAddress,
          totalTaxAmount: 0,
          transactionCount: 0,
          transactions: [],
        };
      }
      byTaxId[key].totalTaxAmount += row.taxAmount;
      byTaxId[key].transactionCount += 1;
      byTaxId[key].transactions.push(row);
    }

    const summary = Object.values(byTaxId).sort((a, b) => b.totalTaxAmount - a.totalTaxAmount);
    const grandTotal = filtered.reduce((s, r) => s + r.taxAmount, 0);

    // ─── CSV Export ─────────────────────────────────────────────
    if (req.query.format === 'csv') {
      const shopName = (await supabase
        .from('shop_profiles').select('shop_name').eq('id', shopId).maybeSingle()
      ).data?.shop_name || 'shop';

      const headerRow = [
        'วันที่สลิป','ประเภท','จำนวนเงิน (บาท)','หมายเหตุ','ชื่อสาขา',
        'เลขประจำตัวผู้เสียภาษี','ชื่อผู้เสียภาษี','ยอดภาษีมูลค่าเพิ่ม (บาท)','ที่อยู่ผู้เสียภาษี',
      ];

      const dataRows = filtered.map(r => [
        r.date, r.type,
        r.amount.toFixed(2),
        r.note, r.branch,
        r.taxId, r.taxpayerName,
        r.taxAmount.toFixed(2),
        r.taxAddress,
      ]);

      // แถวสรุป
      dataRows.push([]);
      dataRows.push(['', '', '', '', '', '', 'รวมภาษีมูลค่าเพิ่มทั้งหมด', Math.round(grandTotal * 100) / 100, '']);

      const csvLines = [headerRow, ...dataRows].map(row =>
        row.map(v => {
          const s = String(v ?? '').replace(/"/g, '""');
          return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
        }).join(',')
      );

      // BOM สำหรับ Excel เปิดภาษาไทยได้
      const csv = '﻿' + csvLines.join('\r\n');
      const period = month ? `${month.padStart(2,'0')}-${sheetYear}` : sheetYear;
      const filename = `TaxReport_${shopName}_${period}.csv`;

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
      return res.send(csv);
    }

    // ─── JSON response ────────────────────────────────────────────
    return res.status(200).json({
      rows: filtered,
      summary,
      grandTotal: Math.round(grandTotal * 100) / 100,
      totalRows: filtered.length,
      year: sheetYear,
      month: month || null,
    });

  } catch (err) {
    console.error('[tax-report] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
