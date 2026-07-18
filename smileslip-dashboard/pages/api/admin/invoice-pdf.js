/**
 * GET /api/admin/invoice-pdf?id=xxx
 * Download PDF ใบกำกับภาษีสำหรับ admin (ต้อง login admin ก่อน)
 */
import { createClient } from '@supabase/supabase-js';
import { generateInvoicePdf } from '../../../lib/invoice-pdf.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

function verifyAdmin(req) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (!token) return false;
  try { return Buffer.from(token, 'base64').toString('utf8').startsWith('smileslip-admin:'); }
  catch { return false; }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  if (!verifyAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'ไม่พบ id' });

  const { data: inv, error } = await supabase
    .from('invoice_requests')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !inv) return res.status(404).json({ error: 'ไม่พบใบแจ้งหนี้' });
  if (inv.status !== 'issued') return res.status(400).json({ error: 'ยังไม่ได้ออกใบกำกับภาษี' });

  try {
    const pdfBuffer = await generateInvoicePdf(inv);
    const filename = `TaxInvoice_${inv.tax_invoice_no}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader('Content-Length', pdfBuffer.length);
    return res.send(pdfBuffer);
  } catch (err) {
    console.error('[invoice-pdf]', err.message);
    return res.status(500).json({ error: 'สร้าง PDF ไม่สำเร็จ: ' + err.message });
  }
}
