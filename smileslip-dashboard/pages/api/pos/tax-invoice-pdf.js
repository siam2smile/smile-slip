/**
 * GET /api/pos/tax-invoice-pdf?shopId=xxx&invoice_no=INV-2569-00001
 * → สตรีม PDF ใบกำกับภาษี/ใบเสร็จรับเงินของร้าน (รูปแบบทางการ A4 แบบเดียวกับใบกำกับภาษีที่แอดมิน
 *   Smile Slip Pro ออกให้ร้านตอนซื้อแพ็กเกจ — ดู lib/pos-tax-invoice-pdf.js)
 *
 * Phase 2 (write-primary flip, 2026-07-29): อ่านจาก Supabase (pos_tax_invoices) โดยตรงแล้ว
 * ไม่ผ่าน Google Sheets/Google connection อีกต่อไป
 */
import { createClient } from '@supabase/supabase-js';
import { taxInvoiceRecordFromRow } from '../../../lib/google-pos';
import { generatePosTaxInvoicePdf } from '../../../lib/pos-tax-invoice-pdf';
import { hasFeature } from '../../../lib/tier-features';
import { requirePermission } from '../../../lib/pos-auth';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  const { shopId, invoice_no } = req.query;
  if (!shopId || !invoice_no) return res.status(400).json({ error: 'Missing shopId/invoice_no' });
  if (!(await requirePermission(req, res, shopId, 'perm_issue_tax_invoice'))) return;

  try {
    const [{ data: invoiceRow }, { data: shop }] = await Promise.all([
      supabase.from('pos_tax_invoices').select('*').eq('shop_id', shopId).eq('invoice_no', invoice_no).maybeSingle(),
      supabase.from('shop_profiles').select('shop_name, address, tax_id, phone, subscription_tier').eq('id', shopId).single(),
    ]);
    if (!invoiceRow) return res.status(404).json({ error: 'ไม่พบใบกำกับภาษีนี้' });
    const invoice = taxInvoiceRecordFromRow(invoiceRow);

    // ถ้าใบนี้ออกโดยสาขาที่มีชื่อ/ที่อยู่แยกจากบริษัทหลัก (บันทึกไว้ตอนออกจริง) ใช้ข้อมูลนั้นแทน
    // — ไม่คำนวณจากการตั้งค่าสาขาปัจจุบันใหม่ กันเอกสารเปลี่ยนย้อนหลังถ้ามีการแก้ไขทีหลัง
    const shopInfo = invoice.seller_name
      ? { ...shop, shop_name: invoice.seller_name, address: invoice.seller_address || shop?.address }
      : (shop || {});

    const pdf = await generatePosTaxInvoicePdf({
      invoice_no: invoice.invoice_no,
      issued_at: invoice.issued_at,
      ref_bill_no: invoice.ref_bill_no,
      issued_by: invoice.issued_by,
      shopInfo,
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
      isWhiteLabel: hasFeature(shop?.subscription_tier, 'white_label'),
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${invoice_no}.pdf"`);
    return res.send(pdf);
  } catch (err) {
    console.error('[pos/tax-invoice-pdf]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
