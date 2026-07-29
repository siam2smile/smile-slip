/**
 * POST /api/pos/tax-invoice { shopId, ref_bill_no, customer_id, buyer_name, buyer_tax_id,
 *   buyer_address, buyer_branch, items:[{name,qty,price,sku}], issued_by }
 *   → ออกใบกำกับภาษีให้ลูกค้าของร้าน (คนละระบบกับใบกำกับภาษีที่ Smile Slip Pro ออกให้ร้าน)
 *   → เลขที่รันต่อปี ไม่ให้เลขขาดหาย (นับจากจำนวนใบที่ออกไปแล้วในปีนั้น + 1)
 *   → คำนวณ VAT จาก vat_type ของสินค้าแต่ละชิ้น (ต้องมี SKU ตรงกับสินค้าจริงถึงจะคำนวณ VAT ได้)
 *
 * GET /api/pos/tax-invoice?shopId               → รายการใบกำกับภาษีทั้งหมด (ล่าสุดก่อน)
 * GET /api/pos/tax-invoice?shopId&invoice_no=xxx → ดึงใบเดียว (สำหรับพิมพ์ซ้ำ)
 *
 * Phase 2 (write-primary flip, 2026-07-29): อ่าน/เขียนจาก Supabase (pos_tax_invoices/pos_products)
 * โดยตรงแล้ว ไม่ผ่าน Google Sheets/Google connection อีกต่อไป
 */
import { createClient } from '@supabase/supabase-js';
import { blockIfTrialExpired } from '../../../lib/shop-access';
import { taxInvoiceRecordFromRow, productFromRow } from '../../../lib/google-pos';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

const VAT_RATE = 0.07;

export default async function handler(req, res) {
  const shopId = req.query.shopId || req.body?.shopId;
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });

  // เขียนไม่ได้ถ้าทดลองใช้ 30 วันหมดอายุแล้ว (อ่าน/GET ยังทำได้ปกติเสมอ)
  if (req.method !== 'GET' && (await blockIfTrialExpired(req, res, shopId))) return;

  try {
    // ── GET ──────────────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      const { data, error } = await supabase.from('pos_tax_invoices').select('*')
        .eq('shop_id', shopId).order('created_at', { ascending: false });
      if (error) throw error;
      const invoices = (data || []).map(taxInvoiceRecordFromRow).filter(v => v.invoice_no);

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
        buyer_phone = '', seller_name = '', seller_address = '',
      } = req.body;

      if (!buyer_name) return res.status(400).json({ error: 'ต้องระบุชื่อผู้ซื้อ' });
      if (!buyer_tax_id) return res.status(400).json({ error: 'ต้องระบุเลขประจำตัวผู้เสียภาษีของผู้ซื้อ' });
      if (!items.length) return res.status(400).json({ error: 'ต้องมีรายการสินค้าอย่างน้อย 1 รายการ' });
      // เอกสารทางการ (ใบกำกับภาษี) ต้องไม่มีจำนวน/ราคาติดลบเด็ดขาด (ผิดกฎหมาย/ผิดหลักบัญชี)
      if (items.some(i => !(parseFloat(i.qty) > 0))) {
        return res.status(400).json({ error: 'จำนวนสินค้าต้องมากกว่า 0 ทุกรายการ' });
      }
      if (items.some(i => parseFloat(i.price) < 0)) {
        return res.status(400).json({ error: 'ราคาสินค้าต้องไม่ติดลบ' });
      }

      // คำนวณ VAT จาก vat_type ของสินค้าแต่ละชิ้น (จับคู่ด้วย SKU)
      const skus = items.map(i => i.sku).filter(Boolean);
      let productsBySku = {};
      if (skus.length) {
        const { data: prodRows } = await supabase.from('pos_products').select('*')
          .eq('shop_id', shopId).in('sku', skus).is('deleted_at', null);
        for (const row of prodRows || []) productsBySku[row.sku] = productFromRow(row);
      }
      let subtotal = 0, vat = 0;
      for (const item of items) {
        const qty = parseFloat(item.qty) || 0;
        const price = parseFloat(item.price) || 0;
        const lineTotal = qty * price;
        const vatType = item.sku && productsBySku[item.sku] ? productsBySku[item.sku].vat_type : 'ไม่มี VAT';
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
      // toLocaleDateString('th-TH') คืนสตริงแบบ "พ.ศ. 2569" (มีจุด/วรรค) ไม่เหมาะเป็นส่วนหนึ่งของ
      // เลขที่เอกสาร — ดึงเฉพาะตัวเลขปี พ.ศ. ออกมา (ปี ค.ศ. + 543)
      const yearBE = String(new Date().getFullYear() + 543);
      const { count: countThisYear } = await supabase.from('pos_tax_invoices')
        .select('invoice_no', { count: 'exact' }).eq('shop_id', shopId).like('invoice_no', `%-${yearBE}-%`);
      const invoice_no = `INV-${yearBE}-${String((countThisYear || 0) + 1).padStart(5, '0')}`;

      const { error } = await supabase.from('pos_tax_invoices').insert({
        shop_id: shopId, invoice_no, issued_at: now, ref_bill_no, customer_id,
        buyer_name, buyer_tax_id, buyer_address, buyer_branch, items,
        subtotal, vat, total, issued_by, buyer_phone, seller_name, seller_address,
      });
      if (error) throw error;

      return res.json({ ok: true, invoice_no, subtotal, vat, total, issued_at: now });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('[pos/tax-invoice]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
