/**
 * GET /api/sheets/tax-report?shopId&year&month&branch&format
 * รายงานภาษีมูลค่าเพิ่ม (ภาษีซื้อ/ภาษีขาย) จากชีตบัญชีหลักของบอท (ปีเป็น tab, คอลัมน์ A-R)
 *
 * ภาษีขาย (Output VAT) = SUM(tax_amount) ของแถวที่ type='รายรับ' (ขาย/รายรับที่มี VAT)
 * ภาษีซื้อ (Input VAT) = SUM(tax_amount) ของแถวที่ type='รายจ่าย' (ซื้อ/รายจ่ายที่มี VAT)
 * ภาษีสุทธิ = ภาษีขาย - ภาษีซื้อ (บวก = ต้องนำส่งกรมสรรพากร, ลบ = ขอคืนได้/ยกไปเดือนถัดไป)
 *
 * branch: ไม่ระบุ = รวมทุกสาขา (branchBreakdown แสดงแยกให้ดูด้วย), ระบุ = กรองเฉพาะสาขานั้น
 * format: csv (เดิม) | xlsx (ใหม่) | pdf (ใหม่, สรุปสำหรับส่งสำนักงานบัญชี) | ไม่ระบุ = JSON
 */
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import * as XLSX from 'xlsx';
import { generateVatReportPdf } from '../../../lib/vat-report-pdf';

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

  const { shopId, year, month, branch } = req.query;
  if (!shopId) return res.status(400).json({ error: 'ไม่พบ shopId' });

  const { data: profile } = await supabase
    .from('shop_profiles')
    .select('subscription_tier, shop_name, address, tax_id, phone')
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
        branch:       row[9]  || 'ไม่ระบุสาขา',
        taxId:        row[11] || '-',
        taxpayerName: row[12] || '-',
        taxAmount:    parseFloat(row[13]) || 0,
        taxAddress:   row[14] || '-',
      }));

    // กรองตามเดือน (ถ้าระบุ)
    let filtered = month
      ? taxRows.filter(r => {
          const parts = (r.date || '').split('/');
          const m = parts[1];
          return m === String(month).padStart(2, '0') || m === String(month);
        })
      : taxRows;

    // แยกตามสาขา (คำนวณก่อนกรอง branch เพื่อให้ branchBreakdown เห็นทุกสาขาเสมอในมุมมอง "รวมทุกสาขา")
    const byBranch = {};
    for (const r of filtered) {
      const key = r.branch;
      if (!byBranch[key]) byBranch[key] = { branch: key, salesVat: 0, purchaseVat: 0, salesCount: 0, purchaseCount: 0 };
      if (r.type === 'รายรับ') { byBranch[key].salesVat += r.taxAmount; byBranch[key].salesCount += 1; }
      else if (r.type === 'รายจ่าย') { byBranch[key].purchaseVat += r.taxAmount; byBranch[key].purchaseCount += 1; }
    }
    const branchBreakdown = Object.values(byBranch)
      .map(b => ({ ...b, netVat: Math.round((b.salesVat - b.purchaseVat) * 100) / 100 }))
      .sort((a, b) => b.salesVat - a.salesVat);

    // กรองตามสาขาที่เลือก (ถ้าระบุ) — ใช้กับตัวเลขสรุป/ตารางที่เหลือทั้งหมด
    if (branch) filtered = filtered.filter(r => r.branch === branch);

    // สรุปตาม tax_id (คู่ค้า/ผู้เสียภาษี)
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
    const salesVat = filtered.filter(r => r.type === 'รายรับ').reduce((s, r) => s + r.taxAmount, 0);
    const purchaseVat = filtered.filter(r => r.type === 'รายจ่าย').reduce((s, r) => s + r.taxAmount, 0);
    const salesCount = filtered.filter(r => r.type === 'รายรับ').length;
    const purchaseCount = filtered.filter(r => r.type === 'รายจ่าย').length;
    const netVat = Math.round((salesVat - purchaseVat) * 100) / 100;

    const reportPayload = {
      rows: filtered,
      summary,
      branchBreakdown,
      grandTotal: Math.round(grandTotal * 100) / 100,
      salesVat: Math.round(salesVat * 100) / 100,
      purchaseVat: Math.round(purchaseVat * 100) / 100,
      salesCount, purchaseCount, netVat,
      totalRows: filtered.length,
      year: sheetYear,
      month: month || null,
      branch: branch || null,
    };

    // ─── PDF Export (สรุปสำหรับส่งสำนักงานบัญชี) ───────────────────────────
    if (req.query.format === 'pdf') {
      const pdfBuffer = await generateVatReportPdf({ ...reportPayload, shopInfo: profile });
      const period = month ? `${month.padStart(2,'0')}-${sheetYear}` : sheetYear;
      const filename = `VATReport_${profile?.shop_name || 'shop'}_${period}.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
      return res.send(pdfBuffer);
    }

    // ─── Excel Export ───────────────────────────────────────────────────
    if (req.query.format === 'xlsx') {
      const period = month ? `${month.padStart(2,'0')}-${sheetYear}` : sheetYear;
      const wb = XLSX.utils.book_new();

      const summarySheet = [
        ['รายงานภาษีมูลค่าเพิ่ม', `ร้าน: ${profile?.shop_name || ''}`],
        ['ช่วงเวลา', month ? `${month}/${sheetYear}` : `ปี ${sheetYear}`],
        ['สาขา', branch || 'รวมทุกสาขา'],
        [''],
        ['รายการ', 'จำนวนเงิน (บาท)', 'จำนวนรายการ'],
        ['ภาษีขาย (Output VAT)', reportPayload.salesVat, salesCount],
        ['ภาษีซื้อ (Input VAT)', reportPayload.purchaseVat, purchaseCount],
        [netVat >= 0 ? 'ภาษีที่ต้องนำส่ง' : 'ภาษีที่ขอคืนได้', Math.abs(netVat), salesCount + purchaseCount],
        [''],
        ['Export วันที่', new Date().toLocaleDateString('th-TH')],
      ];
      const wsSummary = XLSX.utils.aoa_to_sheet(summarySheet);
      wsSummary['!cols'] = [{ wch: 26 }, { wch: 18 }, { wch: 14 }];
      XLSX.utils.book_append_sheet(wb, wsSummary, 'สรุป');

      if (branchBreakdown.length > 1) {
        const branchHeaders = ['สาขา', 'ภาษีขาย', 'ภาษีซื้อ', 'สุทธิ', 'รายการขาย', 'รายการซื้อ'];
        const branchRows = branchBreakdown.map(b => [b.branch, b.salesVat, b.purchaseVat, b.netVat, b.salesCount, b.purchaseCount]);
        const wsBranch = XLSX.utils.aoa_to_sheet([branchHeaders, ...branchRows]);
        wsBranch['!cols'] = [{ wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 12 }];
        XLSX.utils.book_append_sheet(wb, wsBranch, 'แยกตามสาขา');
      }

      const taxpayerHeaders = ['ชื่อผู้เสียภาษี', 'เลขประจำตัวผู้เสียภาษี', 'ที่อยู่', 'จำนวนรายการ', 'ยอดภาษีรวม'];
      const taxpayerRows = summary.map(s => [s.taxpayerName, s.taxId, s.taxAddress, s.transactionCount, s.totalTaxAmount]);
      const wsTaxpayer = XLSX.utils.aoa_to_sheet([taxpayerHeaders, ...taxpayerRows]);
      wsTaxpayer['!cols'] = [{ wch: 28 }, { wch: 18 }, { wch: 30 }, { wch: 12 }, { wch: 14 }];
      XLSX.utils.book_append_sheet(wb, wsTaxpayer, 'สรุปตามคู่ค้า');

      const rowHeaders = ['วันที่สลิป','ประเภท','จำนวนเงิน (บาท)','หมายเหตุ','ชื่อสาขา','เลขประจำตัวผู้เสียภาษี','ชื่อผู้เสียภาษี','ยอดภาษีมูลค่าเพิ่ม (บาท)','ที่อยู่ผู้เสียภาษี'];
      const dataRows = filtered.map(r => [r.date, r.type, r.amount, r.note, r.branch, r.taxId, r.taxpayerName, r.taxAmount, r.taxAddress]);
      const wsRows = XLSX.utils.aoa_to_sheet([rowHeaders, ...dataRows]);
      wsRows['!cols'] = [{ wch: 12 }, { wch: 10 }, { wch: 14 }, { wch: 24 }, { wch: 16 }, { wch: 18 }, { wch: 26 }, { wch: 14 }, { wch: 30 }];
      XLSX.utils.book_append_sheet(wb, wsRows, 'รายการทั้งหมด');

      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      const filename = `VATReport_${profile?.shop_name || 'shop'}_${period}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
      return res.send(buffer);
    }

    // ─── CSV Export (เดิม) ─────────────────────────────────────────────
    if (req.query.format === 'csv') {
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

      dataRows.push([]);
      dataRows.push(['', '', '', '', '', '', 'ภาษีขายรวม', reportPayload.salesVat, '']);
      dataRows.push(['', '', '', '', '', '', 'ภาษีซื้อรวม', reportPayload.purchaseVat, '']);
      dataRows.push(['', '', '', '', '', '', netVat >= 0 ? 'ภาษีที่ต้องนำส่ง' : 'ภาษีที่ขอคืนได้', Math.abs(netVat), '']);

      const csvLines = [headerRow, ...dataRows].map(row =>
        row.map(v => {
          const s = String(v ?? '').replace(/"/g, '""');
          return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
        }).join(',')
      );

      const csv = '﻿' + csvLines.join('\r\n');
      const period = month ? `${month.padStart(2,'0')}-${sheetYear}` : sheetYear;
      const filename = `TaxReport_${profile?.shop_name || 'shop'}_${period}.csv`;

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
      return res.send(csv);
    }

    // ─── JSON response ────────────────────────────────────────────
    return res.status(200).json(reportPayload);

  } catch (err) {
    console.error('[tax-report] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
