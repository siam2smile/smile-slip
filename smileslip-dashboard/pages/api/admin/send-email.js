/**
 * POST /api/admin/send-email
 * ส่งใบกำกับภาษีทางอีเมลให้ลูกค้า (HTML email + PDF แนบ, nodemailer + Gmail)
 * เรียกโดย admin เท่านั้น
 */
import nodemailer from 'nodemailer';
import { generateInvoicePdf } from '../../../lib/invoice-pdf.js';

function verifyAdmin(req) {
  const token = req.headers['x-admin-token'];
  if (!token) return false;
  try { return Buffer.from(token, 'base64').toString('utf8').startsWith('smileslip-admin:'); }
  catch { return false; }
}

function fmt(n) {
  return Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const PLAN_NAMES = { pro: 'Shop Pro', advance: 'Advance', business: 'Business', enterprise: 'Enterprise' };

function buildHtml(inv) {
  const issueDate = inv.approved_at
    ? new Date(inv.approved_at).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })
    : new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
  const planLabel = `Smile Slip Pro — ${PLAN_NAMES[inv.plan_id] || inv.plan_id} (${inv.is_yearly ? 'รายปี 12 เดือน' : 'รายเดือน'})`;

  return `<!DOCTYPE html>
<html lang="th">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{margin:0;padding:0;background:#f1f5f9;font-family:'Helvetica Neue',Arial,sans-serif;color:#1e293b}
  .wrap{max-width:620px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)}
  .header{background:linear-gradient(135deg,#1e293b 0%,#334155 100%);padding:32px 40px;text-align:center}
  .header h1{margin:0 0 4px;color:#fff;font-size:22px;font-weight:900;letter-spacing:-.5px}
  .header p{margin:0;color:#94a3b8;font-size:13px}
  .badge{display:inline-block;background:#10b981;color:#fff;font-size:11px;font-weight:700;padding:4px 12px;border-radius:20px;margin-top:12px;letter-spacing:.5px}
  .body{padding:36px 40px}
  .greeting{font-size:15px;line-height:1.7;color:#334155;margin-bottom:24px}
  .doc-box{background:#f8fafc;border:2px solid #e2e8f0;border-radius:12px;padding:24px;margin-bottom:24px}
  .doc-title{font-size:11px;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:16px}
  .inv-row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #e2e8f0;font-size:13.5px}
  .inv-row:last-child{border-bottom:none}
  .inv-label{color:#64748b}
  .inv-val{font-weight:700;color:#1e293b;text-align:right}
  .total-row{background:#1e293b;border-radius:8px;padding:12px 16px;display:flex;justify-content:space-between;margin-top:12px}
  .total-label{color:#94a3b8;font-size:13px;font-weight:700}
  .total-val{color:#10b981;font-size:16px;font-weight:900}
  .tax-no{background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px 16px;margin-bottom:24px;text-align:center}
  .tax-no-label{font-size:11px;color:#3b82f6;font-weight:700;text-transform:uppercase;letter-spacing:.8px}
  .tax-no-val{font-size:20px;font-weight:900;color:#1e40af;font-family:monospace;letter-spacing:2px}
  .note{background:#fefce8;border:1px solid #fde68a;border-radius:8px;padding:12px 16px;font-size:12.5px;color:#92400e;line-height:1.6;margin-bottom:24px}
  .footer{background:#f8fafc;padding:24px 40px;border-top:1px solid #e2e8f0;text-align:center}
  .footer p{margin:4px 0;font-size:12px;color:#94a3b8}
  .line-btn{display:inline-block;background:#06C755;color:#fff;font-weight:700;font-size:13px;padding:10px 28px;border-radius:24px;text-decoration:none;margin-top:12px}
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <h1>Smile Slip Pro</h1>
    <p>บริษัท สยาม โกลบอล เน็ทเวิร์ค เอ็นเตอร์ไพรส์ จำกัด</p>
    <div class="badge">✓ ชำระเงินสำเร็จ · เปิดใช้งานแล้ว</div>
  </div>

  <div class="body">
    <div class="greeting">
      เรียน คุณ / ฝ่ายบัญชี <strong>${inv.buyer_name}</strong><br><br>
      บริษัทฯ ได้รับการชำระเงินและตรวจสอบเอกสารเรียบร้อยแล้ว
      ขอขอบพระคุณที่เลือกใช้บริการ <strong>Smile Slip Pro</strong>
      และขอนำส่งใบกำกับภาษีเต็มรูปแบบดังรายละเอียดด้านล่าง
    </div>

    <div class="tax-no">
      <div class="tax-no-label">เลขที่ใบกำกับภาษี</div>
      <div class="tax-no-val">${inv.tax_invoice_no}</div>
      <div style="font-size:12px;color:#64748b;margin-top:4px">วันที่ออกเอกสาร: ${issueDate}</div>
    </div>

    <div class="doc-box">
      <div class="doc-title">รายละเอียดใบกำกับภาษี</div>
      <div class="inv-row"><span class="inv-label">แพ็กเกจ</span><span class="inv-val">${planLabel}</span></div>
      <div class="inv-row"><span class="inv-label">ผู้ออกเอกสาร</span><span class="inv-val">บริษัท สยาม โกลบอล ฯ&nbsp;(0505565019236)</span></div>
      <div class="inv-row"><span class="inv-label">ผู้ซื้อ</span><span class="inv-val">${inv.buyer_name}</span></div>
      <div class="inv-row"><span class="inv-label">เลขภาษีผู้ซื้อ</span><span class="inv-val">${inv.buyer_tax_id}</span></div>
      <div class="inv-row"><span class="inv-label">ราคาก่อน VAT</span><span class="inv-val">฿${fmt(inv.base_price)}</span></div>
      <div class="inv-row"><span class="inv-label">ภาษีมูลค่าเพิ่ม 7%</span><span class="inv-val">฿${fmt(inv.vat_amount)}</span></div>
      <div class="inv-row"><span class="inv-label">ราคารวม VAT</span><span class="inv-val">฿${fmt(inv.total_price)}</span></div>
      <div class="inv-row"><span class="inv-label">ภาษีหัก ณ ที่จ่าย 3%</span><span class="inv-val" style="color:#ef4444">- ฿${fmt(inv.wht_amount)}</span></div>
      <div class="total-row">
        <span class="total-label">ยอดชำระสุทธิ</span>
        <span class="total-val">฿${fmt(inv.net_amount)}</span>
      </div>
    </div>

    <div class="note">
      📎 <strong>ไฟล์ใบกำกับภาษี PDF</strong> แนบมาพร้อมกับอีเมลฉบับนี้แล้ว
      กรุณาตรวจสอบในส่วน Attachment / สิ่งที่แนบมา
    </div>

    <div style="text-align:center">
      <a href="https://lin.ee/uYhct4L" class="line-btn">💬 ติดต่อทีมงาน LINE</a>
    </div>
  </div>

  <div class="footer">
    <p><strong>บริษัท สยาม โกลบอล เน็ทเวิร์ค เอ็นเตอร์ไพรส์ จำกัด</strong></p>
    <p>76 หมู่ 9 ต.หางดง อ.หางดง จ.เชียงใหม่ 50230 · โทร 094-593-8254</p>
    <p>เลขประจำตัวผู้เสียภาษี: 0505565019236</p>
  </div>
</div>
</body>
</html>`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (!verifyAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });

  const { inv } = req.body;
  if (!inv?.buyer_email) return res.status(400).json({ error: 'ไม่มีอีเมลผู้รับ' });
  if (!inv?.tax_invoice_no) return res.status(400).json({ error: 'ยังไม่มีเลขใบกำกับภาษี' });

  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    return res.status(500).json({ error: 'ยังไม่ได้ตั้งค่า EMAIL_USER / EMAIL_PASS ใน .env' });
  }

  const transporter = nodemailer.createTransport({
    host:   process.env.EMAIL_HOST || 'smtp.gmail.com',
    port:   Number(process.env.EMAIL_PORT) || 465,
    secure: true,
    auth:   { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });

  const planLabel = `${PLAN_NAMES[inv.plan_id] || inv.plan_id} (${inv.is_yearly ? 'รายปี' : 'รายเดือน'})`;

  try {
    // สร้าง PDF ใบกำกับภาษี
    let pdfBuffer = null;
    try {
      pdfBuffer = await generateInvoicePdf(inv);
    } catch (pdfErr) {
      console.error('[send-email] PDF generation failed:', pdfErr.message);
    }

    const mailOptions = {
      from:    `"Smile Slip Pro" <${process.env.EMAIL_USER}>`,
      to:      inv.buyer_email,
      subject: `ใบกำกับภาษีเลขที่ ${inv.tax_invoice_no} — Smile Slip Pro ${planLabel}`,
      html:    buildHtml(inv),
    };

    if (pdfBuffer) {
      mailOptions.attachments = [{
        filename:    `TaxInvoice_${inv.tax_invoice_no}.pdf`,
        content:     pdfBuffer,
        contentType: 'application/pdf',
      }];
    }

    await transporter.sendMail(mailOptions);
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[send-email]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
