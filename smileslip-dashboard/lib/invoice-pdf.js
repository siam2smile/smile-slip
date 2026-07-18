/**
 * สร้าง PDF ใบกำกับภาษี/ใบเสร็จรับเงิน (A4)
 * ใช้ pdfkit + Sarabun Thai font
 */
import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';

const FONT_PATH      = path.join(process.cwd(), 'fonts', 'Sarabun-Regular.ttf');
const FONT_BOLD_PATH = path.join(process.cwd(), 'fonts', 'Sarabun-Bold.ttf');
const LOGO_PATH      = path.join(process.cwd(), 'public', 'logo-siam-global-network-enterprise.jpg');
const SEAL_PATH      = path.join(process.cwd(), 'public', 'seal.jpg');
const SIG_PATH       = path.join(process.cwd(), 'public', 'Signature.jpg');

const SELLER = {
  name:      'บริษัท สยาม โกลบอล เน็ทเวิร์ค เอ็นเตอร์ไพรส์ จำกัด',
  branch:    'สำนักงานใหญ่',
  taxId:     '0505565019236',
  address:   '76 หมู่ 9 ต.หางดง อ.หางดง จ.เชียงใหม่ 50230',
  phone:     '062-929-9552',
  bank:      'ธนาคารกสิกรไทย',
  accountNo: '175-873-123-1',
};

const PLAN_NAMES = {
  pro: 'Shop Pro', advance: 'Advance', business: 'Business', enterprise: 'Enterprise',
};

function fmt(n) {
  return Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function thDate(iso) {
  return new Date(iso || Date.now()).toLocaleDateString('th-TH', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
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
  const v = Math.round(Number(amount) * 100) / 100;
  const baht = Math.floor(v);
  const satang = Math.round((v - baht) * 100);
  return (baht ? spell(baht) : 'ศูนย์') + 'บาท' + (satang ? spell(satang) + 'สตางค์' : 'ถ้วน');
}

// helper: วาดข้อความที่ตำแหน่งแน่นอนโดยไม่กระทบ cursor
function t(doc, text, x, y, opts = {}) {
  doc.text(String(text), x, y, { lineBreak: false, ...opts });
}

export function generateInvoicePdf(inv, copyLabel = 'ต้นฉบับ') {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, info: {
      Title:   `ใบกำกับภาษี ${inv.tax_invoice_no || ''}`,
      Author:  SELLER.name,
      Subject: 'Tax Invoice / ใบกำกับภาษี / ใบเสร็จรับเงิน',
    }});

    const chunks = [];
    doc.on('data',  c => chunks.push(c));
    doc.on('end',   () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.registerFont('Thai',     FONT_PATH);
    doc.registerFont('ThaiBold', FONT_BOLD_PATH);

    const W  = 595.28;
    const mX = 36;
    const U  = W - mX * 2;   // 523.28
    const isCopy = copyLabel === 'สำเนา';

    const issueDate = thDate(inv.approved_at);
    const period    = inv.is_yearly ? 'รายปี (12 เดือน)' : 'รายเดือน (1 เดือน)';
    const unit      = inv.is_yearly ? 'ปี' : 'เดือน';
    const planName  = PLAN_NAMES[inv.plan_id] || inv.plan_id || '-';

    // ─── layout constants (y positions ตายตัวทุก section) ──────────
    const HDR_Y    = 26;   // top of header
    const HDR_H    = 102;  // header height (รองรับ title 2 บรรทัด + info table 3 แถว)
    const DIV_Y    = HDR_Y + HDR_H;       // blue divider y
    const BUY_Y    = DIV_Y + 8;           // buyer box y
    const BUY_H    = 66;
    const TBL_Y    = BUY_Y + BUY_H + 6;  // items table y
    const TBL_HDR  = 20;
    const TBL_ROW  = 34;
    const TBL_EMP  = 2;    // empty rows
    const TBL_EMPH = 16;
    const TOT_Y    = TBL_Y + TBL_HDR + TBL_ROW + TBL_EMP * TBL_EMPH + 2;
    const TOT_H    = 76;
    const PAY_Y    = TOT_Y + TOT_H + 6;
    const PAY_H    = 44;
    const SIG_Y    = PAY_Y + PAY_H + 10;
    const SIG_H    = 80;
    const FTR_Y    = SIG_Y + SIG_H + 10;

    const LEFT_W  = U * 0.53;
    const RIGHT_X = mX + LEFT_W + 10;
    const RIGHT_W = U - LEFT_W - 10;

    // ════════════════════════════════════════════════════════════════
    // HEADER
    // ════════════════════════════════════════════════════════════════

    // ── ซ้าย: logo + ชื่อบริษัท ──────────────────────────────────
    if (fs.existsSync(LOGO_PATH)) {
      doc.image(LOGO_PATH, mX, HDR_Y + 2, { width: 46, height: 46 });
    }
    doc.font('ThaiBold').fontSize(10).fillColor('#1e293b');
    t(doc, SELLER.name, mX + 52, HDR_Y + 4, { width: LEFT_W - 56 });

    doc.font('Thai').fontSize(8).fillColor('#64748b');
    t(doc, `(${SELLER.branch})`, mX + 52, HDR_Y + 18, { width: LEFT_W - 56 });

    doc.font('Thai').fontSize(8).fillColor('#475569');
    t(doc, SELLER.address, mX + 52, HDR_Y + 32, { width: LEFT_W - 56 });

    doc.font('Thai').fontSize(8).fillColor('#475569');
    t(doc, `เลขประจำตัวผู้เสียภาษี: ${SELLER.taxId}`, mX + 52, HDR_Y + 46, { width: LEFT_W - 56 });

    doc.font('Thai').fontSize(8).fillColor('#475569');
    t(doc, `โทร. ${SELLER.phone}  |  ธนาคาร ${SELLER.bank}  |  เลขที่บัญชี ${SELLER.accountNo}`, mX + 52, HDR_Y + 59, { width: LEFT_W - 56 });

    // ── ขวา: title + badge ───────────────────────────────────────
    // badge (top-right corner)
    const badgeColor = isCopy ? '#94a3b8' : '#1e40af';
    doc.rect(RIGHT_X + RIGHT_W - 54, HDR_Y, 52, 17)
       .strokeColor(badgeColor).lineWidth(1.2).stroke();
    doc.font('ThaiBold').fontSize(8).fillColor(badgeColor);
    t(doc, copyLabel, RIGHT_X + RIGHT_W - 54, HDR_Y + 4, { width: 52, align: 'center' });

    // title — แยก 2 บรรทัดตายตัว (กันข้อความยาวเกินจนทับ subtitle เมื่อ wrap เอง)
    doc.font('ThaiBold').fontSize(14).fillColor('#1e293b');
    t(doc, 'ใบกำกับภาษี /', RIGHT_X, HDR_Y + 2, { width: RIGHT_W - 58, align: 'right' });
    t(doc, 'ใบเสร็จรับเงิน', RIGHT_X, HDR_Y + 18, { width: RIGHT_W, align: 'right' });

    doc.font('Thai').fontSize(8.5).fillColor('#475569');
    t(doc, 'Tax Invoice / Receipt', RIGHT_X, HDR_Y + 36, { width: RIGHT_W, align: 'right' });

    // info table เลขที่ / วันที่ / อ้างอิง
    const INFO_Y  = HDR_Y + 50;
    const INFO_H  = 15;
    const INFO_LW = RIGHT_W * 0.36;
    const INFO_VW = RIGHT_W - INFO_LW;
    const infoRows = [
      ['เลขที่',    inv.tax_invoice_no || '-', true],
      ['วันที่ออก', issueDate,               false],
      ['อ้างอิง',  inv.invoice_no || '-',    false],
    ];
    infoRows.forEach(([lbl, val, bold], i) => {
      const ry = INFO_Y + i * INFO_H;
      doc.rect(RIGHT_X, ry, RIGHT_W, INFO_H).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
      doc.rect(RIGHT_X, ry, INFO_LW, INFO_H).fill('#f8fafc');
      doc.moveTo(RIGHT_X + INFO_LW, ry).lineTo(RIGHT_X + INFO_LW, ry + INFO_H)
         .strokeColor('#e2e8f0').lineWidth(0.5).stroke();
      doc.font('ThaiBold').fontSize(7.5).fillColor('#64748b');
      t(doc, lbl, RIGHT_X + 4, ry + 4, { width: INFO_LW - 8 });
      doc.font(bold ? 'ThaiBold' : 'Thai').fontSize(7.5).fillColor('#1e293b');
      t(doc, val, RIGHT_X + INFO_LW + 4, ry + 4, { width: INFO_VW - 8 });
    });

    // ── เส้นน้ำเงิน ───────────────────────────────────────────────
    doc.rect(mX, DIV_Y, U, 2).fill('#1e40af');

    // ════════════════════════════════════════════════════════════════
    // BUYER BOX
    // ════════════════════════════════════════════════════════════════
    doc.rect(mX, BUY_Y, U, BUY_H).strokeColor('#cbd5e1').lineWidth(0.8).stroke();

    doc.font('ThaiBold').fontSize(7).fillColor('#1e40af');
    t(doc, 'ผู้ซื้อ / BUYER', mX + 8, BUY_Y + 6);

    doc.font('ThaiBold').fontSize(10).fillColor('#1e293b');
    const buyerName = `${inv.buyer_name || ''}${inv.buyer_branch ? ` (${inv.buyer_branch})` : ''}`;
    t(doc, buyerName, mX + 8, BUY_Y + 18, { width: U * 0.55 });

    doc.font('Thai').fontSize(8.5).fillColor('#475569');
    t(doc, inv.buyer_address || '', mX + 8, BUY_Y + 32, { width: U * 0.55 });

    doc.font('Thai').fontSize(8.5).fillColor('#475569');
    t(doc, `เลขประจำตัวผู้เสียภาษี: ${inv.buyer_tax_id || '-'}`, mX + 8, BUY_Y + 46, { width: U * 0.55 });

    // ขวาของ buyer: โทร/email
    if (inv.buyer_phone) {
      doc.font('Thai').fontSize(8.5).fillColor('#475569');
      t(doc, `โทร. ${inv.buyer_phone}`, mX + U * 0.58, BUY_Y + 24, { width: U * 0.40 });
    }
    if (inv.buyer_email) {
      doc.font('Thai').fontSize(8.5).fillColor('#475569');
      t(doc, `Email: ${inv.buyer_email}`, mX + U * 0.58, BUY_Y + 38, { width: U * 0.40 });
    }

    // ════════════════════════════════════════════════════════════════
    // ITEMS TABLE
    // ════════════════════════════════════════════════════════════════
    // column widths: #(20) | description(flex) | qty(28) | unit(34) | price_ex(70) | price_inc(70)
    const C0 = 20, C2 = 28, C3 = 34, C4 = 72, C5 = 72;
    const C1 = U - C0 - C2 - C3 - C4 - C5;  // ~227pt
    const CX = [mX, mX+C0, mX+C0+C1, mX+C0+C1+C2, mX+C0+C1+C2+C3, mX+C0+C1+C2+C3+C4];
    const CW = [C0, C1, C2, C3, C4, C5];
    const CA = ['center','left','center','center','right','right'];

    // header bar
    doc.rect(mX, TBL_Y, U, TBL_HDR).fill('#1e293b');
    const tblHdrs = ['#', 'รายการสินค้า/บริการ', 'จำนวน', 'หน่วย', 'ราคาก่อน VAT', 'ราคารวม VAT'];
    tblHdrs.forEach((h, i) => {
      doc.font('ThaiBold').fontSize(7.5).fillColor('#ffffff');
      t(doc, h, CX[i] + 3, TBL_Y + 6, { width: CW[i] - 6, align: CA[i] });
    });

    // data row
    const RY = TBL_Y + TBL_HDR;
    doc.rect(mX, RY, U, TBL_ROW).fill('#f8fafc');
    doc.rect(mX, RY, U, TBL_ROW).strokeColor('#e2e8f0').lineWidth(0.5).stroke();

    doc.font('Thai').fontSize(8.5).fillColor('#1e293b');
    t(doc, '1', CX[0] + 3, RY + 6, { width: CW[0] - 6, align: 'center' });

    doc.font('ThaiBold').fontSize(8.5).fillColor('#1e293b');
    t(doc, `Smile Slip Pro — ${planName}`, CX[1] + 4, RY + 5, { width: CW[1] - 8 });

    doc.font('Thai').fontSize(7.5).fillColor('#64748b');
    t(doc, `บริการซอฟต์แวร์บันทึกสลิปโอนเงินด้วย AI (${period})`, CX[1] + 4, RY + 19, { width: CW[1] - 8 });

    doc.font('Thai').fontSize(8.5).fillColor('#1e293b');
    t(doc, '1',                   CX[2] + 3, RY + 12, { width: CW[2] - 6, align: 'center' });
    t(doc, unit,                  CX[3] + 3, RY + 12, { width: CW[3] - 6, align: 'center' });
    t(doc, fmt(inv.base_price),   CX[4] + 3, RY + 12, { width: CW[4] - 6, align: 'right' });
    t(doc, fmt(inv.total_price),  CX[5] + 3, RY + 12, { width: CW[5] - 6, align: 'right' });

    // empty rows
    for (let r = 0; r < TBL_EMP; r++) {
      doc.rect(mX, RY + TBL_ROW + r * TBL_EMPH, U, TBL_EMPH)
         .strokeColor('#e2e8f0').lineWidth(0.5).stroke();
    }

    // ════════════════════════════════════════════════════════════════
    // TOTALS
    // ════════════════════════════════════════════════════════════════
    doc.rect(mX, TOT_Y, U, TOT_H).strokeColor('#cbd5e1').lineWidth(0.8).stroke();

    const SPLIT_X = mX + Math.round(U * 0.54);
    const NUM_W   = mX + U - SPLIT_X;

    // แนวกั้นแนวตั้ง
    doc.moveTo(SPLIT_X, TOT_Y).lineTo(SPLIT_X, TOT_Y + TOT_H)
       .strokeColor('#cbd5e1').lineWidth(0.8).stroke();

    // ซ้าย: baht text
    doc.font('Thai').fontSize(7).fillColor('#94a3b8');
    t(doc, 'จำนวนเงินรวมทั้งสิ้น (ตัวอักษร) / Grand Total Baht (Text)',
      mX + 6, TOT_Y + 8, { width: SPLIT_X - mX - 12 });

    doc.font('ThaiBold').fontSize(10).fillColor('#1e293b');
    t(doc, bahtText(inv.total_price), mX + 6, TOT_Y + 22, { width: SPLIT_X - mX - 12 });

    // ขวา: 4 แถวตัวเลข
    const NUM_ROWS = [
      { lbl: 'มูลค่าสินค้า/บริการ (ก่อน VAT)', val: fmt(inv.base_price),           bold: false, col: '#475569' },
      { lbl: 'ภาษีมูลค่าเพิ่ม 7%',              val: fmt(inv.vat_amount),            bold: false, col: '#475569' },
      { lbl: 'รวมทั้งสิ้น (รวม VAT)',            val: fmt(inv.total_price),           bold: true,  col: '#1e293b' },
      { lbl: 'หัก ณ ที่จ่าย 3% (WHT)',           val: `(${fmt(inv.wht_amount)})`,    bold: false, col: '#dc2626' },
    ];
    const ROW_H_N = 13;
    NUM_ROWS.forEach(({ lbl, val, bold, col }, i) => {
      const ry = TOT_Y + 4 + i * ROW_H_N;
      const lw = NUM_W * 0.62;
      const vw = NUM_W * 0.36;
      const vx = SPLIT_X + NUM_W - vw - 6;
      doc.font(bold ? 'ThaiBold' : 'Thai').fontSize(8).fillColor(col);
      t(doc, lbl, SPLIT_X + 6, ry, { width: lw - 4 });
      t(doc, val, vx, ry, { width: vw, align: 'right' });
    });

    // ยอดสุทธิ (box ด้านล่างขวา)
    const NET_Y = TOT_Y + 4 + NUM_ROWS.length * ROW_H_N + 2;
    const NET_H = TOT_Y + TOT_H - NET_Y;
    doc.rect(SPLIT_X, NET_Y, NUM_W, NET_H).fill('#eff6ff');
    doc.rect(SPLIT_X, NET_Y, NUM_W, NET_H).strokeColor('#1e40af').lineWidth(1).stroke();

    doc.font('ThaiBold').fontSize(8).fillColor('#1e40af');
    t(doc, 'ยอดสุทธิที่ชำระ', SPLIT_X + 6, NET_Y + 4, { width: NUM_W * 0.5 });

    doc.font('ThaiBold').fontSize(11).fillColor('#1e40af');
    t(doc, fmt(inv.net_amount), SPLIT_X + 6, NET_Y + 3, { width: NUM_W - 10, align: 'right' });

    // ════════════════════════════════════════════════════════════════
    // ข้อมูลการชำระเงิน (yellow)
    // ════════════════════════════════════════════════════════════════
    doc.rect(mX, PAY_Y, U, PAY_H).fill('#fefce8');
    doc.rect(mX, PAY_Y, U, PAY_H).strokeColor('#fde68a').lineWidth(0.8).stroke();

    doc.font('ThaiBold').fontSize(7.5).fillColor('#92400e');
    t(doc, 'ข้อมูลการชำระเงิน / Payment Information', mX + 8, PAY_Y + 7);

    doc.font('Thai').fontSize(8.5).fillColor('#78350f');
    t(doc, `ธนาคาร: ${SELLER.bank}`, mX + 8, PAY_Y + 20);
    t(doc, `เลขที่บัญชี: ${SELLER.accountNo}   |   ชื่อบัญชี: ${SELLER.name}`, mX + 8, PAY_Y + 32, { width: U * 0.65 });

    doc.font('ThaiBold').fontSize(10).fillColor('#1e40af');
    t(doc, `ยอดโอน: ฿${fmt(inv.net_amount)}`, mX + U * 0.66, PAY_Y + 20, { width: U * 0.32, align: 'right' });
    doc.font('Thai').fontSize(7.5).fillColor('#92400e');
    t(doc, '(หักภาษี ณ ที่จ่าย 3% แล้ว)', mX + U * 0.66, PAY_Y + 32, { width: U * 0.32, align: 'right' });

    // ════════════════════════════════════════════════════════════════
    // SIGNATURE
    // ════════════════════════════════════════════════════════════════
    const SIG_W = (U - 12) / 2;

    // กล่องซ้าย: ลูกค้า (เส้นประ)
    doc.rect(mX, SIG_Y, SIG_W, SIG_H)
       .strokeColor('#cbd5e1').lineWidth(0.8).dash(4, { space: 3 }).stroke();
    doc.undash();

    doc.font('ThaiBold').fontSize(8).fillColor('#1e293b');
    t(doc, `ในนาม ${inv.buyer_name || ''}`, mX + 4, SIG_Y + 7, { width: SIG_W - 8, align: 'center' });

    doc.moveTo(mX + 14, SIG_Y + SIG_H - 20).lineTo(mX + SIG_W - 14, SIG_Y + SIG_H - 20)
       .strokeColor('#94a3b8').lineWidth(0.6).stroke();

    doc.font('Thai').fontSize(7.5).fillColor('#475569');
    t(doc, 'ลายมือชื่อผู้รับบริการ / Authorized Signature',
      mX + 4, SIG_Y + SIG_H - 15, { width: SIG_W - 8, align: 'center' });

    doc.font('Thai').fontSize(7).fillColor('#94a3b8');
    t(doc, 'วันที่ _____ / _____ / _________',
      mX + 4, SIG_Y + SIG_H - 5, { width: SIG_W - 8, align: 'center' });

    // กล่องขวา: บริษัท
    const RS_X = mX + SIG_W + 12;
    doc.rect(RS_X, SIG_Y, SIG_W, SIG_H).strokeColor('#e2e8f0').lineWidth(0.8).stroke();

    doc.font('ThaiBold').fontSize(8).fillColor('#1e293b');
    t(doc, SELLER.name, RS_X + 4, SIG_Y + 7, { width: SIG_W - 8, align: 'center' });

    // seal ซ้าย + signature ขวา (ไม่ทับกัน)
    const IMG_CENTER = RS_X + SIG_W / 2;
    if (fs.existsSync(SEAL_PATH)) {
      doc.image(SEAL_PATH, IMG_CENTER - 52, SIG_Y + 18, { width: 44, height: 44 });
    }
    if (fs.existsSync(SIG_PATH)) {
      doc.image(SIG_PATH, IMG_CENTER + 2, SIG_Y + 24, { width: 52, height: 32 });
    }

    doc.moveTo(RS_X + 14, SIG_Y + SIG_H - 20).lineTo(RS_X + SIG_W - 14, SIG_Y + SIG_H - 20)
       .strokeColor('#94a3b8').lineWidth(0.6).stroke();

    doc.font('Thai').fontSize(7.5).fillColor('#475569');
    t(doc, 'ผู้มีอำนาจลงนาม / Authorized Signatory',
      RS_X + 4, SIG_Y + SIG_H - 15, { width: SIG_W - 8, align: 'center' });

    doc.font('Thai').fontSize(7.5).fillColor('#475569');
    t(doc, issueDate, RS_X + 4, SIG_Y + SIG_H - 5, { width: SIG_W - 8, align: 'center' });

    // ════════════════════════════════════════════════════════════════
    // FOOTER
    // ════════════════════════════════════════════════════════════════
    doc.rect(0, FTR_Y, W, 36).fill('#f1f5f9');

    doc.font('ThaiBold').fontSize(8).fillColor('#475569');
    t(doc, SELLER.name, 0, FTR_Y + 7, { width: W, align: 'center' });

    doc.font('Thai').fontSize(7.5).fillColor('#94a3b8');
    t(doc, `${SELLER.address}   ·   โทร. ${SELLER.phone}   ·   เลขภาษี ${SELLER.taxId}`,
      0, FTR_Y + 19, { width: W, align: 'center' });

    doc.font('Thai').fontSize(7).fillColor('#cbd5e1');
    t(doc, `เลขที่ใบกำกับภาษี: ${inv.tax_invoice_no || '-'}   ·   เอกสารออกโดยระบบอัตโนมัติ`,
      0, FTR_Y + 30, { width: W, align: 'center' });

    doc.end();
  });
}
