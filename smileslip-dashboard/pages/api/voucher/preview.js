/**
 * GET /api/voucher/preview?type=รายจ่าย&amount=1500&date=...&sender=...&receiver=...&note=...&shopName=...&shopAddress=...&branch=...
 * คืน PDF inline (ไม่ save) สำหรับแสดง preview ก่อนบันทึก
 */
import PDFDocument from 'pdfkit';
import path from 'path';

function bahtText(amount) {
  const n = Math.abs(parseFloat(amount) || 0);
  const ones = ['','หนึ่ง','สอง','สาม','สี่','ห้า','หก','เจ็ด','แปด','เก้า'];
  const teens = ['สิบ','สิบเอ็ด','สิบสอง','สิบสาม','สิบสี่','สิบห้า','สิบหก','สิบเจ็ด','สิบแปด','สิบเก้า'];
  const tens  = ['','','ยี่สิบ','สามสิบ','สี่สิบ','ห้าสิบ','หกสิบ','เจ็ดสิบ','แปดสิบ','เก้าสิบ'];
  function below100(x) {
    if (x < 10) return ones[x];
    if (x < 20) return teens[x - 10];
    return tens[Math.floor(x/10)] + (x % 10 ? ones[x % 10] : '');
  }
  function below1000(x) {
    if (x < 100) return below100(x);
    return ones[Math.floor(x/100)] + 'ร้อย' + (x % 100 ? below100(x % 100) : '');
  }
  function below10000(x) {
    if (x < 1000) return below1000(x);
    return below1000(Math.floor(x/1000)) + 'พัน' + (x % 1000 ? below1000(x % 1000) : '');
  }
  function below100000(x) {
    if (x < 10000) return below10000(x);
    return below10000(Math.floor(x/10000)) + 'หมื่น' + (x % 10000 ? below10000(x % 10000) : '');
  }
  function below1000000(x) {
    if (x < 100000) return below100000(x);
    return below100000(Math.floor(x/100000)) + 'แสน' + (x % 100000 ? below100000(x % 100000) : '');
  }
  const intPart = Math.floor(n);
  const satang = Math.round((n - intPart) * 100);
  let txt = '';
  if (intPart >= 1000000) {
    txt += below1000000(Math.floor(intPart/1000000)) + 'ล้าน';
    const rem = intPart % 1000000;
    if (rem) txt += below1000000(rem);
  } else {
    txt += below1000000(intPart);
  }
  txt += 'บาท';
  if (satang > 0) txt += below100(satang) + 'สตางค์';
  else txt += 'ถ้วน';
  return txt;
}

function buildPdf(params, doc) {
  const { type, amount, date, time, sender, receiver, note, category,
          shopName, shopAddress, branch, voucherNo } = params;

  const isExpense = type === 'รายจ่าย';
  const title     = isExpense ? 'ใบสำคัญจ่าย' : 'ใบสำคัญรับ';
  const titleEn   = isExpense ? 'PAYMENT VOUCHER' : 'RECEIPT VOUCHER';
  const headerBg  = isExpense ? '#991b1b' : '#064e3b';
  const fmt = (n) => parseFloat(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 });

  const fontR = path.join(process.cwd(), 'fonts', 'Sarabun-Regular.ttf');
  const fontB = path.join(process.cwd(), 'fonts', 'Sarabun-Bold.ttf');
  doc.registerFont('R', fontR).registerFont('B', fontB);

  const W = doc.page.width;

  // ── Header bar ──
  doc.rect(0, 0, W, 72).fill(headerBg);
  doc.font('B').fontSize(20).fillColor('#fff').text(title, 40, 14);
  doc.font('R').fontSize(10).fillColor('#fca5a5').text(titleEn, 40, 40);

  // เลขที่ + วันที่ (top-right)
  doc.font('B').fontSize(9).fillColor('#fef2f2').text(`เลขที่: ${voucherNo}`, W - 200, 14, { width: 160, align: 'right' });
  doc.font('R').fontSize(9).fillColor('#fca5a5').text(`วันที่: ${date || ''}  ${time || ''}`, W - 200, 34, { width: 160, align: 'right' });

  let y = 90;

  // ── Shop info box ──
  doc.rect(40, y, W - 80, 48).fillAndStroke('#f8fafc', '#e2e8f0');
  doc.font('B').fontSize(11).fillColor('#1e293b').text(shopName || '', 52, y + 8, { width: W - 104 });
  doc.font('R').fontSize(8).fillColor('#64748b').text(shopAddress || '', 52, y + 26, { width: W - 104 });
  y += 60;

  // ── Main fields ──
  const row = (label, value, color = '#1e293b') => {
    doc.rect(40, y, W - 80, 22).fill(y % 44 < 22 ? '#ffffff' : '#f8fafc');
    doc.font('R').fontSize(8).fillColor('#64748b').text(label, 52, y + 6, { width: 120 });
    doc.font('B').fontSize(9).fillColor(color).text(value || '-', 172, y + 6, { width: W - 230 });
    y += 22;
  };

  doc.rect(40, y, W - 80, 22).fill('#1e293b');
  doc.font('B').fontSize(8).fillColor('#fff').text('รายละเอียดการ' + (isExpense ? 'จ่าย' : 'รับ'), 52, y + 6);
  y += 22;

  row(isExpense ? 'จ่ายให้' : 'รับจาก', isExpense ? (receiver || '-') : (sender || '-'));
  row(isExpense ? 'ผู้จ่ายเงิน' : 'ผู้รับเงิน', isExpense ? (sender || '-') : (receiver || '-'));
  row('จำนวนเงิน', `${fmt(amount)} บาท`, isExpense ? '#991b1b' : '#064e3b');
  row('จำนวนตัวอักษร', `(${bahtText(amount)})`);
  row('รายละเอียด', note || '-');
  if (category) row('หมวดหมู่', category);
  if (branch)   row('สาขา', branch);

  y += 16;

  // ── Signature block ──
  if (y > doc.page.height - 120) { doc.addPage(); y = 40; }
  const sigW = (W - 80 - 20) / 2;
  ['ผู้' + (isExpense ? 'จ่าย' : 'รับ') + 'เงิน', 'ผู้อนุมัติ'].forEach((label, i) => {
    const x = 40 + i * (sigW + 20);
    doc.rect(x, y, sigW, 70).fillAndStroke('#fafafa', '#e2e8f0');
    doc.font('B').fontSize(8).fillColor('#64748b').text(label, x, y + 8, { width: sigW, align: 'center' });
    doc.moveTo(x + 16, y + 44).lineTo(x + sigW - 16, y + 44).strokeColor('#94a3b8').lineWidth(0.5).stroke();
    doc.font('R').fontSize(7).fillColor('#94a3b8').text('ลายเซ็น / วันที่', x, y + 50, { width: sigW, align: 'center' });
  });

  y += 86;
  doc.moveTo(40, y).lineTo(W - 40, y).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
  doc.font('R').fontSize(7).fillColor('#94a3b8')
    .text('สร้างโดย Smile Slip Pro — เอกสารฉบับนี้ใช้เป็นหลักฐานทางบัญชีและภาษี', 40, y + 6, { align: 'center', width: W - 80 });
}

export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { type, amount, date, time, sender, receiver, note, category,
          shopName, shopAddress, branch } = req.query;

  const isExpense = type === 'รายจ่าย';
  const prefix    = isExpense ? 'PV' : 'RV';
  const voucherNo = `${prefix}-${new Date().toISOString().replace(/[-T:Z.]/g,'').slice(0,14)}`;

  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="voucher-preview.pdf"');
  doc.pipe(res);

  buildPdf({ type, amount, date, time, sender, receiver, note, category,
             shopName, shopAddress, branch, voucherNo }, doc);
  doc.end();
}
