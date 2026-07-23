/**
 * GET /api/pos/open-bills?shopId=xxx        → อ่านบิล/โต๊ะที่เปิดค้างไว้ (ล่าสุดที่เครื่องไหนก็ตามบันทึกไว้)
 * PUT /api/pos/open-bills { shopId, bills, table_names }  → บันทึกทับ (last-write-wins)
 *
 * แก้ปัญหา: เดิม openBills เก็บใน localStorage ของเบราว์เซอร์แต่ละเครื่องเท่านั้น
 * ทำให้สลับเครื่อง (มือถือ/แท็บเล็ต/คอม) ด้วยบัญชีเดียวกันแล้วเห็นโต๊ะที่เปิดค้างไม่ตรงกัน
 * — ผู้ใช้ยืนยันแล้วว่าใช้งานทีละเครื่อง (ไม่ได้แก้พร้อมกันสองเครื่อง) จึงไม่ต้องมี
 * conflict resolution ซับซ้อน แค่ last-write-wins พอ (เก็บเป็น JSON blob ต่อร้าน ไม่ใช่ตารางเชิงสัมพันธ์
 * เพราะโครงสร้างบิลซับซ้อน/เปลี่ยนบ่อย เหมือน localStorage เดิมทุกประการ ย้ายที่เก็บอย่างเดียว)
 *
 * ไม่แตะ Google Sheets เลย เพราะนี่เป็นแค่ "ร่าง" บิลที่ยังไม่ได้ชำระเงินจริง
 * (บิลที่ checkout สำเร็จแล้วบันทึกผ่าน api/pos/sales.js ตามปกติ)
 */
import { createClient } from '@supabase/supabase-js';
import { blockIfTrialExpired } from '../../../lib/shop-access';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  const shopId = req.query.shopId || req.body?.shopId;
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });

  if (req.method === 'GET') {
    try {
      const { data, error } = await supabase
        .from('pos_open_bills')
        .select('bills, table_names, updated_at')
        .eq('shop_id', shopId)
        .single();
      // PGRST116 = ไม่พบแถว (ร้านนี้ยังไม่เคยบันทึก) — ถือว่าว่างเปล่าตามปกติ ไม่ใช่ error
      if (error && error.code !== 'PGRST116') throw error;
      return res.json({
        ok: true,
        bills: data?.bills || [],
        table_names: data?.table_names || [],
        updated_at: data?.updated_at || null,
      });
    } catch (err) {
      // ตาราง pos_open_bills ยังไม่ถูกสร้าง (รอรัน SQL) — fallback เป็นค่าว่าง ให้ฝั่งเว็บใช้ localStorage อย่างเดียวต่อไปได้
      console.error('[pos/open-bills] GET error:', err.message);
      return res.json({ ok: true, bills: [], table_names: [], tableMissing: true });
    }
  }

  if (req.method === 'PUT') {
    if (await blockIfTrialExpired(req, res, shopId)) return;
    const { bills = [], table_names = [] } = req.body;
    try {
      const { error } = await supabase
        .from('pos_open_bills')
        .upsert({ shop_id: shopId, bills, table_names, updated_at: new Date().toISOString() }, { onConflict: 'shop_id' });
      if (error) throw error;
      return res.json({ ok: true });
    } catch (err) {
      console.error('[pos/open-bills] PUT error:', err.message);
      // ไม่ throw ต่อ — ฝั่งเว็บยังมี localStorage เป็น fallback อยู่แล้ว ไม่ควรทำให้ขายของต่อไม่ได้
      return res.status(200).json({ ok: false, tableMissing: true, error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
