/**
 * สร้าง PDF ใบกำกับภาษี/ใบเสร็จรับเงิน (A4) ที่ร้านค้า (POS) ออกให้ลูกค้าของร้านเอง
 * คนละไฟล์กับ lib/invoice-pdf.js (อันนั้นใช้เฉพาะใบกำกับภาษีที่ Smile Slip Pro ออกให้ร้านตอนซื้อแพ็กเกจ —
 * ข้อมูลผู้ขายตายตัวเป็นบริษัทเดียว) — ไฟล์นี้ใช้ shopInfo ของร้านที่ล็อกอินอยู่แทน + รองรับหลายรายการสินค้า
 * (ต้นฉบับรองรับแค่ 1 รายการเพราะเป็นค่าแพ็กเกจรายเดือน/ปี)
 */
import PDFDocument from 'pdfkit';
import path from 'path';

const FONT_PATH      = path.join(process.cwd(), 'fonts', 'Sarabun-Regular.ttf');
const FONT_BOLD_PATH = path.join(process.cwd(), 'fonts', 'Sarabun-Bold.ttf');

function fmt(n) {
  return Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function bahtText(amount) {
  const ones = ['','หนึ่ง','สอง','สาม','สี่','ห้า','หก','เจ็ด','แปด','เก้า'];
  function spell(n) {
    if (!n) return '';
    const units = [[1000000,'ล้าน'],[100000,'แสน'],[10000,'หมื่น'],[1000,'พัน'],[100,'ร้อย']];
    let s = '';
    for (const [d,label] of units) {
      const q = Math.floor(n / d);
      if (q) { s += ones[q] + label; n %= d; }
    }
    const ten = Math.floor(n / 10), one = n % 10;
    if (ten === 1) s += 'สิบ';
    else if (ten === 2) s += 'ยี่สิบ';
    else if (ten > 0) s += ones[ten] + 'สิบ';
    if (one === 1 && ten > 0) s += 'เอ็ด';
    else if (one > 0) s += ones[one];
    return s;
  }
  const v = Math.round(Number(amount || 0) * 100) / 100;
  const baht = Math.floor(v);
  const satang = Math.round((v - baht) * 100);
  return (baht ? spell(baht) : 'ศูนย์') + 'บาท' + (satang ? spell(satang) + 'สตางค์' : 'ถ้วน');
}

function t(doc, text, x, y, opts = {}) {
  doc.text(String(text), x, y, { lineBreak: false, ...opts });
}

// inv: { invoice_no, issued_at, ref_bill_no, shopInfo:{shop_name,address,tax_id,phone},
//        buyer:{name,tax_id,address,branch,phone}, items:[{name,qty,unit,price}],
//        subtotal, vat, total, issued_by }
export function generatePosTaxInvoicePdf(inv) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: true, info: {
      Title:   `ใบกำกับภาษี ${inv.invoice_no || ''}`,
      Author:  inv.shopInfo?.shop_name || (inv.isWhiteLabel ? '' : 'Smile Slip Pro'),
      Subject: 'Tax Invoice / ใบกำกับภาษี / ใบเสร็จรับเงิน',
    }});

    const chunks = [];
    doc.on('data',  c => chunks.push(c));
    doc.on('end',   () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.registerFont('Thai',     FONT_PATH);
    doc.registerFont('ThaiBold', FONT_BOLD_PATH);

    const W  = 595.28;
    const H  = 841.89;
    const mX = 36;
    const U  = W - mX * 2;
    const bottomLimit = H - 50;

    const seller = inv.shopInfo || {};
    const buyer  = inv.buyer || {};
    const items  = inv.items || [];

    function drawHeader() {
      const HDR_Y = 26, HDR_H = 78;
      doc.font('ThaiBold').fontSize(12).fillColor('#1e293b');
      t(doc, seller.shop_name || '-', mX, HDR_Y, { width: U * 0.55 });
      doc.font('Thai').fontSize(8).fillColor('#475569');
      t(doc, seller.address || '', mX, HDR_Y + 16, { width: U * 0.55 });
      t(doc, `เลขประจำตัวผู้เสียภาษี: ${seller.tax_id || '-'}`, mX, HDR_Y + 30, { width: U * 0.55 });
      if (seller.phone) t(doc, `โทร. ${seller.phone}`, mX, HDR_Y + 44, { width: U * 0.55 });

      const RIGHT_X = mX + U * 0.55;
      const RIGHT_W = U * 0.45;
      doc.font('ThaiBold').fontSize(14).fillColor('#1e293b');
      t(doc, 'ใบกำกับภาษี /', RIGHT_X, HDR_Y, { width: RIGHT_W, align: 'right' });
      t(doc, 'ใบเสร็จรับเงิน', RIGHT_X, HDR_Y + 16, { width: RIGHT_W, align: 'right' });
      doc.font('Thai').fontSize(8.5).fillColor('#475569');
      t(doc, 'Tax Invoice / Receipt', RIGHT_X, HDR_Y + 33, { width: RIGHT_W, align: 'right' });

      const infoRows = [
        ['เลขที่', inv.invoice_no || '-'],
        ['วันที่ออก', inv.issued_at || ''],
        ['อ้างอิงบิล', inv.ref_bill_no || '-'],
      ];
      const INFO_Y = HDR_Y + 46, INFO_H = 12;
      infoRows.forEach(([lbl, val], i) => {
        doc.font('ThaiBold').fontSize(7.5).fillColor('#64748b');
        t(doc, lbl, RIGHT_X, INFO_Y + i * INFO_H, { width: RIGHT_W * 0.4, align: 'right' });
        doc.font('Thai').fontSize(7.5).fillColor('#1e293b');
        t(doc, val, RIGHT_X + RIGHT_W * 0.42, INFO_Y + i * INFO_H, { width: RIGHT_W * 0.58, align: 'right' });
      });

      doc.rect(mX, HDR_Y + HDR_H, U, 2).fill('#1e40af');
      return HDR_Y + HDR_H + 8;
    }

    function drawBuyerBox(y) {
      const BUY_H = 58;
      doc.rect(mX, y, U, BUY_H).strokeColor('#cbd5e1').lineWidth(0.8).stroke();
      doc.font('ThaiBold').fontSize(7).fillColor('#1e40af');
      t(doc, 'ผู้ซื้อ / BUYER', mX + 8, y + 6);
      doc.font('ThaiBold').fontSize(10).fillColor('#1e293b');
      const buyerName = `${buyer.name || ''}${buyer.branch ? ` (${buyer.branch})` : ''}`;
      t(doc, buyerName, mX + 8, y + 18, { width: U * 0.6 });
      doc.font('Thai').fontSize(8.5).fillColor('#475569');
      t(doc, buyer.address || '', mX + 8, y + 32, { width: U * 0.6 });
      t(doc, `เลขประจำตัวผู้เสียภาษี: ${buyer.tax_id || '-'}`, mX + 8, y + 46, { width: U * 0.6 });
      if (buyer.phone) t(doc, `โทร. ${buyer.phone}`, mX + U * 0.65, y + 24, { width: U * 0.32 });
      return y + BUY_H + 6;
    }

    const C0 = 20, C2 = 32, C3 = 40, C4 = 72, C5 = 72;
    const C1 = U - C0 - C2 - C3 - C4 - C5;
    const CX = [mX, mX+C0, mX+C0+C1, mX+C0+C1+C2, mX+C0+C1+C2+C3, mX+C0+C1+C2+C3+C4];
    const CW = [C0, C1, C2, C3, C4, C5];
    const CA = ['center','left','center','center','right','right'];
    const TBL_HDR = 18, TBL_ROW = 16;

    function drawTableHeader(y) {
      doc.rect(mX, y, U, TBL_HDR).fill('#1e293b');
      const hdrs = ['#', 'รายการสินค้า', 'จำนวน', 'หน่วย', 'ราคา/หน่วย', 'จำนวนเงิน'];
      hdrs.forEach((h, i) => {
        doc.font('ThaiBold').fontSize(7.5).fillColor('#ffffff');
        t(doc, h, CX[i] + 3, y + 5, { width: CW[i] - 6, align: CA[i] });
      });
      return y + TBL_HDR;
    }

    let y = drawHeader();
    y = drawBuyerBox(y);
    y = drawTableHeader(y);

    items.forEach((item, i) => {
      if (y + TBL_ROW > bottomLimit) {
        doc.addPage();
        y = 30;
        y = drawTableHeader(y);
      }
      const lineTotal = (parseFloat(item.qty) || 0) * (parseFloat(item.price) || 0);
      const shade = i % 2 === 1;
      if (shade) doc.rect(mX, y, U, TBL_ROW).fill('#f8fafc');
      doc.rect(mX, y, U, TBL_ROW).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
      doc.font('Thai').fontSize(8).fillColor('#1e293b');
      t(doc, String(i + 1), CX[0] + 3, y + 4, { width: CW[0] - 6, align: 'center' });
      t(doc, item.name || '', CX[1] + 4, y + 4, { width: CW[1] - 8 });
      t(doc, String(item.qty ?? ''), CX[2] + 3, y + 4, { width: CW[2] - 6, align: 'center' });
      t(doc, item.unit || '-', CX[3] + 3, y + 4, { width: CW[3] - 6, align: 'center' });
      t(doc, fmt(item.price), CX[4] + 3, y + 4, { width: CW[4] - 6, align: 'right' });
      t(doc, fmt(lineTotal), CX[5] + 3, y + 4, { width: CW[5] - 6, align: 'right' });
      y += TBL_ROW;
    });

    const TOT_H = 62;
    if (y + TOT_H + 90 > bottomLimit) { doc.addPage(); y = 30; }
    y += 6;

    doc.rect(mX, y, U, TOT_H).strokeColor('#cbd5e1').lineWidth(0.8).stroke();
    const SPLIT_X = mX + Math.round(U * 0.54);
    const NUM_W   = mX + U - SPLIT_X;
    doc.moveTo(SPLIT_X, y).lineTo(SPLIT_X, y + TOT_H).strokeColor('#cbd5e1').lineWidth(0.8).stroke();

    doc.font('Thai').fontSize(7).fillColor('#94a3b8');
    t(doc, 'จำนวนเงินรวมทั้งสิ้น (ตัวอักษร) / Grand Total Baht (Text)',
      mX + 6, y + 8, { width: SPLIT_X - mX - 12 });
    doc.font('ThaiBold').fontSize(10).fillColor('#1e293b');
    t(doc, bahtText(inv.total), mX + 6, y + 24, { width: SPLIT_X - mX - 12 });

    const hasVat = (inv.vat || 0) > 0;
    const numRows = hasVat
      ? [
          { lbl: 'มูลค่าสินค้า/บริการ (ก่อน VAT)', val: fmt(inv.subtotal), bold: false, col: '#475569' },
          { lbl: 'ภาษีมูลค่าเพิ่ม 7%',              val: fmt(inv.vat),      bold: false, col: '#475569' },
        ]
      : [
          { lbl: 'มูลค่าสินค้า/บริการ (ไม่มี VAT)', val: fmt(inv.subtotal), bold: false, col: '#475569' },
        ];
    const ROW_H_N = 14;
    numRows.forEach(({ lbl, val, bold, col }, i) => {
      const ry = y + 4 + i * ROW_H_N;
      const lw = NUM_W * 0.62, vw = NUM_W * 0.36;
      const vx = SPLIT_X + NUM_W - vw - 6;
      doc.font(bold ? 'ThaiBold' : 'Thai').fontSize(8).fillColor(col);
      t(doc, lbl, SPLIT_X + 6, ry, { width: lw - 4 });
      t(doc, val, vx, ry, { width: vw, align: 'right' });
    });

    const NET_Y = y + 4 + numRows.length * ROW_H_N + 2;
    const NET_H = y + TOT_H - NET_Y;
    doc.rect(SPLIT_X, NET_Y, NUM_W, NET_H).fill('#eff6ff');
    doc.rect(SPLIT_X, NET_Y, NUM_W, NET_H).strokeColor('#1e40af').lineWidth(1).stroke();
    doc.font('ThaiBold').fontSize(8).fillColor('#1e40af');
    t(doc, 'ยอดสุทธิที่ชำระ', SPLIT_X + 6, NET_Y + 4, { width: NUM_W * 0.5 });
    doc.font('ThaiBold').fontSize(11).fillColor('#1e40af');
    t(doc, fmt(inv.total), SPLIT_X + 6, NET_Y + 3, { width: NUM_W - 10, align: 'right' });

    y += TOT_H + 10;

    const SIG_H = 70;
    if (y + SIG_H + 30 > bottomLimit) { doc.addPage(); y = 30; }
    const SIG_W = (U - 12) / 2;

    doc.rect(mX, y, SIG_W, SIG_H).strokeColor('#cbd5e1').lineWidth(0.8).dash(4, { space: 3 }).stroke();
    doc.undash();
    doc.font('ThaiBold').fontSize(8).fillColor('#1e293b');
    t(doc, `ในนาม ${buyer.name || ''}`, mX + 4, y + 7, { width: SIG_W - 8, align: 'center' });
    doc.moveTo(mX + 14, y + SIG_H - 20).lineTo(mX + SIG_W - 14, y + SIG_H - 20)
       .strokeColor('#94a3b8').lineWidth(0.6).stroke();
    doc.font('Thai').fontSize(7.5).fillColor('#475569');
    t(doc, 'ลายมือชื่อผู้ซื้อ / Authorized Signature', mX + 4, y + SIG_H - 15, { width: SIG_W - 8, align: 'center' });

    const RS_X = mX + SIG_W + 12;
    doc.rect(RS_X, y, SIG_W, SIG_H).strokeColor('#e2e8f0').lineWidth(0.8).stroke();
    doc.font('ThaiBold').fontSize(8).fillColor('#1e293b');
    t(doc, seller.shop_name || '', RS_X + 4, y + 7, { width: SIG_W - 8, align: 'center' });
    doc.moveTo(RS_X + 14, y + SIG_H - 20).lineTo(RS_X + SIG_W - 14, y + SIG_H - 20)
       .strokeColor('#94a3b8').lineWidth(0.6).stroke();
    doc.font('Thai').fontSize(7.5).fillColor('#475569');
    t(doc, `ผู้รับเงิน${inv.issued_by ? ` (${inv.issued_by})` : ''}`, RS_X + 4, y + SIG_H - 15, { width: SIG_W - 8, align: 'center' });
    t(doc, inv.issued_at || '', RS_X + 4, y + SIG_H - 5, { width: SIG_W - 8, align: 'center' });

    doc.font('Thai').fontSize(7).fillColor('#cbd5e1');
    const footerText = inv.isWhiteLabel
      ? `เลขที่ใบกำกับภาษี: ${inv.invoice_no || '-'}`
      : `เลขที่ใบกำกับภาษี: ${inv.invoice_no || '-'}   ·   ออกโดย Smile Slip Pro · smileslippro.com`;
    t(doc, footerText, 0, H - 30, { width: W, align: 'center' });

    doc.end();
  });
}
