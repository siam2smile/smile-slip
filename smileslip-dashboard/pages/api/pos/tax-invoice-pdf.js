/**
 * GET /api/pos/tax-invoice-pdf?shopId=xxx&invoice_no=INV-2569-00001
 * → สตรีม PDF ใบกำกับภาษี/ใบเสร็จรับเงินของร้าน (รูปแบบทางการ A4 แบบเดียวกับใบกำกับภาษีที่แอดมิน
 *   Smile Slip Pro ออกให้ร้านตอนซื้อแพ็กเกจ — ดู lib/pos-tax-invoice-pdf.js)
 */
import { createClient } from '@supabase/supabase-js';
import { getAccessToken, readSheet, rowToTaxInvoice } from '../../../lib/google-pos';
import { generatePosTaxInvoicePdf } from '../../../lib/pos-tax-invoice-pdf';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  const { shopId, invoice_no } = req.query;
  if (!shopId || !invoice_no) return res.status(400).json({ error: 'Missing shopId/invoice_no' });

  try {
    const [{ data: pc }, { data: gc }, { data: shop }] = await Promise.all([
      supabase.from('pos_configs').select('pos_sheet_id').eq('shop_id', shopId).single(),
      supabase.from('shop_google_configs').select('google_refresh_token').eq('shop_id', shopId).single(),
      supabase.from('shop_profiles').select('shop_name, address, tax_id, phone').eq('id', shopId).single(),
    ]);
    if (!pc?.pos_sheet_id) return res.status(400).json({ error: 'ยังไม่ได้ตั้งค่า POS' });
    if (!gc?.google_refresh_token) return res.status(400).json({ error: 'ยังไม่ได้เชื่อมต่อ Google' });

    const token = await getAccessToken(gc.google_refresh_token);
    const rows = await readSheet(token, pc.pos_sheet_id, 'ใบกำกับภาษี!A:N');
    const invoice = rows.slice(1).map(rowToTaxInvoice).find(v => v.invoice_no === invoice_no);
    if (!invoice) return res.status(404).json({ error: 'ไม่พบใบกำกับภาษีนี้' });

    const pdf = await generatePosTaxInvoicePdf({
      invoice_no: invoice.invoice_no,
      issued_at: invoice.issued_at,
      ref_bill_no: invoice.ref_bill_no,
      issued_by: invoice.issued_by,
      shopInfo: shop || {},
      buyer: {
        name: invoice.buyer_name,
        tax_id: invoice.buyer_tax_id,
        address: invoice.buyer_address,
        branch: invoice.buyer_branch,
        phone: invoice.buyer_phone,
      },
      items: invoice.items,
      subtotal: invoice.subtotal,
      vat: invoice.vat,
      total: invoice.total,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${invoice_no}.pdf"`);
    return res.send(pdf);
  } catch (err) {
    console.error('[pos/tax-invoice-pdf]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
