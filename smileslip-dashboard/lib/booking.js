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
