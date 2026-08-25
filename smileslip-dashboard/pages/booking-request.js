import { useState, useEffect, useMemo } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { Calendar, Clock, User, CheckCircle2, Loader2, ChevronLeft } from 'lucide-react';

// หน้าจองคิว/นัดหมายสำหรับลูกค้า — สาธารณะ ไม่ต้อง login (ร้านแชร์ลิงก์ /booking-request?shopId=xxx
// ให้ลูกค้าเอง — คัดลอกได้จากหน้า /booking ของเจ้าของร้าน) ส่งเข้าเป็นแถว booking_reservations
// สถานะ 'pending' เสมอ — ล็อกช่วงเวลานั้นทันทีกันจองซ้ำ แต่ต้องรอร้านยืนยันก่อนถึงจะสมบูรณ์
export default function BookingRequestPage() {
  const router = useRouter();
  const { shopId } = router.query;

  const [loading, setLoading] = useState(true);
  const [info, setInfo] = useState(null);
  const [step, setStep] = useState('service'); // service | provider | datetime | details | done
  const [service, setService] = useState(null);
  const [provider, setProvider] = useState(null);
  const [date, setDate] = useState('');
  const [slots, setSlots] = useState([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState('');
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [form, setForm] = useState({ name: '', phone: '', notes: '' });
  const [ackPolicy, setAckPolicy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [doneInfo, setDoneInfo] = useState(null);

  useEffect(() => {
    if (!shopId) return;
    (async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/booking/public-info?shopId=${shopId}`);
        const d = await r.json();
        setInfo(d);
      } catch {}
      setLoading(false);
    })();
  }, [shopId]);

  const todayStr = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);
  const maxDateStr = useMemo(() => {
    if (!info) return '';
    const d = new Date();
    d.setDate(d.getDate() + (info.advance_booking_days ?? 30));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, [info]);

  function pickService(s) {
    setService(s);
    setProvider(null);
    setDate(''); setSlots([]); setSelectedSlot(null);
    setStep(s.requires_staff_selection ? 'provider' : 'datetime');
  }

  function pickProvider(p) {
    setProvider(p);
    setDate(''); setSlots([]); setSelectedSlot(null);
    setStep('datetime');
  }

  async function loadSlots(d) {
    setDate(d);
    setSelectedSlot(null);
    setSlots([]);
    setSlotsError('');
    if (!d) return;
    setSlotsLoading(true);
    try {
      const params = new URLSearchParams({ shopId, serviceId: service.id, date: d });
      if (provider) params.set('providerId', provider.id);
      const r = await fetch(`/api/booking/availability?${params}`);
      const dd = await r.json();
      if (dd.error) setSlotsError(dd.error);
      else setSlots(dd.slots || []);
    } catch {
      setSlotsError('โหลดช่วงเวลาไม่สำเร็จ กรุณาลองใหม่');
    }
    setSlotsLoading(false);
  }

  async function submit() {
    if (!form.name.trim() || !form.phone.trim()) { setSubmitError('กรุณากรอกชื่อและเบอร์โทรให้ครบ'); return; }
    if (!ackPolicy) { setSubmitError('กรุณายืนยันว่ารับทราบเงื่อนไขการยกเลิก/เบี้ยวนัดก่อน'); return; }
    setSubmitting(true); setSubmitError('');
    try {
      const r = await fetch('/api/booking/reserve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopId, serviceId: service.id, providerId: provider?.id || '',
          start_at: selectedSlot.start_at,
          customer_name: form.name.trim(), customer_phone: form.phone.trim(), notes: form.notes.trim(),
        }),
      });
      const d = await r.json();
      if (d.ok) {
        setDoneInfo(d);
        setStep('done');
      } else {
        setSubmitError(d.error || 'ระบบไม่พร้อมใช้งานขณะนี้');
        if (r.status === 409) { setSelectedSlot(null); loadSlots(date); } // ช่องถูกจองไปแล้ว รีเฟรชให้เห็นสดๆ
      }
    } catch {
      setSubmitError('เกิดข้อผิดพลาด กรุณาลองใหม่');
    }
    setSubmitting(false);
  }

  if (!shopId) return null;

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="animate-spin text-violet-600" size={32} />
      </div>
    );
  }

  if (!info?.accepting_bookings) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-3xl border border-slate-200 p-8 max-w-sm w-full text-center">
          <div className="text-4xl mb-3">🗓️</div>
          <h1 className="font-black text-slate-800 mb-2">ร้านนี้ยังไม่เปิดรับจองในขณะนี้</h1>
          <p className="text-slate-500 text-sm">กรุณาติดต่อร้านค้าโดยตรงสำหรับการนัดหมาย</p>
        </div>
      </div>
    );
  }

  const providers = (info.providers || []).filter(p =>
    !service?.branch_name || !p.branch_name || p.branch_name === service.branch_name
  );

  return (
    <>
      <Head><title>จองคิว/นัดหมาย — {info.shop_name || 'ร้านค้า'}</title></Head>
      <div className="min-h-screen bg-slate-50 pb-10">
        <header className="bg-white border-b border-slate-200 px-4 py-4 sticky top-0 z-10">
          <h1 className="font-black text-slate-800">{info.shop_name || 'ร้านค้า'}</h1>
          <p className="text-slate-400 text-xs">จองคิว/นัดหมายออนไลน์</p>
        </header>

        <div className="max-w-lg mx-auto p-4 space-y-4">

          {step !== 'service' && step !== 'done' && (
            <button
              onClick={() => {
                if (step === 'provider') setStep('service');
                else if (step === 'datetime') setStep(service.requires_staff_selection ? 'provider' : 'service');
                else if (step === 'details') setStep('datetime');
              }}
              className="text-slate-400 hover:text-slate-600 text-sm flex items-center gap-1"
            >
              <ChevronLeft size={14} /> ย้อนกลับ
            </button>
          )}

          {step === 'service' && (
            <div className="space-y-2">
              <h2 className="font-bold text-slate-700 text-sm mb-1">เลือกบริการที่ต้องการจอง</h2>
              {!info.services?.length ? (
                <div className="text-center text-slate-400 text-sm py-16">ร้านนี้ยังไม่มีบริการให้จองขณะนี้</div>
              ) : info.services.map(s => (
                <button key={s.id} onClick={() => pickService(s)}
                  className="w-full text-left bg-white rounded-2xl border border-slate-200 p-4 hover:border-violet-300 transition-colors">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-bold text-slate-800 text-sm">{s.name}</div>
                      {s.description && <div className="text-slate-400 text-xs mt-0.5 line-clamp-2">{s.description}</div>}
                      <div className="text-slate-400 text-xs mt-1 flex items-center gap-1"><Clock size={11} /> {s.duration_minutes} นาที</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-violet-700 font-black text-sm">฿{s.price.toLocaleString()}</div>
                      {s.deposit_required && (
                        <div className="text-amber-600 text-[10px] font-bold mt-0.5">
                          มัดจำ {s.deposit_type === 'fixed' ? `฿${s.deposit_value.toLocaleString()}` : `${s.deposit_value}%`}
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {step === 'provider' && (
            <div className="space-y-2">
              <h2 className="font-bold text-slate-700 text-sm mb-1">เลือกพนักงาน/ผู้ให้บริการ — {service.name}</h2>
              {!providers.length ? (
                <div className="text-center text-slate-400 text-sm py-16">ยังไม่มีพนักงานเปิดให้เลือกสำหรับบริการนี้</div>
              ) : providers.map(p => (
                <button key={p.id} onClick={() => pickProvider(p)}
                  className="w-full text-left bg-white rounded-2xl border border-slate-200 p-4 hover:border-violet-300 transition-colors flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-violet-100 text-violet-600 flex items-center justify-center shrink-0"><User size={16} /></div>
                  <div className="font-bold text-slate-800 text-sm">{p.name}</div>
                </button>
              ))}
            </div>
          )}

          {step === 'datetime' && (
            <div className="space-y-4">
              <div className="bg-white rounded-2xl border border-slate-200 p-4">
                <div className="text-xs text-slate-400 mb-1">บริการที่เลือก</div>
                <div className="font-bold text-slate-800 text-sm">{service.name}{provider ? ` · ${provider.name}` : ''}</div>
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 block flex items-center gap-1">
                  <Calendar size={11} /> เลือกวันที่
                </label>
                <input type="date" value={date} min={todayStr} max={maxDateStr}
                  onChange={e => loadSlots(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-violet-400" />
              </div>

              {date && (
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 block flex items-center gap-1">
                    <Clock size={11} /> เลือกเวลา
                  </label>
                  {slotsLoading ? (
                    <div className="text-center py-6"><Loader2 className="animate-spin text-violet-600 mx-auto" size={22} /></div>
                  ) : slotsError ? (
                    <div className="text-red-500 text-sm text-center py-4">{slotsError}</div>
                  ) : !slots.length ? (
                    <div className="text-slate-400 text-sm text-center py-6">วันนี้ไม่มีช่วงเวลาว่างแล้ว ลองเลือกวันอื่นดูนะ</div>
                  ) : (
                    <div className="grid grid-cols-3 gap-2">
                      {slots.map(s => (
                        <button key={s.start_at} onClick={() => setSelectedSlot(s)}
                          className={`py-2.5 rounded-xl text-sm font-bold border transition-colors ${
                            selectedSlot?.start_at === s.start_at
                              ? 'bg-violet-600 border-violet-600 text-white'
                              : 'bg-white border-slate-200 text-slate-700 hover:border-violet-300'
                          }`}>
                          {s.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {selectedSlot && (
                <button onClick={() => setStep('details')}
                  className="w-full bg-violet-700 hover:bg-violet-800 text-white font-black py-3.5 rounded-2xl transition-colors">
                  ถัดไป — กรอกข้อมูลติดต่อ
                </button>
              )}
            </div>
          )}

          {step === 'details' && (
            <div className="space-y-4">
              <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-1">
                <div className="text-xs text-slate-400">สรุปการจอง</div>
                <div className="font-bold text-slate-800 text-sm">{service.name}{provider ? ` · ${provider.name}` : ''}</div>
                <div className="text-slate-500 text-xs">{formatThaiDate(date)} · {selectedSlot.label} น. ({service.duration_minutes} นาที)</div>
                <div className="flex justify-between items-center pt-2 mt-1 border-t border-slate-100">
                  <span className="text-slate-500 text-xs">ยอดรวม</span>
                  <span className="font-black text-slate-800">฿{service.price.toLocaleString()}</span>
                </div>
                {service.deposit_required && (
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-amber-600">ต้องมัดจำ</span>
                    <span className="font-bold text-amber-600">฿{depositAmountOf(service).toLocaleString()}</span>
                  </div>
                )}
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
                <h2 className="font-bold text-slate-700 text-sm">📋 ข้อมูลผู้จอง</h2>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 block">ชื่อ-นามสกุล *</label>
                  <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-violet-400" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 block">เบอร์โทร *</label>
                  <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-violet-400" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 block">หมายเหตุ (ถ้ามี)</label>
                  <textarea value={form.notes} rows={2} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-violet-400 resize-none" />
                </div>
              </div>

              <PolicyBox info={info} />

              <label className="flex items-start gap-2 text-xs text-slate-600 px-1">
                <input type="checkbox" checked={ackPolicy} onChange={e => setAckPolicy(e.target.checked)} className="mt-0.5" />
                <span>ฉันรับทราบเงื่อนไขการยกเลิก/เบี้ยวนัดของร้านแล้ว</span>
              </label>

              {submitError && <div className="text-red-500 text-sm text-center">{submitError}</div>}

              <button onClick={submit} disabled={submitting}
                className="w-full bg-violet-700 hover:bg-violet-800 disabled:opacity-50 text-white font-black py-3.5 rounded-2xl transition-colors flex items-center justify-center gap-2">
                {submitting ? <Loader2 className="animate-spin" size={18} /> : <CheckCircle2 size={18} />}
                ยืนยันการจอง
              </button>
            </div>
          )}

          {step === 'done' && doneInfo && (
            <div className="bg-white rounded-3xl border border-slate-200 p-6 text-center space-y-3">
              <div className="text-5xl">✅</div>
              <h1 className="font-black text-slate-800 text-lg">บันทึกการจองแล้ว</h1>
              <p className="text-slate-500 text-sm">รหัสการจอง <span className="font-bold text-slate-700">{doneInfo.booking_no}</span></p>
              <div className="bg-slate-50 rounded-2xl p-4 text-left space-y-1 text-sm">
                <div className="font-bold text-slate-800">{doneInfo.service_name}{doneInfo.provider_name ? ` · ${doneInfo.provider_name}` : ''}</div>
                <div className="text-slate-500 text-xs">{formatThaiDateTime(doneInfo.start_at)}</div>
                <div className="text-slate-500 text-xs">ยอดบริการ ฿{doneInfo.price.toLocaleString()}</div>
              </div>
              {doneInfo.deposit_required_amount > 0 ? (
                <p className="text-amber-600 text-xs bg-amber-50 rounded-xl p-3">
                  บริการนี้ต้องมัดจำ ฿{doneInfo.deposit_required_amount.toLocaleString()} — ทางร้านจะติดต่อกลับเพื่อแจ้งช่องทางชำระมัดจำและยืนยันคิวให้เร็วที่สุด
                </p>
              ) : (
                <p className="text-slate-500 text-xs bg-slate-50 rounded-xl p-3">
                  ทางร้านจะติดต่อกลับเพื่อยืนยันคิวเร็วๆ นี้
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function depositAmountOf(service) {
  if (!service?.deposit_required) return 0;
  if (service.deposit_type === 'fixed') return Math.max(0, Number(service.deposit_value) || 0);
  const pct = Math.max(0, Math.min(100, Number(service.deposit_value) || 0));
  return Math.round(((Number(service.price) || 0) * pct) / 100 * 100) / 100;
}

function formatThaiDate(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  const days = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `วัน${days[dow]}ที่ ${d}/${m}/${y + 543}`;
}

function formatThaiDateTime(iso) {
  const d = new Date(iso);
  const bkk = new Date(d.getTime() + 7 * 3600 * 1000);
  const y = bkk.getUTCFullYear(), m = bkk.getUTCMonth() + 1, dd = bkk.getUTCDate();
  const hh = String(bkk.getUTCHours()).padStart(2, '0'), mm = String(bkk.getUTCMinutes()).padStart(2, '0');
  return `${formatThaiDate(`${y}-${String(m).padStart(2, '0')}-${String(dd).padStart(2, '0')}`)} เวลา ${hh}:${mm} น.`;
}

function PolicyBox({ info }) {
  const tiers = (info.cancellation_tiers || []).slice().sort((a, b) => b.min_days_before - a.min_days_before);
  if (!tiers.length && !info.cancellation_policy_text && !info.no_show_refund_pct) return null;
  return (
    <div className="bg-slate-50 rounded-2xl border border-slate-200 p-4 text-xs text-slate-600 space-y-2">
      <div className="font-bold text-slate-700">📌 เงื่อนไขการยกเลิก/เบี้ยวนัด</div>
      {tiers.length > 0 && (
        <ul className="space-y-0.5 list-disc list-inside">
          {tiers.map((t, i) => (
            <li key={i}>ยกเลิกล่วงหน้าอย่างน้อย {t.min_days_before} วัน — คืนเงินมัดจำ {t.refund_pct}%</li>
          ))}
        </ul>
      )}
      <div>เบี้ยวนัด (ไม่แจ้งล่วงหน้าเลย) — คืนเงินมัดจำ {info.no_show_refund_pct ?? 0}%</div>
      {info.cancellation_policy_text && <div className="whitespace-pre-wrap pt-1 border-t border-slate-200">{info.cancellation_policy_text}</div>}
    </div>
  );
}
