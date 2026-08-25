/**
 * GET/PATCH /api/booking/config?shopId=xxx — เวลาเปิด-ปิด, จองล่วงหน้าได้กี่วัน, นโยบายยกเลิก/
 * เบี้ยวนัด (ตารางขั้นบันได % คืนเงิน + ข้อความอิสระ), เปิด/ปิดปุ่มชวนแอดไลน์รับแจ้งเตือน
 */
import { createClient } from '@supabase/supabase-js';
import { requireOwnerAuth } from '../../../lib/owner-auth';
import { configFromRow } from '../../../lib/booking';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  const { shopId } = req.method === 'GET' ? req.query : req.body;
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });
  if (!requireOwnerAuth(req, res, shopId, { enforce: true })) return;

  if (req.method === 'GET') {
    const { data } = await supabase.from('booking_configs').select('*').eq('shop_id', shopId).maybeSingle();
    return res.json({ config: configFromRow(data) || configFromRow({}) });
  }

  if (req.method === 'PATCH') {
    const {
      business_hours, advance_booking_days, no_show_refund_pct,
      cancellation_tiers, cancellation_policy_text, line_reminder_enabled,
    } = req.body;

    const updates = { shop_id: shopId, updated_at: new Date().toISOString() };
    if (business_hours !== undefined) updates.business_hours = business_hours;
    if (advance_booking_days !== undefined) updates.advance_booking_days = Math.max(0, Number(advance_booking_days) || 0);
    if (no_show_refund_pct !== undefined) updates.no_show_refund_pct = Math.max(0, Math.min(100, Number(no_show_refund_pct) || 0));
    if (cancellation_tiers !== undefined) {
      if (!Array.isArray(cancellation_tiers)) return res.status(400).json({ error: 'cancellation_tiers ต้องเป็น array' });
      updates.cancellation_tiers = cancellation_tiers.map(t => ({
        min_days_before: Math.max(0, Number(t.min_days_before) || 0),
        refund_pct: Math.max(0, Math.min(100, Number(t.refund_pct) || 0)),
      }));
    }
    if (cancellation_policy_text !== undefined) updates.cancellation_policy_text = String(cancellation_policy_text).slice(0, 2000);
    if (line_reminder_enabled !== undefined) updates.line_reminder_enabled = !!line_reminder_enabled;

    try {
      const { error } = await supabase.from('booking_configs').upsert(updates, { onConflict: 'shop_id' });
      if (error) throw error;
      return res.json({ ok: true });
    } catch (err) {
      console.error('[booking/config]', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  res.setHeader('Allow', ['GET', 'PATCH']);
  return res.status(405).json({ error: 'Method not allowed' });
}
