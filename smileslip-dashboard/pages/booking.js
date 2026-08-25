/**
 * /booking — ระบบจองคิว/นัดหมาย (ร้านนวด/คอร์สเรียน ฯลฯ) — Phase 1: หน้าตั้งค่า (เจ้าของร้าน)
 * โมดูลแยกอิสระจาก POS/Delivery — Supabase ล้วน ไม่พึ่ง Google Drive/Sheets เลย
 */
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { findOwnerSessionTokenForOwnerId, getOwnerSessionToken } from '../lib/client-owner-session';

const DAYS = [['mon','จันทร์'],['tue','อังคาร'],['wed','พุธ'],['thu','พฤหัสบดี'],['fri','ศุกร์'],['sat','เสาร์'],['sun','อาทิตย์']];

function todayBangkokStr() {
  const d = new Date(Date.now() + 7 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
function formatBangkokTime(iso) {
  const d = new Date(new Date(iso).getTime() + 7 * 3600 * 1000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
function formatBangkokDateShort(iso) {
  const d = new Date(new Date(iso).getTime() + 7 * 3600 * 1000);
  return `${d.getUTCDate()}/${d.getUTCMonth() + 1}/${d.getUTCFullYear() + 543}`;
}
function shiftDateStr(dateStr, deltaDays) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dd = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return `${dd.getUTCFullYear()}-${String(dd.getUTCMonth() + 1).padStart(2, '0')}-${String(dd.getUTCDate()).padStart(2, '0')}`;
}

const STATUS_META = {
  pending:   { label: '🕐 รอยืนยัน',  cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  confirmed: { label: '✅ ยืนยันแล้ว', cls: 'bg-green-50 text-green-700 border-green-200' },
  cancelled: { label: '❌ ยกเลิก',    cls: 'bg-gray-100 text-gray-500 border-gray-200' },
  no_show:   { label: '🚫 เบี้ยวนัด',  cls: 'bg-red-50 text-red-600 border-red-200' },
  completed: { label: '🏁 เสร็จสิ้น', cls: 'bg-blue-50 text-blue-600 border-blue-200' },
};
const DEPOSIT_META = {
  pending:          { label: '💰 รอมัดจำ',         cls: 'bg-gray-100 text-gray-500' },
  not_required:     null,
  auto_confirmed:   { label: '🤖 มัดจำอัตโนมัติ',   cls: 'bg-green-50 text-green-600' },
  manual_confirmed: { label: '✋ ยืนยันมัดจำเอง',    cls: 'bg-green-50 text-green-600' },
  mismatch:         { label: '⚠️ ยอดมัดจำไม่ตรง',   cls: 'bg-red-50 text-red-600' },
};

export default function BookingPage() {
  const router = useRouter();
  const { userId } = router.query;

  const [shopId, setShopId] = useState(null);
  const [shopName, setShopName] = useState('');
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('calendar');

  const [configured, setConfigured] = useState(false);
  const [settingUp, setSettingUp] = useState(false);
  const [setupError, setSetupError] = useState('');

  const [toast, setToast] = useState('');
  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  // ── ตั้งค่าทั่วไป ──
  const [config, setConfig] = useState(null);
  const [savingConfig, setSavingConfig] = useState(false);

  // ── บริการ ──
  const [services, setServices] = useState([]);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [editingService, setEditingService] = useState(null); // null = ไม่ได้เปิดฟอร์ม, {} = สร้างใหม่, {...} = แก้ไข
  const [savingService, setSavingService] = useState(false);
  const [serviceError, setServiceError] = useState('');

  // ── พนักงาน/ผู้ให้บริการ ──
  const [providers, setProviders] = useState([]);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [newProviderName, setNewProviderName] = useState('');
  const [newProviderBranch, setNewProviderBranch] = useState('');
  const [savingProvider, setSavingProvider] = useState(false);

  // ── ปฏิทิน/จัดการคิว (Phase 4) ──
  const [calendarView, setCalendarView] = useState('day'); // day | mismatch
  const [calendarDate, setCalendarDate] = useState(todayBangkokStr());
  const [reservations, setReservations] = useState([]);
  const [reservationsLoading, setReservationsLoading] = useState(false);
  const [actingBookingNo, setActingBookingNo] = useState(null);

  function authHeaders() {
    const token = getOwnerSessionToken(shopId);
    return token ? { 'x-owner-session': token } : {};
  }

  // ── โหลดข้อมูลร้าน + เช็ค setup ──
  useEffect(() => {
    if (!userId) return;
    (async () => {
      const dataToken = findOwnerSessionTokenForOwnerId(userId);
      const shopRes = await fetch(`/api/shop/data?userId=${userId}`,
        dataToken ? { headers: { 'x-owner-session': dataToken } } : undefined
      ).then(r => r.json()).catch(() => ({}));
      if (shopRes.profile) {
        const sid = shopRes.profile.id;
        setShopId(sid);
        setShopName(shopRes.profile.shop_name);

        const branchRes = await fetch(`/api/shop/branches?shopId=${sid}`).then(r => r.json()).catch(() => ({}));
        if (branchRes.branches) setBranches(branchRes.branches.filter(b => b.is_active));

        const token = getOwnerSessionToken(sid);
        const s = await fetch(`/api/booking/setup?shopId=${sid}`, { headers: token ? { 'x-owner-session': token } : {} })
          .then(r => r.json()).catch(() => ({}));
        setConfigured(!!s.configured);
      }
      setLoading(false);
    })();
  }, [userId]);

  const runSetup = async () => {
    setSettingUp(true);
    setSetupError('');
    const r = await fetch('/api/booking/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ shopId }),
    }).then(r => r.json()).catch(e => ({ error: e.message }));
    if (r.ok) setConfigured(true);
    else setSetupError(r.error || 'เกิดข้อผิดพลาด ลองใหม่อีกครั้ง');
    setSettingUp(false);
  };

  // ── โหลด config ──
  const loadConfig = useCallback(async () => {
    if (!shopId || !configured) return;
    const r = await fetch(`/api/booking/config?shopId=${shopId}`, { headers: authHeaders() }).then(r => r.json()).catch(() => ({}));
    if (r.config) setConfig(r.config);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId, configured]);

  useEffect(() => { if (tab === 'config') loadConfig(); }, [tab, loadConfig]);

  const saveConfig = async () => {
    setSavingConfig(true);
    const r = await fetch('/api/booking/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ shopId, ...config }),
    }).then(r => r.json()).catch(e => ({ error: e.message }));
    setSavingConfig(false);
    if (r.ok) showToast('✅ บันทึกตั้งค่าแล้ว');
    else showToast('❌ ' + (r.error || 'บันทึกไม่สำเร็จ'));
  };

  function setDayOpen(dayKey, open) {
    setConfig(c => {
      const hours = { ...(c.business_hours || {}) };
      if (open) hours[dayKey] = hours[dayKey]?.length ? hours[dayKey] : [{ start: '09:00', end: '18:00' }];
      else delete hours[dayKey];
      return { ...c, business_hours: hours };
    });
  }
  function setDayTime(dayKey, field, value) {
    setConfig(c => {
      const hours = { ...(c.business_hours || {}) };
      const range = hours[dayKey]?.[0] || { start: '09:00', end: '18:00' };
      hours[dayKey] = [{ ...range, [field]: value }];
      return { ...c, business_hours: hours };
    });
  }
  function addTier() {
    setConfig(c => ({ ...c, cancellation_tiers: [...(c.cancellation_tiers || []), { min_days_before: 0, refund_pct: 0 }] }));
  }
  function updateTier(idx, field, value) {
    setConfig(c => {
      const tiers = [...(c.cancellation_tiers || [])];
      tiers[idx] = { ...tiers[idx], [field]: Number(value) || 0 };
      return { ...c, cancellation_tiers: tiers };
    });
  }
  function removeTier(idx) {
    setConfig(c => ({ ...c, cancellation_tiers: (c.cancellation_tiers || []).filter((_, i) => i !== idx) }));
  }

  // ── โหลดบริการ ──
  const loadServices = useCallback(async () => {
    if (!shopId || !configured) return;
    setServicesLoading(true);
    const r = await fetch(`/api/booking/services?shopId=${shopId}`, { headers: authHeaders() }).then(r => r.json()).catch(() => ({}));
    setServices(r.services || []);
    setServicesLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId, configured]);

  useEffect(() => { if (tab === 'services') loadServices(); }, [tab, loadServices]);

  function emptyServiceForm() {
    return {
      name: '', description: '', duration_minutes: 60, price: '',
      requires_staff_selection: false, deposit_required: false,
      deposit_type: 'percent', deposit_value: '', max_concurrent: 1, branch_name: '',
    };
  }

  const saveService = async () => {
    setServiceError('');
    const isEdit = !!editingService.id;
    const payload = { shopId, ...editingService };
    setSavingService(true);
    const r = await fetch('/api/booking/services', {
      method: isEdit ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(payload),
    }).then(r => r.json()).catch(e => ({ error: e.message }));
    setSavingService(false);
    if (r.ok) {
      showToast(isEdit ? '✅ แก้ไขบริการแล้ว' : '✅ เพิ่มบริการแล้ว');
      setEditingService(null);
      loadServices();
    } else {
      setServiceError(r.error || 'บันทึกไม่สำเร็จ');
    }
  };

  const deleteService = async (id) => {
    if (!confirm('ลบบริการนี้? (ลบแล้วซ่อนจากรายการ ไม่กระทบประวัติการจองเดิม)')) return;
    const r = await fetch('/api/booking/services', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ shopId, id }),
    }).then(r => r.json()).catch(e => ({ error: e.message }));
    if (r.ok) { showToast('🗑️ ลบบริการแล้ว'); loadServices(); }
    else showToast('❌ ' + (r.error || 'ลบไม่สำเร็จ'));
  };

  const toggleServiceActive = async (svc) => {
    await fetch('/api/booking/services', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ shopId, id: svc.id, is_active: !svc.is_active }),
    }).then(r => r.json()).catch(() => ({}));
    loadServices();
  };

  // ── โหลดพนักงาน/ผู้ให้บริการ ──
  const loadProviders = useCallback(async () => {
    if (!shopId || !configured) return;
    setProvidersLoading(true);
    const r = await fetch(`/api/booking/providers?shopId=${shopId}`, { headers: authHeaders() }).then(r => r.json()).catch(() => ({}));
    setProviders(r.providers || []);
    setProvidersLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId, configured]);

  useEffect(() => { if (tab === 'providers') loadProviders(); }, [tab, loadProviders]);

  const addProvider = async () => {
    if (!newProviderName.trim()) return;
    setSavingProvider(true);
    const r = await fetch('/api/booking/providers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ shopId, name: newProviderName.trim(), branch_name: newProviderBranch }),
    }).then(r => r.json()).catch(e => ({ error: e.message }));
    setSavingProvider(false);
    if (r.ok) { setNewProviderName(''); setNewProviderBranch(''); showToast('✅ เพิ่มแล้ว'); loadProviders(); }
    else showToast('❌ ' + (r.error || 'บันทึกไม่สำเร็จ'));
  };

  const toggleProviderActive = async (p) => {
    await fetch('/api/booking/providers', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ shopId, id: p.id, is_active: !p.is_active }),
    }).then(r => r.json()).catch(() => ({}));
    loadProviders();
  };

  const deleteProvider = async (id) => {
    if (!confirm('ลบรายชื่อนี้?')) return;
    const r = await fetch('/api/booking/providers', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ shopId, id }),
    }).then(r => r.json()).catch(e => ({ error: e.message }));
    if (r.ok) { showToast('🗑️ ลบแล้ว'); loadProviders(); }
    else showToast('❌ ' + (r.error || 'ลบไม่สำเร็จ'));
  };

  // ── โหลด/จัดการคิว (Phase 4) ──
  const loadReservations = useCallback(async () => {
    if (!shopId || !configured) return;
    setReservationsLoading(true);
    const params = new URLSearchParams({ shopId });
    if (calendarView === 'mismatch') params.set('depositStatus', 'mismatch');
    else params.set('date', calendarDate);
    const r = await fetch(`/api/booking/reservations?${params}`, { headers: authHeaders() }).then(r => r.json()).catch(() => ({}));
    setReservations(r.reservations || []);
    setReservationsLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId, configured, calendarView, calendarDate]);

  useEffect(() => { if (tab === 'calendar') loadReservations(); }, [tab, loadReservations]);

  const ACTION_LABEL = { confirm: '✅ ยืนยันแล้ว', cancel: '❌ ยกเลิกแล้ว', no_show: '🚫 บันทึกเบี้ยวนัดแล้ว', complete: '🏁 บันทึกเสร็จสิ้นแล้ว' };
  const ACTION_CONFIRM_MSG = {
    confirm: null,
    cancel: 'ยืนยันยกเลิกรายการนี้? ระบบจะคำนวณ % คืนเงินมัดจำตามนโยบายที่ตั้งไว้ให้อัตโนมัติ',
    no_show: 'บันทึกว่าลูกค้ารายนี้เบี้ยวนัด (ไม่มาตามนัด)? ระบบจะคำนวณ % คืนเงินมัดจำตามนโยบายเบี้ยวนัดที่ตั้งไว้',
    complete: null,
  };
  async function doReservationAction(booking_no, action) {
    const confirmMsg = ACTION_CONFIRM_MSG[action];
    if (confirmMsg && !confirm(confirmMsg)) return;
    setActingBookingNo(booking_no);
    const r = await fetch('/api/booking/reservations', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ shopId, booking_no, action }),
    }).then(r => r.json()).catch(e => ({ error: e.message }));
    setActingBookingNo(null);
    if (r.ok) {
      let msg = ACTION_LABEL[action] || '✅ ทำรายการแล้ว';
      if (r.cancel_refund_pct != null) msg += ` (คืนเงินมัดจำ ${r.cancel_refund_pct}%)`;
      showToast(msg);
      loadReservations();
    } else showToast('❌ ' + (r.error || 'ทำรายการไม่สำเร็จ'));
  }

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <p className="text-gray-400 text-sm">กำลังโหลด...</p>
    </div>
  );

  // ── Setup Screen ──
  if (!configured) return (
    <>
      <Head><title>เปิดใช้งานระบบจอง — Smile Slip</title></Head>
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <div className="bg-blue-900 text-white px-4 py-3 flex items-center gap-3">
          <button onClick={() => router.push(`/dashboard?userId=${userId}`)} className="text-white/70 hover:text-white text-lg">←</button>
          <p className="font-bold text-sm">📅 ระบบจองคิว/นัดหมาย</p>
        </div>
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-sm w-full text-center space-y-5">
            <div className="text-6xl">📅</div>
            <h1 className="text-xl font-bold text-gray-900">ระบบจองคิว/นัดหมาย</h1>
            <p className="text-sm text-gray-500 leading-relaxed">
              สำหรับร้านนวด, คอร์สเรียน, สนามยิงปืน ฯลฯ — ลูกค้าจองช่วงเวลาเอง พร้อมระบบมัดจำ
            </p>
            {setupError && (
              <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-xl p-3">{setupError}</p>
            )}
            <button onClick={runSetup} disabled={settingUp}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-3.5 rounded-xl font-bold text-base transition-colors shadow-lg">
              {settingUp ? 'กำลังเปิดใช้งาน...' : '🚀 เปิดใช้งานระบบจอง'}
            </button>
          </div>
        </div>
      </div>
    </>
  );

  return (
    <>
      <Head><title>ระบบจอง — {shopName}</title></Head>
      <div className="min-h-screen bg-gray-50 flex flex-col">

        {toast && (
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white text-sm font-medium px-4 py-2.5 rounded-xl shadow-lg">
            {toast}
          </div>
        )}

        <div className="bg-blue-900 text-white px-4 py-3 flex items-center gap-3 sticky top-0 z-40 shadow-lg">
          <button onClick={() => router.push(`/dashboard?userId=${userId}`)} className="text-white/70 hover:text-white text-lg">←</button>
          <div className="flex-1">
            <p className="font-bold text-sm">📅 ระบบจอง</p>
            <p className="text-xs text-white/60">{shopName}</p>
          </div>
        </div>

        <div className="bg-white border-b flex sticky top-14 z-30 shadow-sm">
          {[['calendar','📅 ปฏิทิน'],['config','⚙️ ตั้งค่าทั่วไป'],['services','🧾 บริการ'],['providers','🧑‍💼 พนักงาน']].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`flex-1 px-2 sm:px-5 py-3 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                tab === k ? 'border-blue-600 text-blue-600 bg-blue-50' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}>
              {l}
            </button>
          ))}
        </div>

        <div className="flex-1 max-w-2xl mx-auto w-full p-4 pb-16">

          {/* ═══ ปฏิทิน/จัดการคิว (Phase 4) ═══ */}
          {tab === 'calendar' && (
            <div className="space-y-4">
              <div className="flex gap-2">
                <button onClick={() => setCalendarView('day')}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-bold border transition-colors ${
                    calendarView === 'day' ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-200 text-gray-600'
                  }`}>
                  📅 รายวัน
                </button>
                <button onClick={() => setCalendarView('mismatch')}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-bold border transition-colors ${
                    calendarView === 'mismatch' ? 'bg-red-600 border-red-600 text-white' : 'bg-white border-gray-200 text-gray-600'
                  }`}>
                  🚩 รอตรวจสอบมัดจำ
                </button>
              </div>

              {calendarView === 'day' && (
                <div className="flex items-center gap-2">
                  <button onClick={() => setCalendarDate(d => shiftDateStr(d, -1))} className="w-9 h-9 rounded-xl bg-white border border-gray-200 text-gray-500 flex items-center justify-center shrink-0">‹</button>
                  <input type="date" value={calendarDate} onChange={e => setCalendarDate(e.target.value)}
                    className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white" />
                  <button onClick={() => setCalendarDate(d => shiftDateStr(d, 1))} className="w-9 h-9 rounded-xl bg-white border border-gray-200 text-gray-500 flex items-center justify-center shrink-0">›</button>
                  <button onClick={() => setCalendarDate(todayBangkokStr())} className="shrink-0 text-xs font-bold text-blue-600 px-2">วันนี้</button>
                </div>
              )}

              {reservationsLoading ? (
                <p className="text-center text-gray-400 text-sm py-10">กำลังโหลด...</p>
              ) : !reservations.length ? (
                <p className="text-center text-gray-400 text-sm py-10">
                  {calendarView === 'mismatch' ? 'ไม่มีรายการรอตรวจสอบมัดจำ 🎉' : 'ไม่มีการจองในวันนี้'}
                </p>
              ) : (
                <div className="space-y-3">
                  {reservations.map(res => {
                    const hasStarted = new Date(res.start_at) <= new Date();
                    const statusMeta = STATUS_META[res.status] || STATUS_META.pending;
                    const depositMeta = res.deposit_required_amount > 0 ? DEPOSIT_META[res.deposit_status] : null;
                    const acting = actingBookingNo === res.booking_no;
                    return (
                      <div key={res.booking_no} className="bg-white rounded-2xl border p-4 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="font-bold text-gray-900 text-sm">
                              {calendarView === 'mismatch' ? formatBangkokDateShort(res.start_at) + ' · ' : ''}{formatBangkokTime(res.start_at)} น. — {res.service_name}{res.provider_name ? ` · ${res.provider_name}` : ''}
                            </div>
                            <div className="text-gray-500 text-xs mt-0.5">{res.customer_name} · {res.customer_phone}</div>
                          </div>
                          <span className={`shrink-0 text-[10px] font-bold px-2 py-1 rounded-full border ${statusMeta.cls}`}>{statusMeta.label}</span>
                        </div>

                        <div className="flex items-center gap-2 flex-wrap text-xs">
                          <span className="text-gray-400">฿{res.price.toLocaleString()}</span>
                          {depositMeta && (
                            <span className={`font-bold px-2 py-0.5 rounded-full ${depositMeta.cls}`}>
                              {depositMeta.label}{res.deposit_status === 'mismatch' ? ` (อ่านได้ ฿${res.deposit_verified_amount ?? '-'} / ต้อง ฿${res.deposit_required_amount})` : ''}
                            </span>
                          )}
                          {res.deposit_slip_url && (
                            <a href={res.deposit_slip_url} target="_blank" rel="noreferrer" className="text-blue-600 font-bold underline">🖼️ ดูสลิป</a>
                          )}
                          {res.cancel_refund_pct != null && (
                            <span className="text-gray-400">คืนเงินมัดจำ {res.cancel_refund_pct}%</span>
                          )}
                        </div>
                        {res.notes && <div className="text-gray-400 text-xs">📝 {res.notes}</div>}

                        {['pending', 'confirmed'].includes(res.status) && (
                          <div className="flex gap-2 pt-1 flex-wrap">
                            {res.status === 'pending' && (
                              <button disabled={acting} onClick={() => doReservationAction(res.booking_no, 'confirm')}
                                className="text-xs font-bold px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white">✅ ยืนยัน</button>
                            )}
                            {res.status === 'confirmed' && hasStarted && (
                              <button disabled={acting} onClick={() => doReservationAction(res.booking_no, 'complete')}
                                className="text-xs font-bold px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white">🏁 เสร็จสิ้น</button>
                            )}
                            {res.status === 'confirmed' && hasStarted && (
                              <button disabled={acting} onClick={() => doReservationAction(res.booking_no, 'no_show')}
                                className="text-xs font-bold px-3 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 disabled:opacity-50 text-red-600 border border-red-200">🚫 ไม่มาตามนัด</button>
                            )}
                            <button disabled={acting} onClick={() => doReservationAction(res.booking_no, 'cancel')}
                              className="text-xs font-bold px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-600">❌ ยกเลิก</button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ═══ ตั้งค่าทั่วไป ═══ */}
          {tab === 'config' && config && (
            <div className="space-y-5">
              <div className="bg-white rounded-2xl border p-5">
                <h3 className="font-bold text-sm text-gray-900 mb-1">🔗 ลิงก์จองสำหรับลูกค้า</h3>
                <p className="text-gray-500 text-xs mb-3">
                  แชร์ลิงก์นี้ให้ลูกค้าเพื่อเลือกบริการ/วันเวลาจองเองได้ (ไม่ต้อง login) — การจองที่เข้ามาจะรอให้ร้านยืนยันก่อนเสมอ ไม่กลายเป็นคิวจริงทันที
                </p>
                <div className="flex items-center gap-2">
                  <input readOnly value={typeof window !== 'undefined' ? `${window.location.origin}/booking-request?shopId=${shopId}` : ''}
                    className="flex-1 bg-white text-gray-700 text-xs px-3 py-2.5 rounded-xl border border-gray-200 truncate" />
                  <button onClick={() => {
                    navigator.clipboard.writeText(`${window.location.origin}/booking-request?shopId=${shopId}`);
                    showToast('คัดลอกลิงก์แล้ว');
                  }} className="shrink-0 bg-blue-700 hover:bg-blue-600 text-white text-xs font-bold px-4 py-2.5 rounded-xl transition-colors">
                    📋 คัดลอก
                  </button>
                </div>
              </div>

              <div className="bg-white rounded-2xl border p-5">
                <h2 className="font-bold text-sm text-gray-900 mb-4">🕐 เวลาเปิด-ปิดรับจอง</h2>
                <div className="space-y-2.5">
                  {DAYS.map(([key, label]) => {
                    const range = config.business_hours?.[key]?.[0];
                    const open = !!range;
                    return (
                      <div key={key} className="flex items-center gap-2.5">
                        <label className="flex items-center gap-2 w-24 shrink-0 cursor-pointer">
                          <input type="checkbox" checked={open} onChange={e => setDayOpen(key, e.target.checked)} className="w-4 h-4" />
                          <span className="text-sm text-gray-700">{label}</span>
                        </label>
                        {open ? (
                          <div className="flex items-center gap-1.5 text-sm">
                            <input type="time" value={range.start} onChange={e => setDayTime(key, 'start', e.target.value)}
                              className="border rounded-lg px-2 py-1 text-xs" />
                            <span className="text-gray-400">-</span>
                            <input type="time" value={range.end} onChange={e => setDayTime(key, 'end', e.target.value)}
                              className="border rounded-lg px-2 py-1 text-xs" />
                          </div>
                        ) : <span className="text-xs text-gray-400">ปิด</span>}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="bg-white rounded-2xl border p-5">
                <h2 className="font-bold text-sm text-gray-900 mb-3">📆 จองล่วงหน้าได้ไกลสุดกี่วัน</h2>
                <input type="number" min="1" value={config.advance_booking_days}
                  onChange={e => setConfig(c => ({ ...c, advance_booking_days: e.target.value }))}
                  className="w-full border rounded-xl px-3 py-2.5 text-sm" />
              </div>

              <div className="bg-white rounded-2xl border p-5">
                <h2 className="font-bold text-sm text-gray-900 mb-1">🚫 นโยบายเบี้ยวนัด/ยกเลิก</h2>
                <p className="text-xs text-gray-400 mb-3">ใช้คำนวณ % คืนเงินอัตโนมัติเวลาแอดมินกดยกเลิก/บันทึกไม่มาตามนัด</p>

                <label className="text-xs font-bold text-gray-500 block mb-1">เบี้ยวนัด (ไม่มาเลย ไม่แจ้งล่วงหน้า) — คืนเงินกี่%</label>
                <input type="number" min="0" max="100" value={config.no_show_refund_pct}
                  onChange={e => setConfig(c => ({ ...c, no_show_refund_pct: e.target.value }))}
                  className="w-full border rounded-xl px-3 py-2 text-sm mb-4" />

                <label className="text-xs font-bold text-gray-500 block mb-1.5">ยกเลิกล่วงหน้า — คืนเงินตามจำนวนวัน (เพิ่มได้กี่แถวก็ได้)</label>
                <div className="space-y-2 mb-2">
                  {(config.cancellation_tiers || []).map((t, i) => (
                    <div key={i} className="flex items-center gap-2 bg-gray-50 rounded-xl p-2.5">
                      <span className="text-xs text-gray-500 shrink-0">ยกเลิกก่อน ≥</span>
                      <input type="number" min="0" value={t.min_days_before} onChange={e => updateTier(i, 'min_days_before', e.target.value)}
                        className="w-16 border rounded-lg px-2 py-1 text-xs text-center" />
                      <span className="text-xs text-gray-500 shrink-0">วัน คืน</span>
                      <input type="number" min="0" max="100" value={t.refund_pct} onChange={e => updateTier(i, 'refund_pct', e.target.value)}
                        className="w-16 border rounded-lg px-2 py-1 text-xs text-center" />
                      <span className="text-xs text-gray-500 shrink-0">%</span>
                      <button onClick={() => removeTier(i)} className="ml-auto text-red-400 hover:text-red-600 text-xs">✕</button>
                    </div>
                  ))}
                </div>
                <button onClick={addTier} className="text-blue-600 hover:text-blue-700 text-xs font-bold">+ เพิ่มแถว</button>

                <label className="text-xs font-bold text-gray-500 block mt-4 mb-1">ข้อความเพิ่มเติม (โชว์ให้ลูกค้าเห็นตอนจอง)</label>
                <textarea rows={3} value={config.cancellation_policy_text}
                  onChange={e => setConfig(c => ({ ...c, cancellation_policy_text: e.target.value }))}
                  placeholder="เช่น กรณีพิเศษ/เงื่อนไขเฉพาะร้าน..."
                  className="w-full border rounded-xl px-3 py-2 text-sm" />
              </div>

              <div className="bg-white rounded-2xl border p-5">
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input type="checkbox" checked={config.line_reminder_enabled}
                    onChange={e => setConfig(c => ({ ...c, line_reminder_enabled: e.target.checked }))}
                    className="w-4 h-4" />
                  <span className="text-sm font-bold text-gray-800">📣 ชวนลูกค้าแอดไลน์ Smile Slip เพื่อรับแจ้งเตือนก่อนถึงนัด</span>
                </label>
              </div>

              <button onClick={saveConfig} disabled={savingConfig}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-3.5 rounded-xl font-bold text-sm transition-colors shadow-lg">
                {savingConfig ? 'กำลังบันทึก...' : '💾 บันทึกตั้งค่า'}
              </button>
            </div>
          )}

          {/* ═══ บริการ ═══ */}
          {tab === 'services' && (
            <div>
              <button onClick={() => { setEditingService(emptyServiceForm()); setServiceError(''); }}
                className="w-full mb-4 bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-xl font-bold text-sm shadow-lg">
                + เพิ่มบริการใหม่
              </button>

              {servicesLoading ? <p className="text-center text-gray-400 text-sm py-8">กำลังโหลด...</p> : (
                services.length === 0 ? (
                  <p className="text-center text-gray-400 text-sm py-8">ยังไม่มีบริการ — กดเพิ่มบริการใหม่ด้านบน</p>
                ) : (
                  <div className="space-y-2.5">
                    {services.map(svc => (
                      <div key={svc.id} className={`bg-white rounded-2xl border p-4 ${!svc.is_active ? 'opacity-50' : ''}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="font-bold text-sm text-gray-900">{svc.name}</p>
                            <p className="text-xs text-gray-500 mt-0.5">
                              ⏱ {svc.duration_minutes} นาที · ฿{svc.price.toLocaleString()}
                              {svc.max_concurrent > 1 && ` · รับพร้อมกัน ${svc.max_concurrent} คิว`}
                            </p>
                            <div className="flex flex-wrap gap-1.5 mt-2">
                              {svc.requires_staff_selection && <span className="text-[10px] bg-purple-50 text-purple-600 px-2 py-0.5 rounded-full">เลือกพนักงานได้</span>}
                              {svc.deposit_required && (
                                <span className="text-[10px] bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full">
                                  มัดจำ {svc.deposit_type === 'percent' ? `${svc.deposit_value}%` : `฿${svc.deposit_value}`}
                                </span>
                              )}
                              {svc.branch_name && <span className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{svc.branch_name}</span>}
                            </div>
                          </div>
                          <div className="flex flex-col gap-1 shrink-0">
                            <button onClick={() => { setEditingService(svc); setServiceError(''); }}
                              className="text-blue-600 hover:text-blue-700 text-xs font-bold">แก้ไข</button>
                            <button onClick={() => toggleServiceActive(svc)}
                              className="text-gray-500 hover:text-gray-700 text-xs">{svc.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}</button>
                            <button onClick={() => deleteService(svc.id)}
                              className="text-red-400 hover:text-red-600 text-xs">ลบ</button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              )}

              {editingService && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
                  <div className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-3xl p-5 max-h-[90vh] overflow-y-auto">
                    <h3 className="font-bold text-base text-gray-900 mb-4">{editingService.id ? 'แก้ไขบริการ' : 'เพิ่มบริการใหม่'}</h3>

                    {serviceError && <p className="text-red-600 text-xs bg-red-50 border border-red-200 rounded-lg p-2.5 mb-3">{serviceError}</p>}

                    <label className="text-xs font-bold text-gray-500 block mb-1">ชื่อบริการ *</label>
                    <input value={editingService.name} onChange={e => setEditingService(s => ({ ...s, name: e.target.value }))}
                      placeholder="เช่น นวดแผนไทย 60 นาที" className="w-full border rounded-xl px-3 py-2.5 text-sm mb-3" />

                    <label className="text-xs font-bold text-gray-500 block mb-1">คำอธิบาย</label>
                    <input value={editingService.description || ''} onChange={e => setEditingService(s => ({ ...s, description: e.target.value }))}
                      className="w-full border rounded-xl px-3 py-2.5 text-sm mb-3" />

                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <div>
                        <label className="text-xs font-bold text-gray-500 block mb-1">ระยะเวลา (นาที) *</label>
                        <input type="number" min="1" value={editingService.duration_minutes}
                          onChange={e => setEditingService(s => ({ ...s, duration_minutes: e.target.value }))}
                          className="w-full border rounded-xl px-3 py-2.5 text-sm" />
                      </div>
                      <div>
                        <label className="text-xs font-bold text-gray-500 block mb-1">ราคา (บาท) *</label>
                        <input type="number" min="0" value={editingService.price}
                          onChange={e => setEditingService(s => ({ ...s, price: e.target.value }))}
                          className="w-full border rounded-xl px-3 py-2.5 text-sm" />
                      </div>
                    </div>

                    <label className="text-xs font-bold text-gray-500 block mb-1">รับกี่คิวพร้อมกัน (เช่น จำนวนเตียง/เลน)</label>
                    <input type="number" min="1" value={editingService.max_concurrent}
                      onChange={e => setEditingService(s => ({ ...s, max_concurrent: e.target.value }))}
                      className="w-full border rounded-xl px-3 py-2.5 text-sm mb-3" />

                    {branches.length > 0 && (
                      <>
                        <label className="text-xs font-bold text-gray-500 block mb-1">สาขา (เว้นว่าง = ทุกสาขา)</label>
                        <select value={editingService.branch_name || ''} onChange={e => setEditingService(s => ({ ...s, branch_name: e.target.value }))}
                          className="w-full border rounded-xl px-3 py-2.5 text-sm mb-3">
                          <option value="">ทุกสาขา</option>
                          {branches.map(b => <option key={b.id} value={b.branch_name}>{b.branch_name}</option>)}
                        </select>
                      </>
                    )}

                    <label className="flex items-center gap-2.5 cursor-pointer mb-3 mt-1">
                      <input type="checkbox" checked={!!editingService.requires_staff_selection}
                        onChange={e => setEditingService(s => ({ ...s, requires_staff_selection: e.target.checked }))} className="w-4 h-4" />
                      <span className="text-sm text-gray-700">ให้ลูกค้าเลือกพนักงาน/ผู้ให้บริการได้</span>
                    </label>

                    <label className="flex items-center gap-2.5 cursor-pointer mb-2">
                      <input type="checkbox" checked={!!editingService.deposit_required}
                        onChange={e => setEditingService(s => ({ ...s, deposit_required: e.target.checked }))} className="w-4 h-4" />
                      <span className="text-sm text-gray-700">ต้องมัดจำก่อนถึงจะจองสำเร็จ</span>
                    </label>

                    {editingService.deposit_required && (
                      <div className="bg-amber-50 rounded-xl p-3 mb-3 space-y-2">
                        <div className="flex gap-2">
                          <label className="flex items-center gap-1.5 text-xs">
                            <input type="radio" checked={editingService.deposit_type === 'percent'}
                              onChange={() => setEditingService(s => ({ ...s, deposit_type: 'percent' }))} /> % ของราคา
                          </label>
                          <label className="flex items-center gap-1.5 text-xs">
                            <input type="radio" checked={editingService.deposit_type === 'fixed'}
                              onChange={() => setEditingService(s => ({ ...s, deposit_type: 'fixed' }))} /> จำนวนตายตัว (บาท)
                          </label>
                        </div>
                        <input type="number" min="0" value={editingService.deposit_value}
                          onChange={e => setEditingService(s => ({ ...s, deposit_value: e.target.value }))}
                          placeholder={editingService.deposit_type === 'percent' ? 'เช่น 50 (=50%)' : 'เช่น 200 (บาท)'}
                          className="w-full border rounded-xl px-3 py-2 text-sm" />
                      </div>
                    )}

                    <div className="flex gap-2 mt-4">
                      <button onClick={() => setEditingService(null)} className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-600 py-3 rounded-xl font-bold text-sm">ยกเลิก</button>
                      <button onClick={saveService} disabled={savingService}
                        className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-3 rounded-xl font-bold text-sm">
                        {savingService ? 'กำลังบันทึก...' : 'บันทึก'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ═══ พนักงาน/ผู้ให้บริการ ═══ */}
          {tab === 'providers' && (
            <div>
              <div className="bg-white rounded-2xl border p-4 mb-4">
                <p className="text-xs text-gray-400 mb-3">รายชื่อนี้แยกจากพนักงาน POS — ใช้เฉพาะระบบจอง ไม่จำเป็นต้องเปิด POS ก็ใช้ได้</p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input value={newProviderName} onChange={e => setNewProviderName(e.target.value)} placeholder="ชื่อพนักงาน/ผู้ให้บริการ"
                    className="flex-1 border rounded-xl px-3 py-2.5 text-sm" />
                  {branches.length > 0 && (
                    <select value={newProviderBranch} onChange={e => setNewProviderBranch(e.target.value)}
                      className="border rounded-xl px-3 py-2.5 text-sm">
                      <option value="">ทุกสาขา</option>
                      {branches.map(b => <option key={b.id} value={b.branch_name}>{b.branch_name}</option>)}
                    </select>
                  )}
                  <button onClick={addProvider} disabled={savingProvider || !newProviderName.trim()}
                    className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-xl font-bold text-sm shrink-0">
                    เพิ่ม
                  </button>
                </div>
              </div>

              {providersLoading ? <p className="text-center text-gray-400 text-sm py-8">กำลังโหลด...</p> : (
                providers.length === 0 ? (
                  <p className="text-center text-gray-400 text-sm py-8">ยังไม่มีรายชื่อ</p>
                ) : (
                  <div className="space-y-2">
                    {providers.map(p => (
                      <div key={p.id} className={`bg-white rounded-xl border p-3 flex items-center justify-between ${!p.is_active ? 'opacity-50' : ''}`}>
                        <div>
                          <p className="text-sm font-bold text-gray-900">{p.name}</p>
                          {p.branch_name && <p className="text-xs text-gray-400">{p.branch_name}</p>}
                        </div>
                        <div className="flex gap-3 shrink-0">
                          <button onClick={() => toggleProviderActive(p)} className="text-gray-500 hover:text-gray-700 text-xs">
                            {p.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                          </button>
                          <button onClick={() => deleteProvider(p.id)} className="text-red-400 hover:text-red-600 text-xs">ลบ</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
