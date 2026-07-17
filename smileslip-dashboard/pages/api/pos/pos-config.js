/**
 * GET  /api/pos/pos-config?shopId=xxx  → อ่านการตั้งค่า POS
 * PATCH /api/pos/pos-config { shopId, staff_pin, promptpay_id, kbank_api_key, scb_api_key, scb_biller_id, receipt_paper_size }
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  const shopId = req.query.shopId || req.body?.shopId;
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('pos_configs')
      .select('staff_pin, promptpay_id, kbank_api_key, scb_api_key, scb_biller_id')
      .eq('shop_id', shopId)
      .single();

    if (error && error.code !== 'PGRST116') {
      return res.status(500).json({ error: error.message });
    }

    // แยก query ต่างหาก + กันพัง — คอลัมน์นี้ต้องรัน ALTER TABLE ด้วยมือก่อนถึงจะมีจริง
    // (ดู CLAUDE.md ต้องทำด้วยมือ) ถ้ายังไม่มีคอลัมน์ ให้ fallback เป็น '80mm' เงียบๆ
    // แทนที่จะทำให้ทั้ง endpoint พังจนตั้งค่า staff_pin/promptpay เดิมใช้ไม่ได้ไปด้วย
    let receipt_paper_size = '80mm';
    try {
      const { data: rd } = await supabase
        .from('pos_configs').select('receipt_paper_size').eq('shop_id', shopId).single();
      if (rd?.receipt_paper_size) receipt_paper_size = rd.receipt_paper_size;
    } catch {}

    return res.json({
      ok: true,
      has_pin: !!(data?.staff_pin),
      promptpay_id: data?.promptpay_id || '',
      has_kbank: !!(data?.kbank_api_key),
      has_scb: !!(data?.scb_api_key),
      scb_biller_id: data?.scb_biller_id || '',
      receipt_paper_size,
    });
  }

  if (req.method === 'PATCH') {
    const { staff_pin, promptpay_id, kbank_api_key, scb_api_key, scb_biller_id, receipt_paper_size } = req.body;

    const updates = {};
    if (staff_pin !== undefined)    updates.staff_pin    = staff_pin || null;
    if (promptpay_id !== undefined) updates.promptpay_id = promptpay_id || null;
    if (kbank_api_key !== undefined) updates.kbank_api_key = kbank_api_key || null;
    if (scb_api_key !== undefined)  updates.scb_api_key  = scb_api_key || null;
    if (scb_biller_id !== undefined) updates.scb_biller_id = scb_biller_id || null;

    if (Object.keys(updates).length) {
      const { error } = await supabase.from('pos_configs').update(updates).eq('shop_id', shopId);
      if (error) return res.status(500).json({ error: error.message });
    }

    // แยกอัปเดตคอลัมน์นี้ต่างหาก + กันพัง — ถ้ายังไม่ได้รัน ALTER TABLE (ดู CLAUDE.md)
    // จะ error เงียบๆ ไม่ทำให้ staff_pin/promptpay ด้านบนเซฟไม่ได้ไปด้วย
    if (receipt_paper_size !== undefined) {
      try {
        await supabase.from('pos_configs').update({ receipt_paper_size: receipt_paper_size || '80mm' }).eq('shop_id', shopId);
      } catch {}
    }

    return res.json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
