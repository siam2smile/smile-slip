/**
 * GET   /api/pos/procurement-alerts?shopId&status  → รายการ red flag ราคาผิดปกติ (จับทุจริตจัดซื้อ)
 * PATCH /api/pos/procurement-alerts { shopId, id, status }  → เปลี่ยนสถานะ (investigated/resolved)
 *
 * ข้อมูลมาจาก lib/market-price.js (checkProcurementFraud) ที่เรียกจาก api/pos/receives.js
 * ทุกครั้งที่รับสินค้าเข้า — เทียบราคาที่ซื้อจริงกับราคากลางอำเภอ/จังหวัด
 */
import { createClient } from '@supabase/supabase-js';
import { blockIfTrialExpired } from '../../../lib/shop-access';
import { blockAllStaffSessions } from '../../../lib/pos-auth';
import { requireOwnerAuth } from '../../../lib/owner-auth';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  const shopId = req.query.shopId || req.body?.shopId;
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });

  // เขียนไม่ได้ถ้าทดลองใช้ 30 วันหมดอายุแล้ว (อ่าน/GET ยังทำได้ปกติเสมอ)
  if (req.method !== 'GET' && (await blockIfTrialExpired(req, res, shopId))) return;


  try {
    // ฟีเจอร์นี้เป็นเครื่องมือตรวจสอบทุจริตจัดซื้อของพนักงานเอง — ไม่มีสิทธิ์ไหนควรปลดล็อคให้
    // session พนักงานเห็น/แก้ได้เลย (ต่างจากไฟล์อื่นที่มี permKey เฉพาะทาง) ต้องเป็นเจ้าของร้าน/แอดมินเท่านั้น
    if (!blockAllStaffSessions(req, res, shopId)) return;
    // เรียกจาก fetchReport('fraud')/updateProcurementAlertStatus() ใน pos.js (คลิกแท็บ/ปุ่ม
    // เสมอ ไม่ใช่ initial load) — fetch() override แนบ token ทันเวลาแล้ว ปลอดภัยที่จะบังคับ
    if (!requireOwnerAuth(req, res, shopId, { enforce: true })) return;

    if (req.method === 'GET') {
      let query = supabase.from('procurement_alerts').select('*').eq('shop_id', shopId).order('created_at', { ascending: false });
      if (req.query.status && req.query.status !== 'ทั้งหมด') query = query.eq('status', req.query.status);
      const { data, error } = await query;
      if (error) throw error;
      return res.json({ alerts: data || [] });
    }

    if (req.method === 'PATCH') {
      const { id, status } = req.body;
      if (!id || !status) return res.status(400).json({ error: 'Missing id/status' });
      const { error } = await supabase.from('procurement_alerts').update({ status }).eq('id', id).eq('shop_id', shopId);
      if (error) throw error;
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[pos/procurement-alerts]', err.message);
    // ตารางอาจยังไม่ถูกสร้าง (รอผู้ใช้รัน SQL) — คืนรายการว่างแทนการ error กันหน้าเว็บพัง
    if (req.method === 'GET') return res.json({ alerts: [], notSetup: true });
    return res.status(500).json({ error: err.message });
  }
}
