/**
 * สร้าง PDF "หนังสือรับรองการหักภาษี ณ ที่จ่าย" (ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร)
 * ใช้ pdfkit + Sarabun font (pattern เดียวกับ lib/vat-report-pdf.js / lib/pos-tax-invoice-pdf.js)
 *
 * รองรับ 2 ทิศทาง ตรงกับข้อมูล WHT ที่ ledger_transactions บันทึกไว้แล้ว (ดู CLAUDE.md item 119):
 *  - เราเป็นผู้จ่ายเงินและหักภาษีไว้เอง (ledger.type='รายจ่าย', wht_amount>0) → นี่คือเอกสารทางการ
 *    ที่กฎหมายบังคับให้ "ผู้จ่ายเงิน" ต้องออกให้ผู้ถูกหักภาษี — isDraft=false, มีเลขที่วิ่งต่อเนื่อง
 *  - คู่ค้า/ลูกค้าหักภาษีจากเรา (ledger.type='รายรับ', wht_amount>0) → เราไม่ใช่ผู้มีหน้าที่ออก
 *    เอกสารนี้ตามกฎหมาย (ผู้จ่ายเงินเป็นคนออกเสมอ) แต่ช่วยเตรียม "ร่าง" ให้คู่ค้าตรวจสอบตัวเลขแล้ว
 *    นำไปออกในนามของเขาเอง — isDraft=true, มีคำเตือนชัดเจนบนเอกสาร
 *
 * ผู้เรียกต้อง resolve payer/payee มาให้ถูกทิศทางเสมอ (ฟังก์ชันนี้แค่วาดตามลำดับ payer=ซ้าย/
 * payee=ขวา ไม่รู้ว่าใครคือ "เรา" — ผู้จ่ายเงินเป็นคนเซ็นเอกสารนี้เสมอไม่ว่าจะเป็นเราหรือคู่ค้า)
 */
import PDFDocument from 'pdfkit';
import path from 'path';
import { withBrandFooter } from './branding';

const FONT_PATH      = path.join(process.cwd(), 'fonts', 'Sarabun-Regular.ttf');
const FONT_BOLD_PATH = path.join(process.cwd(), 'fonts', 'Sarabun-Bold.ttf');

function fmt(n) {
  return Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ก็อปจาก lib/pos-tax-invoice-pdf.js (ตัวสะกดเลขไทยเป็นตัวอักษร) — ตามธรรมเนียมโปรเจกต์นี้ที่
// duplicate helper เล็กๆ ข้ามไฟล์แทนแชร์ module กลาง
function bahtText(amount) {
  const ones = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
  function spell(n) {
    if (!n) return '';
    const units = [[1000000, 'ล้าน'], [100000, 'แสน'], [10000, 'หมื่น'], [1000, 'พัน'], [100, 'ร้อย']];
    let s = '';
    for (const [d, label] of units) {
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

// ประเภทเงินได้พึงประเมินตามมาตรา 40 — ตรงกับหมวดที่ปรากฏบนแบบฟอร์ม 50 ทวิ ทางการ
export const INCOME_TYPES = [
  { code: '1',  label: '1. เงินเดือน ค่าจ้าง เบี้ยเลี้ยง โบนัส ฯลฯ (มาตรา 40(1))' },
  { code: '2',  label: '2. ค่าธรรมเนียม ค่านายหน้า ฯลฯ (มาตรา 40(2))' },
  { code: '3',  label: '3. ค่าแห่งลิขสิทธิ์ ฯลฯ (มาตรา 40(3))' },
  { code: '4a', label: '4(ก). ดอกเบี้ย ฯลฯ (มาตรา 40(4)(ก))' },
  { code: '4b', label: '4(ข). เงินปันผล เงินส่วนแบ่งกำไร ฯลฯ (มาตรา 40(4)(ข))' },
  { code: '5',  label: '5. อื่นๆ (ค่าจ้างทำของ/ค่าบริการ/ค่าขนส่ง/ค่าโฆษณา ฯลฯ) (มาตรา 40(8))' },
];

// สร้าง label สำหรับบันทึก/แสดงผล — ใช้ร่วมกันทั้ง preview.js/save.js กันตรรกะ drift ข้ามไฟล์
export function incomeTypeDisplayLabel(code, other) {
  const found = INCOME_TYPES.find(t => t.code === code);
  if (!found) return other || '-';
  if (code === '5' && other) return `5. อื่นๆ — ${other} (มาตรา 40(8))`;
  return found.label;
}

// params: { certNo, isDraft, docDate, payer:{name,address,taxId}, payee:{name,address,taxId},
//           incomeTypeCode, incomeTypeOther, baseAmount, whtAmount, isWhiteLabel }
export function generateWhtCertificatePdf(params) {
  return new Promise((resolve, reject) => {
    const {
      certNo, isDraft, docDate,
      payer = {}, payee = {},
      incomeTypeCode, incomeTypeOther,
      baseAmount, whtAmount, isWhiteLabel,
    } = params;

    const doc = new PDFDocument({
      size: 'A4', margin: 40, autoFirstPage: true, info: {
        Title: `หนังสือรับรองการหักภาษี ณ ที่จ่าย ${certNo || ''}`,
        Author: isWhiteLabel ? '' : 'Smile Slip Pro',
        Subject: 'Withholding Tax Certificate / หนังสือรับรองการหักภาษี ณ ที่จ่าย',
      },
    });

    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.registerFont('Sarabun', FONT_PATH);
    doc.registerFont('Sarabun-Bold', FONT_BOLD_PATH);

    const pageWidth = doc.page.width - 80; // margin 40 ทั้งสองข้าง
    let y = 40;

    // ── หัวเอกสาร ─────────────────────────────────────────────────────────
    doc.font('Sarabun-Bold').fontSize(15).fillColor('#000')
      .text('หนังสือรับรองการหักภาษี ณ ที่จ่าย', 40, y, { width: pageWidth, align: 'center' });
    y += 20;
    doc.font('Sarabun').fontSize(9).fillColor('#666')
      .text('ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร', 40, y, { width: pageWidth, align: 'center' });
    doc.fillColor('#000');
    y += 20;

    doc.font('Sarabun').fontSize(9)
      .text(`เลขที่: ${certNo || '(ตัวอย่าง — ยังไม่ได้บันทึกเลขที่)'}`, 40, y, { width: pageWidth, align: 'right' });
    y += 13;
    doc.text(`วันที่จ่ายเงิน: ${docDate || '-'}`, 40, y, { width: pageWidth, align: 'right' });
    y += 18;

    // ── คำเตือนถ้าเป็นร่าง (คู่ค้าหักเรา — เราไม่ใช่ผู้มีหน้าที่ออกเอกสารนี้ตามกฎหมาย) ─────────
    if (isDraft) {
      doc.roundedRect(40, y, pageWidth, 42, 6).fillAndStroke('#fffbeb', '#f59e0b');
      doc.fillColor('#92400e').font('Sarabun-Bold').fontSize(8.5)
        .text('⚠️ ร่างเอกสาร — จัดทำโดยผู้รับเงินเพื่อความสะดวก ผู้จ่ายเงิน (ผู้มีหน้าที่หักภาษี ณ ที่จ่ายตามกฎหมาย)',
          52, y + 7, { width: pageWidth - 24 });
      doc.font('Sarabun').fontSize(8.5)
        .text('ต้องตรวจสอบความถูกต้องและออกเอกสารฉบับจริงในนามของตนเองเสมอ — เอกสารนี้ไม่ใช่ฉบับทางการ', 52, y + 21, { width: pageWidth - 24 });
      doc.fillColor('#000');
      y += 52;
    }

    // ── กล่องผู้จ่ายเงิน / ผู้ถูกหักภาษี ────────────────────────────────────
    const boxW = (pageWidth - 10) / 2;
    const boxH = 82;
    const drawPartyBox = (x, title, party) => {
      doc.roundedRect(x, y, boxW, boxH, 6).strokeColor('#cbd5e1').lineWidth(0.8).stroke();
      doc.font('Sarabun-Bold').fontSize(7.5).fillColor('#1e40af').text(title, x + 10, y + 8, { width: boxW - 20 });
      doc.font('Sarabun-Bold').fontSize(10).fillColor('#1e293b').text(party.name || '-', x + 10, y + 22, { width: boxW - 20, height: 14, ellipsis: true });
      doc.font('Sarabun').fontSize(8).fillColor('#475569')
        .text(party.address || '', x + 10, y + 38, { width: boxW - 20, height: 22, ellipsis: true });
      doc.text(`เลขประจำตัวผู้เสียภาษี/บัตรประชาชน: ${party.taxId || '-'}`, x + 10, y + 64, { width: boxW - 20, height: 14, ellipsis: true });
      doc.fillColor('#000');
    };
    drawPartyBox(40, 'ผู้มีหน้าที่หักภาษี ณ ที่จ่าย (ผู้จ่ายเงิน)', payer);
    drawPartyBox(40 + boxW + 10, 'ผู้ถูกหักภาษี ณ ที่จ่าย (ผู้รับเงิน)', payee);
    y += boxH + 14;

    // ── ประเภทเงินได้ (checklist) ────────────────────────────────────────
    doc.font('Sarabun-Bold').fontSize(9).text('ประเภทเงินได้พึงประเมินที่จ่าย', 40, y);
    y += 16;
    for (const it of INCOME_TYPES) {
      const checked = it.code === incomeTypeCode;
      const boxY = y;
      doc.rect(40, boxY, 9, 9).strokeColor('#94a3b8').lineWidth(0.7).stroke();
      if (checked) {
        // วาดเครื่องหมาย X ด้วยเส้นเวกเตอร์ตรงๆ แทนตัวอักษร Unicode (✓/☑) — กันฟอนต์ Sarabun
        // ไม่มี glyph ตัวนั้นแล้วเรนเดอร์เป็นช่องว่าง/notdef
        doc.moveTo(41.5, boxY + 1.5).lineTo(47.5, boxY + 7.5).strokeColor('#1e40af').lineWidth(1.2).stroke();
        doc.moveTo(47.5, boxY + 1.5).lineTo(41.5, boxY + 7.5).strokeColor('#1e40af').lineWidth(1.2).stroke();
      }
      const label = (checked && it.code === '5' && incomeTypeOther)
        ? `5. อื่นๆ — ${incomeTypeOther} (มาตรา 40(8))`
        : it.label;
      doc.font(checked ? 'Sarabun-Bold' : 'Sarabun').fontSize(8.5).fillColor(checked ? '#1e293b' : '#64748b')
        .text(label, 56, boxY - 1, { width: pageWidth - 20 });
      doc.fillColor('#000');
      y += 15;
    }
    y += 8;

    // ── ตารางจำนวนเงิน ────────────────────────────────────────────────────
    const colX = [40, 40 + pageWidth * 0.55, 40 + pageWidth * 0.78];
    const colW = [pageWidth * 0.55, pageWidth * 0.23, pageWidth * 0.22];
    doc.rect(40, y, pageWidth, 20).fill('#1e293b');
    doc.font('Sarabun-Bold').fontSize(8.5).fillColor('#fff');
    doc.text('ประเภทเงินได้ที่จ่าย', colX[0] + 6, y + 6, { width: colW[0] - 12 });
    doc.text('จำนวนเงินที่จ่าย', colX[1] + 6, y + 6, { width: colW[1] - 12, align: 'right' });
    doc.text('ภาษีที่หักไว้', colX[2] + 6, y + 6, { width: colW[2] - 12, align: 'right' });
    doc.fillColor('#000');
    y += 20;

    doc.rect(40, y, pageWidth, 22).strokeColor('#e2e8f0').lineWidth(0.6).stroke();
    doc.font('Sarabun').fontSize(8.5);
    doc.text(incomeTypeDisplayLabel(incomeTypeCode, incomeTypeOther), colX[0] + 6, y + 6, { width: colW[0] - 12, height: 14, ellipsis: true });
    doc.text(fmt(baseAmount), colX[1] + 6, y + 6, { width: colW[1] - 12, align: 'right' });
    doc.text(fmt(whtAmount), colX[2] + 6, y + 6, { width: colW[2] - 12, align: 'right' });
    y += 22;

    doc.rect(40, y, pageWidth, 22).fill('#eff6ff');
    doc.font('Sarabun-Bold').fontSize(8.5).fillColor('#1e40af');
    doc.text('รวม', colX[0] + 6, y + 6, { width: colW[0] - 12 });
    doc.text(fmt(baseAmount), colX[1] + 6, y + 6, { width: colW[1] - 12, align: 'right' });
    doc.text(fmt(whtAmount), colX[2] + 6, y + 6, { width: colW[2] - 12, align: 'right' });
    doc.fillColor('#000');
    y += 30;

    doc.font('Sarabun').fontSize(8.5).text(`(ภาษีที่หักไว้ ${bahtText(whtAmount)})`, 40, y, { width: pageWidth });
    y += 30;

    // ── ลายเซ็น (ผู้จ่ายเงินเซ็นเสมอ ไม่ว่าจะเป็นเราหรือคู่ค้าในทิศทางร่าง) ──────────────
    const sigW = pageWidth * 0.5;
    const sigX = 40 + (pageWidth - sigW) / 2;
    doc.font('Sarabun-Bold').fontSize(9).fillColor('#1e293b')
      .text(payer.name || '', sigX, y, { width: sigW, align: 'center', height: 14, ellipsis: true });
    y += 38;
    doc.moveTo(sigX + 14, y).lineTo(sigX + sigW - 14, y).strokeColor('#94a3b8').lineWidth(0.6).stroke();
    y += 4;
    doc.font('Sarabun').fontSize(8).fillColor('#475569')
      .text('ลงชื่อ ผู้จ่ายเงิน (ผู้มีหน้าที่หักภาษี ณ ที่จ่าย)', sigX, y, { width: sigW, align: 'center' });
    doc.fillColor('#000');
    y += 26;

    // ── Footer ────────────────────────────────────────────────────────────
    const footerLines = withBrandFooter(
      isDraft ? 'เอกสารร่าง — ไม่ใช่หนังสือรับรองฉบับทางการ' : '',
      isWhiteLabel
    ).split('\n');
    doc.font('Sarabun').fontSize(7).fillColor('#94a3b8');
    footerLines.forEach(line => {
      doc.text(line, 40, y, { width: pageWidth, align: 'center' });
      y += 10;
    });

    doc.end();
  });
}
