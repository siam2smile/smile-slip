/**
 * POST /api/booking/reserve — สาธารณะ ไม่ต้อง login (จากหน้า pages/booking-request.js)
 * { shopId, serviceId, providerId?, start_at(ISO — ต้องตรงกับที่ /availability คืนมาเป๊ะ),
 *   customer_name, customer_phone, customer_line_id?, notes? }
 *
 * บันทึกเป็น status:'pending' เสมอ (แม้บริการนั้นไม่ต้องมัดจำ) — ต้องรอแอดมิน/เจ้าของร้านกดยืนยันเสมอ
 * (Phase 4) แต่แถวที่มีอยู่ (แม้ pending) ก็ "ล็อกช่วงเวลานั้น" ไว้แล้วทันที กันจองซ้ำ/แข่งกันจองตาม
 * ที่ผู้ใช้ขอ — deposit (Phase 3) เป็นขั้นถัดไปที่ยกระดับ pending → confirmed อัตโนมัติผ่าน OCR
 */
import { createClient } from '@supabase/supabase-js';
import { hasFeature } from '../../../lib/tier-features';
import { configFromRow, serviceFromRow, providerFromRow, makeBookingNo, computeDepositAmount, getAvailableSlots } from '../../../lib/booking';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

// กันสแปม/ยิงรัวจากหน้าเว็บสาธารณะ — pattern เดียวกับ customer-orders.js เป๊ะ
const attempts = new Map(); // `${shopId}:${ip}` -> { count, windowStart }
const MAX_PER_WINDOW = 10;
const WINDOW_MS = 10 * 60 * 1000;
function isRateLimited(key) {
  const now = Date.now();
  const e = attempts.get(key);
  if (!e || now - e.windowStart > WINDOW_MS) return false;
  return e.count >= MAX_PER_WINDOW;
}
function recordAttempt(key) {
  const now = Date.now();
  const e = attempts.get(key);
  if (!e || now - e.windowStart > WINDOW_MS) attempts.set(key, { count: 1, windowStart: now });
  else e.count += 1;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const {
    shopId, serviceId, providerId = '', start_at,
    customer_name = '', customer_phone = '', customer_line_id = '', notes = '',
  } = req.body || {};
  if (!shopId || !serviceId || !start_at) return res.status(400).json({ error: 'ข้อมูลไม่ครบ' });
  if (!String(customer_name).trim()) return res.status(400).json({ error: 'กรุณากรอกชื่อผู้จอง' });
  if (!String(customer_phone).trim()) return res.status(400).json({ error: 'กรุณากรอกเบอร์โทร' });

  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const rlKey = `${shopId}:${ip}`;
  if (isRateLimited(rlKey)) return res.status(429).json({ error: 'จองบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่' });

  try {
    const [{ data: shop }, { data: configRow }, { data: serviceRow }] = await Promise.all([
      supabase.from('shop_profiles').select('shop_name, subscription_tier, status').eq('id', shopId).maybeSingle(),
      supabase.from('booking_configs').select('*').eq('shop_id', shopId).maybeSingle(),
      supabase.from('booking_services').select('*').eq('id', serviceId).eq('shop_id', shopId).is('deleted_at', null).maybeSingle(),
    ]);
    if (!shop) return res.status(404).json({ error: 'ไม่พบร้านค้านี้' });
    if (!hasFeature(shop.subscription_tier, 'booking')) return res.status(403).json({ error: 'ร้านนี้ยังไม่เปิดใช้งานระบบจอง' });
    if (shop.status === 'trial_expired') return res.status(403).json({ error: 'ร้านนี้ปิดรับการจองชั่วคราว กรุณาติดต่อร้านค้าโดยตรง' });
    const config = configFromRow(configRow) || configFromRow({});
    if (!config.enabled) return res.status(403).json({ error: 'ร้านนี้ยังไม่เปิดรับจองในขณะนี้' });
    if (!serviceRow || serviceRow.is_active === false) return res.status(404).json({ error: 'ไม่พบบริการนี้ หรือปิดให้บริการแล้ว' });
    const service = serviceFromRow(serviceRow);

    let provider = null;
    if (service.requires_staff_selection) {
      if (!providerId) return res.status(400).json({ error: 'กรุณาเลือกพนักงาน/ผู้ให้บริการ' });
      const { data: provRow } = await supabase.from('booking_providers').select('*')
        .eq('id', providerId).eq('shop_id', shopId).is('deleted_at', null).maybeSingle();
      if (!provRow || provRow.is_active === false) return res.status(404).json({ error: 'ไม่พบพนักงาน/ผู้ให้บริการนี้' });
      provider = providerFromRow(provRow);
    }

    const requestedDate = new Date(start_at);
    if (isNaN(requestedDate.getTime())) return res.status(400).json({ error: 'เวลาที่เลือกไม่ถูกต้อง' });
    const bkk = new Date(requestedDate.getTime() + 7 * 3600 * 1000);
    const dateStr = `${bkk.getUTCFullYear()}-${String(bkk.getUTCMonth() + 1).padStart(2, '0')}-${String(bkk.getUTCDate()).padStart(2, '0')}`;

    // ยืนยันซ้ำฝั่ง server เสมอว่าช่วงเวลานี้ยังว่างจริง ณ วินาทีนี้ — ห้ามเชื่อว่า /availability
    // ที่ลูกค้าเห็นก่อนหน้ายังถูกต้องอยู่ (กัน race condition + กันลูกค้ายิง request ตรงข้ามหน้าเว็บ)
    const { slots, error: slotErr } = await getAvailableSlots(supabase, {
      shopId, service: serviceRow, config, dateStr,
      providerId: service.requires_staff_selection ? providerId : undefined,
    });
    if (slotErr) return res.status(400).json({ error: slotErr });
    const requestedMs = requestedDate.getTime();
    const stillAvailable = (slots || []).some(s => new Date(s.start_at).getTime() === requestedMs);
    if (!stillAvailable) return res.status(409).json({ error: 'ช่วงเวลานี้เพิ่งถูกจองไปหรือไม่ว่างแล้ว กรุณาเลือกเวลาอื่น' });

    const endAt = new Date(requestedMs + service.duration_minutes * 60000);
    const depositAmount = computeDepositAmount(service);
    const booking_no = makeBookingNo();

    const { error: insertErr } = await supabase.from('booking_reservations').insert({
      shop_id: shopId, booking_no,
      service_id: service.id, service_name: service.name,
      provider_id: provider?.id || null, provider_name: provider?.name || null,
      customer_name: String(customer_name).trim(), customer_phone: String(customer_phone).trim(),
      customer_line_id: customer_line_id || null,
      branch_name: service.branch_name || null,
      start_at: requestedDate.toISOString(), end_at: endAt.toISOString(),
      price: service.price, deposit_required_amount: depositAmount,
      deposit_status: depositAmount > 0 ? 'pending' : 'not_required',
      status: 'pending', notes: notes ? String(notes).trim().slice(0, 1000) : null,
    });
    if (insertErr) throw insertErr;

    recordAttempt(rlKey);
    return res.json({
      ok: true, booking_no,
      service_name: service.name, provider_name: provider?.name || '',
      start_at: requestedDate.toISOString(), end_at: endAt.toISOString(),
      price: service.price, deposit_required_amount: depositAmount,
      cancellation_policy_text: config.cancellation_policy_text,
      no_show_refund_pct: config.no_show_refund_pct,
      cancellation_tiers: config.cancellation_tiers,
    });
  } catch (err) {
    console.error('[booking/reserve]', err.message);
    return res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' });
  }
}
