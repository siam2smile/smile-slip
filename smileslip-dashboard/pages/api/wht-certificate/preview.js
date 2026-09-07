/**
 * GET /api/wht-certificate/preview?direction=we_withhold|they_withhold&docDate=...&baseAmount=...
 *     &whtAmount=...&incomeTypeCode=...&incomeTypeOther=...&payerName=...&payerAddress=...&payerTaxId=...
 *     &payeeName=...&payeeAddress=...&payeeTaxId=...&isWhiteLabel=0|1&certNo=...&download=0|1
 *
 * คืน PDF inline (stateless — ไม่แตะ DB เลย, pattern เดียวกับ /api/voucher/preview.js) สำหรับแสดง
 * preview สดขณะแก้ฟอร์ม + ใช้เป็นลิงก์ดาวน์โหลด/ปริ้นฉบับจริงหลังบันทึกเลขที่แล้ว (แนบ certNo มาด้วย)
 */
import { generateWhtCertificatePdf } from '../../../lib/wht-certificate-pdf';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const {
    direction, docDate, baseAmount, whtAmount,
    incomeTypeCode, incomeTypeOther,
    payerName, payerAddress, payerTaxId,
    payeeName, payeeAddress, payeeTaxId,
    isWhiteLabel, certNo, download,
  } = req.query;

  try {
    const pdfBuffer = await generateWhtCertificatePdf({
      certNo: certNo || null,
      isDraft: direction === 'they_withhold',
      docDate,
      payer: { name: payerName, address: payerAddress, taxId: payerTaxId },
      payee: { name: payeeName, address: payeeAddress, taxId: payeeTaxId },
      incomeTypeCode: incomeTypeCode || '5',
      incomeTypeOther,
      baseAmount: parseFloat(baseAmount) || 0,
      whtAmount: parseFloat(whtAmount) || 0,
      isWhiteLabel: isWhiteLabel === '1',
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${download === '1' ? 'attachment' : 'inline'}; filename="wht-certificate${certNo ? `-${certNo}` : ''}.pdf"`);
    return res.status(200).send(pdfBuffer);
  } catch (err) {
    console.error('[wht-certificate/preview]', err.message);
    return res.status(500).json({ error: 'สร้าง PDF ไม่สำเร็จ' });
  }
}
