/**
 * POST /api/pos/tax-invoice { shopId, ref_bill_no, customer_id, buyer_name, buyer_tax_id,
 *   buyer_address, buyer_branch, items:[{name,qty,price,sku}], issued_by }
 *   → ออกใบกำกับภาษีให้ลูกค้าของร้าน (คนละระบบกับใบกำกับภาษีที่ Smile Slip Pro ออกให้ร้าน)
 *   → เลขที่รันต่อปี ไม่ให้เลขขาดหาย (นับจากจำนวนใบที่ออกไปแล้วในปีนั้น + 1)
 *   → คำนวณ VAT จาก vat_type ของสินค้าแต่ละชิ้น (ต้องมี SKU ตรงกับสินค้าจริงถึงจะคำนวณ VAT ได้)
 *
 * GET /api/pos/tax-invoice?shopId               → รายการใบกำกับภาษีทั้งหมด (ล่าสุดก่อน)
 * GET /api/pos/tax-invoice?shopId&invoice_no=xxx → ดึงใบเดียว (สำหรับพิมพ์ซ้ำ)
 */
import { createClient } from '@supabase/supabase-js';
import {
  getAccessToken, readSheet, appendSheet, ensureTabExists,
  rowToTaxInvoice, rowToProduct, TAX_INVOICE_HEADERS,
} from '../../../lib/google-pos';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

const VAT_RATE = 0.07;

async function getConfig(shopId) {
  const [{ data: pc }, { data: gc }] = await Promise.all([
    supabase.from('pos_configs').select('pos_sheet_id').eq('shop_id', shopId).single(),
    supabase.from('shop_google_configs').select('google_refresh_token').eq('shop_id', shopId).single(),
  ]);
  if (!pc?.pos_sheet_id) throw Object.assign(new Error('ยังไม่ได้ตั้งค่า POS'), { notSetup: true });
  if (!gc?.google_refresh_token) throw Object.assign(new Error('ยังไม่ได้เชื่อมต่อ Google'), { notConnected: true });
  return { sheetId: pc.pos_sheet_id, token: await getAccessToken(gc.google_refresh_token) };
}

export default async function handler(req, res) {
  const shopId = req.query.shopId || req.body?.shopId;
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });

  try {
    const { sheetId, token } = await getConfig(shopId);
    await ensureTabExists(token, sheetId, 'ใบกำกับภาษี', TAX_INVOICE_HEADERS);

    // ── GET ──────────────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      const rows = await readSheet(token, sheetId, 'ใบกำกับภาษี!A:M');
      const invoices = rows.slice(1).map(rowToTaxInvoice).filter(v => v.invoice_no).reverse();

      if (req.query.invoice_no) {
        return res.json({ invoice: invoices.find(v => v.invoice_no === req.query.invoice_no) || null });
      }
      return res.json({ invoices });
    }

    // ── POST — ออกใบกำกับภาษีใหม่ ────────────────────────────────────────────
    if (req.method === 'POST') {
      const {
        ref_bill_no = '', customer_id = '', buyer_name, buyer_tax_id = '',
        buyer_address = '', buyer_branch = 'สำนักงานใหญ่', items = [], issued_by = '',
      } = req.body;

      if (!buyer_name) return res.status(400).json({ error: 'ต้องระบุชื่อผู้ซื้อ' });
      if (!buyer_tax_id) return res.status(400).json({ error: 'ต้องระบุเลขประจำตัวผู้เสียภาษีของผู้ซื้อ' });
      if (!items.length) return res.status(400).json({ error: 'ต้องมีรายการสินค้าอย่างน้อย 1 รายการ' });

      // คำนวณ VAT จาก vat_type ของสินค้าแต่ละชิ้น (จับคู่ด้วย SKU)
      const prodRows = await readSheet(token, sheetId, 'สินค้า!A:R');
      const prodDataRows = prodRows.slice(1);
      let subtotal = 0, vat = 0;
      for (const item of items) {
        const qty = parseFloat(item.qty) || 0;
        const price = parseFloat(item.price) || 0;
        const lineTotal = qty * price;
        const prod = item.sku ? prodDataRows.find(r => r[0] === item.sku) : null;
        const vatType = prod ? rowToProduct(prod).vat_type : 'ไม่มี VAT';
        if (vatType === 'รวม VAT แล้ว') {
          // ราคาที่ตั้งไว้รวม VAT อยู่แล้ว — แยกกลับออกมา
          const base = lineTotal / (1 + VAT_RATE);
          subtotal += base;
          vat += lineTotal - base;
        } else if (vatType === 'ไม่รวม VAT') {
          subtotal += lineTotal;
          vat += lineTotal * VAT_RATE;
        } else {
          subtotal += lineTotal; // ไม่มี VAT
        }
      }
      subtotal = Math.round(subtotal * 100) / 100;
      vat = Math.round(vat * 100) / 100;
      const total = Math.round((subtotal + vat) * 100) / 100;

      // เลขที่รันต่อปี — นับจากจำนวนใบที่ออกไปแล้วในปีนี้ + 1 กันเลขขาดหาย
      const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
      const yearBE = new Date().toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', year: 'numeric' });
      const existingRows = await readSheet(token, sheetId, 'ใบกำกับภาษี!A:A');
      const countThisYear = existingRows.slice(1)
        .filter(r => (r[0] || '').includes(`-${yearBE}-`)).length;
      const invoice_no = `INV-${yearBE}-${String(countThisYear + 1).padStart(5, '0')}`;

      await appendSheet(token, sheetId, 'ใบกำกับภาษี', [
        invoice_no, now, ref_bill_no, customer_id,
        buyer_name, buyer_tax_id, buyer_address, buyer_branch,
        JSON.stringify(items), subtotal, vat, total, issued_by,
      ]);

      return res.json({ ok: true, invoice_no, subtotal, vat, total, issued_at: now });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('[pos/tax-invoice]', err.message);
    if (err.notSetup) return res.status(400).json({ error: err.message, notSetup: true });
    if (err.notConnected) return res.status(400).json({ error: err.message, notConnected: true });
    return res.status(500).json({ error: err.message });
  }
}
