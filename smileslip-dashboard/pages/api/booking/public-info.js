/**
 * GET /api/booking/public-info?shopId=xxx — สาธารณะ ไม่ต้อง login
 * → ข้อมูลขั้นต่ำสุดสำหรับหน้าจองของลูกค้า (pages/booking-request.js): ชื่อร้าน, เปิดรับจองไหม,
 *   รายการบริการ/พนักงานที่เปิดใช้งานอยู่, นโยบายยกเลิก/เบี้ยวนัด — ไม่คืนข้อมูลอ่อนไหวใดๆ
 */
import { createClient } from '@supabase/supabase-js';
import { hasFeature } from '../../../lib/tier-features';
import { configFromRow, serviceFromRow, providerFromRow } from '../../../lib/booking';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const { shopId } = req.query;
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });

  const [{ data: shop }, { data: configRow }, { data: serviceRows }, { data: providerRows }] = await Promise.all([
    supabase.from('shop_profiles').select('shop_name, status, subscription_tier').eq('id', shopId).maybeSingle(),
    supabase.from('booking_configs').select('*').eq('shop_id', shopId).maybeSingle(),
    supabase.from('booking_services').select('*').eq('shop_id', shopId).is('deleted_at', null).order('created_at', { ascending: true }),
    supabase.from('booking_providers').select('*').eq('shop_id', shopId).is('deleted_at', null).order('created_at', { ascending: true }),
  ]);
  if (!shop) return res.status(404).json({ error: 'ไม่พบร้านค้านี้' });

  const config = configFromRow(configRow) || configFromRow({});
  // เช็ค tier ทุกครั้งที่อ่าน (ไม่ใช่แค่ตอนเปิดใช้งานครั้งแรก) — ถ้าร้านลดแพ็กเกจลงมาต่ำกว่า Advance
  // ทีหลัง หน้าจองสาธารณะต้องหยุดรับจองใหม่ทันที สอดคล้องกับฟีเจอร์ tier-gated อื่นในระบบ
  const accepting = !!config.enabled && hasFeature(shop.subscription_tier, 'booking') && shop.status !== 'trial_expired';
  const services = (serviceRows || []).map(serviceFromRow).filter(s => s.is_active !== false);
  const providers = (providerRows || []).map(providerFromRow).filter(p => p.is_active !== false);

  return res.json({
    shop_name: shop.shop_name || '',
    accepting_bookings: accepting,
    advance_booking_days: config.advance_booking_days,
    no_show_refund_pct: config.no_show_refund_pct,
    cancellation_tiers: config.cancellation_tiers,
    cancellation_policy_text: config.cancellation_policy_text,
    line_reminder_enabled: config.line_reminder_enabled,
    services,
    providers,
  });
}
