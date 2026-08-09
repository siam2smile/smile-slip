/**
 * GET /api/pos/promptpay-qr?shopId=xxx&amount=350
 * สร้าง PromptPay QR ล็อคยอดเงิน → คืน base64 PNG
 */
import { createClient } from '@supabase/supabase-js';
import generatePayload from 'promptpay-qr';
import QRCode from 'qrcode';
import { generateBillPaymentPayload } from '../../../lib/thai-qr-billpayment';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

function normalizePromptPayId(id) {
  if (!id) return null;
  // ลบช่องว่างและขีด
  const clean = id.replace(/[\s\-]/g, '');
  // เบอร์โทร: 08x / 09x / 06x → ยังคง format ไทย
  // เลขภาษี: 13 หลัก → ใช้ได้เลย
  return clean;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { shopId, amount } = req.query;
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });

  const numAmount = parseFloat(amount) || 0;

  try {
    // อ่านค่าตั้งค่า QR จาก pos_configs ก่อน ถ้าไม่มีใช้ phone จาก shop_profiles เป็น fallback
    // scb_biller_ref1 แยก query ต่างหาก + กันพัง (คอลัมน์ใหม่ อาจยังไม่ได้รัน ALTER TABLE)
    const [{ data: pc }, { data: sp }] = await Promise.all([
      supabase.from('pos_configs').select('promptpay_id, scb_biller_id').eq('shop_id', shopId).single(),
      supabase.from('shop_profiles').select('phone').eq('id', shopId).single(),
    ]);
    let billerRef1 = '';
    try {
      const { data: rd } = await supabase.from('pos_configs').select('scb_biller_ref1').eq('shop_id', shopId).single();
      billerRef1 = rd?.scb_biller_ref1 || '';
    } catch {}

    // ถ้าตั้งค่า Biller ID จากธนาคารไว้ (ธนาคารใดก็ได้ ไม่จำกัดแค่ SCB) ให้ใช้แบบ Bill Payment
    // (Tag 30) แทนพร้อมเพย์ส่วนบุคคล — เป็นคนละระบบกัน เงินจะเข้าบัญชีที่ผูกกับ Biller ID
    // นั้นโดยตรง ไม่ผ่านทะเบียนพร้อมเพย์ — ref1 (เลขอ้างอิง) เป็นฟิลด์บังคับตามสเปก ธปท. (ดู
    // เหตุผลเต็มใน pos-config.js) ไม่ใส่ = QR ขาดฟิลด์บังคับ สแกนไม่ได้แน่นอน
    if (pc?.scb_biller_id) {
      const payload = generateBillPaymentPayload(pc.scb_biller_id, { amount: numAmount, ref1: billerRef1 });
      const qrDataUrl = await QRCode.toDataURL(payload, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 300,
        color: { dark: '#000000', light: '#ffffff' },
      });
      return res.json({ ok: true, qr: qrDataUrl, billerId: pc.scb_biller_id, amount: numAmount, method: 'billpayment' });
    }

    const rawId = pc?.promptpay_id || sp?.phone || '';
    const promptpayId = normalizePromptPayId(rawId);

    if (!promptpayId) {
      return res.status(400).json({ error: 'ยังไม่ได้ตั้งค่าหมายเลข PromptPay หรือ Biller ID', notConfigured: true });
    }

    const payload = generatePayload(promptpayId, { amount: numAmount });
    const qrDataUrl = await QRCode.toDataURL(payload, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 300,
      color: { dark: '#000000', light: '#ffffff' },
    });

    return res.json({ ok: true, qr: qrDataUrl, promptpayId: rawId, amount: numAmount, method: 'promptpay' });

  } catch (err) {
    console.error('[promptpay-qr]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
