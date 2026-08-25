// Helper กลางสำหรับโมดูลระบบจองคิว/นัดหมาย — mirror pattern ของ lib/google-pos.js (makeSKU()
// ฯลฯ) แต่ทั้งโมดูลนี้เป็น Supabase ล้วนตั้งแต่วันแรก ไม่มี Google Sheets baggage เลย

export function makeServiceNo() {
  const rand = Math.random().toString(36).slice(2, 5).toUpperCase();
  return 'SV' + Date.now().toString(36).toUpperCase().slice(-6) + rand;
}

export function makeBookingNo() {
  const rand = Math.random().toString(36).slice(2, 5).toUpperCase();
  return 'BK' + Date.now().toString(36).toUpperCase().slice(-6) + rand;
}

export function configFromRow(r) {
  if (!r) return null;
  return {
    enabled: !!r.enabled,
    business_hours: r.business_hours || {},
    advance_booking_days: r.advance_booking_days ?? 30,
    no_show_refund_pct: r.no_show_refund_pct ?? 0,
    cancellation_tiers: r.cancellation_tiers || [],
    cancellation_policy_text: r.cancellation_policy_text || '',
    line_reminder_enabled: r.line_reminder_enabled !== false,
  };
}

export function serviceFromRow(r) {
  return {
    id: r.id,
    service_no: r.service_no,
    name: r.name || '',
    description: r.description || '',
    duration_minutes: r.duration_minutes || 60,
    price: Number(r.price) || 0,
    requires_staff_selection: !!r.requires_staff_selection,
    deposit_required: !!r.deposit_required,
    deposit_type: r.deposit_type || 'percent',
    deposit_value: r.deposit_value != null ? Number(r.deposit_value) : 0,
    max_concurrent: r.max_concurrent || 1,
    branch_name: r.branch_name || '',
    is_active: r.is_active !== false,
  };
}

export function providerFromRow(r) {
  return {
    id: r.id,
    name: r.name || '',
    branch_name: r.branch_name || '',
    is_active: r.is_active !== false,
  };
}

// คำนวณยอดมัดจำจริง (บาท) จากค่าตั้งไว้ของบริการ ณ ตอนจอง — ใช้ทั้งฝั่งแสดงผล (Phase 2) และ
// ตอนบันทึกแถวจอง (snapshot ลง booking_reservations.deposit_required_amount)
export function computeDepositAmount(service) {
  if (!service?.deposit_required) return 0;
  if (service.deposit_type === 'fixed') return Math.max(0, Number(service.deposit_value) || 0);
  const pct = Math.max(0, Math.min(100, Number(service.deposit_value) || 0));
  return Math.round(((Number(service.price) || 0) * pct) / 100 * 100) / 100;
}

// ── Bangkok date/time — pure UTC arithmetic เสมอ ไม่พึ่ง timezone ของเครื่อง/container ที่รัน
//    (pattern เดียวกับ lib/ledger-supabase.js's bangkokMidnightUTC()/bangkokTodayRangeISO() —
//    duplicate ไว้ที่นี่ตามธรรมเนียมโปรเจกต์แทนแชร์ module ข้ามไฟล์) ────────────────────────────
export function bangkokMidnightUTC(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day, -7, 0, 0));
}

export function bangkokTodayParts(atMs = Date.now()) {
  const bkk = new Date(atMs + 7 * 3600 * 1000);
  return { year: bkk.getUTCFullYear(), month: bkk.getUTCMonth() + 1, day: bkk.getUTCDate() };
}

const DOW_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
export function dayOfWeekKey(year, month, day) {
  return DOW_KEYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

export function daysBetween(y1, m1, d1, y2, m2, d2) {
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

export function formatBangkokHM(date) {
  const bkk = new Date(date.getTime() + 7 * 3600 * 1000);
  return `${String(bkk.getUTCHours()).padStart(2, '0')}:${String(bkk.getUTCMinutes()).padStart(2, '0')}`;
}

/**
 * คำนวณ "ช่วงเวลาที่จองได้จริงตอนนี้" สำหรับบริการ+วันที่หนึ่งๆ — เป็นจุดคำนวณเดียวที่ทั้ง
 * availability.js (แสดงให้ลูกค้าเลือก) และ reserve.js (ยืนยันซ้ำก่อนบันทึกจริง — กัน race
 * condition/ลูกค้ายิง request ตรงข้ามหน้าเว็บ) เรียกใช้ร่วมกัน — ตั้งใจไม่ duplicate logic นี้ข้ามไฟล์
 * เพราะเสี่ยง drift แบบที่โปรเจกต์นี้เจอมาแล้วหลายรอบ (reports.js/export.js)
 *
 * - ไม่ระบุ requires_staff_selection: capacity = service.max_concurrent (ห้อง/เตียง/ทรัพยากรร่วม)
 * - requires_staff_selection: ต้องมี providerId เสมอ, capacity = 1 เพราะพนักงาน 1 คนอยู่ได้ที่เดียว
 */
export async function getAvailableSlots(supabase, { shopId, service, config, dateStr, providerId }) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
  if (!m) return { error: 'รูปแบบวันที่ไม่ถูกต้อง' };
  const y = parseInt(m[1], 10), mo = parseInt(m[2], 10), d = parseInt(m[3], 10);

  const today = bangkokTodayParts();
  const diffDays = daysBetween(today.year, today.month, today.day, y, mo, d);
  if (diffDays < 0) return { error: 'ไม่สามารถจองวันที่ผ่านมาแล้วได้' };
  const maxDays = config?.advance_booking_days ?? 30;
  if (diffDays > maxDays) return { error: `จองล่วงหน้าได้ไม่เกิน ${maxDays} วัน` };

  const requiresStaff = !!service.requires_staff_selection;
  if (requiresStaff && !providerId) return { error: 'บริการนี้ต้องเลือกพนักงาน/ผู้ให้บริการก่อน' };

  const dayKey = dayOfWeekKey(y, mo, d);
  const ranges = (config?.business_hours || {})[dayKey] || [];
  if (!ranges.length) return { slots: [] };

  const dayStart = bangkokMidnightUTC(y, mo, d);
  const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000);

  let query = supabase.from('booking_reservations').select('start_at, end_at')
    .eq('shop_id', shopId).eq('service_id', service.id).in('status', ['pending', 'confirmed'])
    .lt('start_at', dayEnd.toISOString()).gt('end_at', dayStart.toISOString());
  if (requiresStaff) query = query.eq('provider_id', providerId);
  const { data: existing, error } = await query;
  if (error) return { error: error.message };

  const durationMin = service.duration_minutes || 60;
  const durationMs = durationMin * 60000;
  const nowMs = Date.now();
  const capacity = requiresStaff ? 1 : Math.max(1, Number(service.max_concurrent) || 1);
  const slots = [];

  for (const range of ranges) {
    const [sh, sm] = String(range.start || '00:00').split(':').map(n => parseInt(n, 10) || 0);
    const [eh, em] = String(range.end || '00:00').split(':').map(n => parseInt(n, 10) || 0);
    const dayBaseMs = dayStart.getTime();
    let cursorMs = dayBaseMs + (sh * 60 + sm) * 60000;
    const rangeEndMs = dayBaseMs + (eh * 60 + em) * 60000;

    while (cursorMs + durationMs <= rangeEndMs) {
      const slotStartMs = cursorMs, slotEndMs = cursorMs + durationMs;
      cursorMs += durationMs;
      if (slotStartMs <= nowMs) continue; // อดีตไปแล้ว ข้าม

      const overlapCount = (existing || []).filter(r => {
        const rs = new Date(r.start_at).getTime(), re = new Date(r.end_at).getTime();
        return rs < slotEndMs && re > slotStartMs;
      }).length;
      if (overlapCount >= capacity) continue;

      const startDate = new Date(slotStartMs);
      slots.push({ start_at: startDate.toISOString(), label: formatBangkokHM(startDate) });
    }
  }
  return { slots };
}
