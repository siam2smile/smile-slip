/**
 * สร้าง PDF สรุปรายงานภาษีมูลค่าเพิ่ม (ภาษีซื้อ/ภาษีขาย) สำหรับส่งให้สำนักงานบัญชีภายนอก
 * ใช้ pdfkit + Sarabun Thai font (pattern เดียวกับ lib/invoice-pdf.js / lib/pos-tax-invoice-pdf.js)
 *
 * เป็นรายงานสรุประดับบริหาร (executive summary) ไม่ใช่รายการละเอียดทุกแถว — รายการละเอียดทุกแถว
 * ให้ export Excel/CSV แทน (ข้อมูลเยอะเกินจะพิมพ์ PDF อ่านง่าย) — PDF นี้มีพอสำหรับนักบัญชียื่น ภ.พ.30
 * และกระทบยอดเบื้องต้นได้ทันที: ยอดภาษีขาย/ซื้อรวม, แยกตามสาขา, แยกตามคู่ค้า/ผู้เสียภาษี
 */
import PDFDocument from 'pdfkit';
import path from 'path';

const FONT_PATH      = path.join(process.cwd(), 'fonts', 'Sarabun-Regular.ttf');
const FONT_BOLD_PATH = path.join(process.cwd(), 'fonts', 'Sarabun-Bold.ttf');

function fmt(n) {
  return Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// report: { shopInfo:{shop_name,address,tax_id,phone}, year, month, salesVat, purchaseVat, netVat,
//           salesCount, purchaseCount, branchBreakdown:[{branch,salesVat,purchaseVat,netVat,salesCount,purchaseCount}],
//           summary:[{taxId,taxpayerName,totalTaxAmount,transactionCount}] }
export function generateVatReportPdf(report) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, autoFirstPage: true, info: {
      Title: `รายงานภาษีมูลค่าเพิ่ม ${report.year || ''}`,
      Author: report.shopInfo?.shop_name || (report.isWhiteLabel ? '' : 'Smile Slip Pro'),
      Subject: 'VAT Report / รายงานภาษีมูลค่าเพิ่ม',
    }});

    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.registerFont('Sarabun', FONT_PATH);
    doc.registerFont('Sarabun-Bold', FONT_BOLD_PATH);

    const pageWidth = doc.page.width - 80; // margin 40 ทั้งสองข้าง
    const bottomLimit = doc.page.height - 60;
    let y = 40;

    const ensureSpace = (needed) => {
      if (y + needed > bottomLimit) { doc.addPage(); y = 40; }
    };

    // ── Header ──────────────────────────────────────────────────────────────
    doc.font('Sarabun-Bold').fontSize(16).text(report.shopInfo?.shop_name || '-', 40, y, { width: pageWidth });
    y += 22;
    if (report.shopInfo?.address) {
      doc.font('Sarabun').fontSize(9).fillColor('#555').text(report.shopInfo.address, 40, y, { width: pageWidth });
      y += 14;
    }
    if (report.shopInfo?.tax_id) {
      doc.font('Sarabun').fontSize(9).fillColor('#555').text(`เลขประจำตัวผู้เสียภาษี ${report.shopInfo.tax_id}`, 40, y);
      y += 14;
    }
    doc.fillColor('#000');
    y += 8;
    doc.font('Sarabun-Bold').fontSize(14).text('รายงานภาษีมูลค่าเพิ่ม (สรุป)', 40, y, { width: pageWidth, align: 'center' });
    y += 20;
    const periodLabel = report.month
      ? `เดือน ${['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'][parseInt(report.month, 10) - 1]} ${report.year}`
      : `ปี ${report.year}`;
    doc.font('Sarabun').fontSize(10).text(periodLabel, 40, y, { width: pageWidth, align: 'center' });
    y += 24;

    // ── สรุปยอดภาษีขาย/ซื้อ/สุทธิ ─────────────────────────────────────────────
    const boxW = (pageWidth - 20) / 3;
    const drawBox = (x, label, value, color) => {
      doc.roundedRect(x, y, boxW, 54, 6).fillAndStroke('#f8f9fb', '#e5e7eb');
      doc.fillColor('#666').font('Sarabun').fontSize(9).text(label, x + 10, y + 8, { width: boxW - 20 });
      doc.fillColor(color).font('Sarabun-Bold').fontSize(15).text(`฿${fmt(value)}`, x + 10, y + 24, { width: boxW - 20 });
      doc.fillColor('#000');
    };
    drawBox(40, 'ภาษีขาย (Output VAT)', report.salesVat, '#059669');
    drawBox(40 + boxW + 10, 'ภาษีซื้อ (Input VAT)', report.purchaseVat, '#dc2626');
    drawBox(40 + (boxW + 10) * 2, report.netVat >= 0 ? 'ภาษีที่ต้องนำส่ง' : 'ภาษีที่ขอคืนได้', Math.abs(report.netVat), '#4f46e5');
    y += 68;

    doc.font('Sarabun').fontSize(9).fillColor('#666')
      .text(`รายการขายที่มี VAT ${report.salesCount || 0} รายการ · รายการซื้อที่มี VAT ${report.purchaseCount || 0} รายการ`, 40, y);
    doc.fillColor('#000');
    y += 24;

    // ── แยกตามสาขา ──────────────────────────────────────────────────────────
    if (report.branchBreakdown?.length > 1) {
      ensureSpace(30 + report.branchBreakdown.length * 18);
      doc.font('Sarabun-Bold').fontSize(11).text('แยกตามสาขา', 40, y);
      y += 18;
      const colX = [40, 200, 320, 440];
      doc.font('Sarabun-Bold').fontSize(9).fillColor('#666');
      doc.text('สาขา', colX[0], y, { width: 150 });
      doc.text('ภาษีขาย', colX[1], y, { width: 110, align: 'right' });
      doc.text('ภาษีซื้อ', colX[2], y, { width: 110, align: 'right' });
      doc.text('สุทธิ', colX[3], y, { width: pageWidth - 400, align: 'right' });
      doc.fillColor('#000');
      y += 14;
      doc.moveTo(40, y).lineTo(40 + pageWidth, y).strokeColor('#e5e7eb').stroke();
      y += 4;
      for (const b of report.branchBreakdown) {
        ensureSpace(18);
        doc.font('Sarabun').fontSize(9);
        doc.text(b.branch, colX[0], y, { width: 150 });
        doc.text(fmt(b.salesVat), colX[1], y, { width: 110, align: 'right' });
        doc.text(fmt(b.purchaseVat), colX[2], y, { width: 110, align: 'right' });
        doc.text(fmt(b.netVat), colX[3], y, { width: pageWidth - 400, align: 'right' });
        y += 16;
      }
      y += 12;
    }

    // ── แยกตามคู่ค้า/ผู้เสียภาษี ────────────────────────────────────────────
    if (report.summary?.length > 0) {
      ensureSpace(40);
      doc.font('Sarabun-Bold').fontSize(11).text('สรุปตามคู่ค้า / ผู้เสียภาษี', 40, y);
      y += 18;
      const colX = [40, 220, 340, 440];
      doc.font('Sarabun-Bold').fontSize(9).fillColor('#666');
      doc.text('ชื่อ', colX[0], y, { width: 170 });
      doc.text('เลขประจำตัวผู้เสียภาษี', colX[1], y, { width: 110 });
      doc.text('รายการ', colX[2], y, { width: 90, align: 'right' });
      doc.text('ยอดภาษี', colX[3], y, { width: pageWidth - 400, align: 'right' });
      doc.fillColor('#000');
      y += 14;
      doc.moveTo(40, y).lineTo(40 + pageWidth, y).strokeColor('#e5e7eb').stroke();
      y += 4;
      for (const s of report.summary) {
        ensureSpace(18);
        doc.font('Sarabun').fontSize(9);
        doc.text(s.taxpayerName, colX[0], y, { width: 170, height: 14, ellipsis: true });
        doc.text(s.taxId, colX[1], y, { width: 110, height: 14, ellipsis: true });
        doc.text(String(s.transactionCount), colX[2], y, { width: 90, align: 'right' });
        doc.text(fmt(s.totalTaxAmount), colX[3], y, { width: pageWidth - 400, align: 'right' });
        y += 16;
      }
    }

    ensureSpace(30);
    y += 10;
    const printedAt = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
    const footerText = report.isWhiteLabel
      ? `พิมพ์เมื่อ ${printedAt}`
      : `จัดทำโดยระบบ Smile Slip Pro — พิมพ์เมื่อ ${printedAt}`;
    doc.font('Sarabun').fontSize(8).fillColor('#999')
      .text(footerText, 40, y, { width: pageWidth, align: 'center' });

    doc.end();
  });
}
