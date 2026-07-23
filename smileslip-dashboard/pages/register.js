import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import axios from 'axios';
import Head from 'next/head';
import Link from 'next/link';
import {
  Store, Phone, MapPin, Mail, Lock, Eye, EyeOff,
  ChevronRight, CheckCircle2, MessageCircle, Building2,
  Hash, Landmark, ShieldCheck, AlertTriangle, Trash2, Plus, LogIn
} from 'lucide-react';
import { PROVINCES, DISTRICTS } from '../data/thailand-address';

const STEP_LABELS = ['ข้อมูลธุรกิจ', 'ที่อยู่ & ติดต่อ', 'ตั้งรหัสผ่าน'];

export default function Register() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [isReady, setIsReady] = useState(false);
  const [userType, setUserType] = useState('individual');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [termsScrolled, setTermsScrolled] = useState(false);

  const [formData, setFormData] = useState({
    shopName: '', taxId: '', branch: 'สำนักงานใหญ่',
    phone: '', email: '', password: '', confirmPassword: '',
    addressDetail: '', subDistrict: '', district: '', province: '', postalCode: '',
  });

  // ── ตรวจสอบว่าไลไอดีนี้มีบัญชีอยู่แล้วหรือไม่ก่อนให้กรอกฟอร์ม ──
  // เดิม register.js ไม่เคยเช็คเลย ทำให้ไลไอดีเดียวกันสมัครซ้ำได้เรื่อยๆ (เสี่ยงร้านซ้ำ/ขอ trial
  // ซ้ำ) — ผู้ใช้ขอชัดเจนให้ถามก่อนว่า "มีบัญชีแล้ว ต้องการลบข้อมูลเก่า หรือเพิ่ม"
  const [checkedExisting, setCheckedExisting] = useState(false);
  const [existingRoles, setExistingRoles] = useState([]);
  const [decision, setDecision] = useState(null); // null = ยังไม่ตัดสินใจ, 'form' = ไปกรอกฟอร์มสมัครได้แล้ว
  const [deleteMode, setDeleteMode] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const { userId, name, ref: referralCode } = router.query;
  const ownerRole = existingRoles.find(r => r.role === 'owner') || null;

  useEffect(() => {
    if (router.isReady) setIsReady(true);
  }, [router.isReady]);

  useEffect(() => {
    if (!isReady) return;
    if (!userId) { setCheckedExisting(true); return; }
    (async () => {
      try {
        const res = await fetch(`/api/auth/check-user?userId=${userId}`);
        const data = await res.json();
        if (data.exists && data.roles?.length) {
          setExistingRoles(data.roles);
        } else {
          setDecision('form'); // ยังไม่มีบัญชีเลย → ข้ามหน้าตัดสินใจ ไปกรอกฟอร์มปกติทันที
        }
      } catch {
        setDecision('form'); // เช็คไม่ได้ → ไม่บล็อกผู้ใช้ ปล่อยให้กรอกฟอร์มได้ตามปกติ
      } finally {
        setCheckedExisting(true);
      }
    })();
  }, [isReady, userId]);

  const goToExistingShop = (roleEntry) => {
    if (roleEntry.role === 'admin') {
      router.push(`/dashboard?userId=${roleEntry.ownerId}&adminId=${userId}`);
    } else {
      router.push(`/dashboard?userId=${roleEntry.ownerId}`);
    }
  };

  const handleDeleteAndReregister = async () => {
    if (!ownerRole) return;
    setDeleteError('');
    if (deleteConfirmText.trim() !== (ownerRole.shopName || '').trim()) {
      setDeleteError('ชื่อร้านที่พิมพ์ไม่ตรงกับชื่อร้านจริง กรุณาพิมพ์ให้ตรงเป๊ะ');
      return;
    }
    setDeleteLoading(true);
    try {
      const res = await axios.delete('/api/shop/delete-shop', {
        data: { shopId: ownerRole.shopId, lineUserId: userId, confirmShopName: deleteConfirmText.trim() }
      });
      if (res.data.success) {
        setDecision('form'); // ลบสำเร็จ → เข้าฟอร์มสมัครใหม่ (นับ trial ใหม่ไม่ได้แล้ว ถูกบันทึกไว้ก่อนลบ)
      }
    } catch (err) {
      setDeleteError(err.response?.data?.error || 'ลบร้านไม่สำเร็จ กรุณาลองใหม่');
    }
    setDeleteLoading(false);
  };

  // Districts filtered by selected province
  const availableDistricts = formData.province ? (DISTRICTS[formData.province] || []) : [];

  const set = (field) => (e) => {
    const val = e.target ? e.target.value : e;
    setFormData(prev => ({ ...prev, [field]: val }));
  };

  const handleProvinceChange = (e) => {
    setFormData(prev => ({ ...prev, province: e.target.value, district: '', subDistrict: '', postalCode: '' }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!consentChecked) return alert('กรุณายอมรับเงื่อนไขการใช้บริการและนโยบายความเป็นส่วนตัวก่อนครับ');
    if (formData.password !== formData.confirmPassword) return alert('รหัสผ่านไม่ตรงกัน กรุณากรอกใหม่อีกครั้ง');
    if (formData.password.length < 8) return alert('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร');
    if (!userId) return alert('ไม่พบ LINE ID กรุณาสมัครผ่าน LINE OA เท่านั้นครับ');

    setLoading(true);
    try {
      await axios.post('/api/register', {
        ...formData,
        userType,
        lineUserId: userId,
        ownerName: name || 'คุณลูกค้า',
        referralCode: referralCode || null,
        termsAccepted: consentChecked,
      });
      setStep(4);
    } catch (err) {
      alert('❌ ' + (err.response?.data?.error || err.message));
    }
    setLoading(false);
  };

  if (!isReady || (userId && !checkedExisting)) return (
    <div className="min-h-screen flex items-center justify-center bg-blue-950 text-white">
      <p className="animate-pulse font-bold tracking-widest text-sm">กำลังโหลด...</p>
    </div>
  );

  // ── หน้าตัดสินใจ: ไลไอดีนี้ผูกกับบัญชีอยู่แล้ว ──
  if (userId && existingRoles.length > 0 && decision === null) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-950 via-blue-900 to-blue-800 flex items-center justify-center p-6">
        <Head><title>พบบัญชีอยู่แล้ว | Smile Slip Pro</title></Head>
        <div className="max-w-md w-full bg-white rounded-3xl p-8 shadow-2xl">
          {!deleteMode ? (
            <>
              <div className="text-center mb-6">
                <div className="text-4xl mb-3">🔎</div>
                <h2 className="text-lg font-black text-slate-900 mb-1">บัญชี LINE นี้มีอยู่ในระบบแล้ว</h2>
                <p className="text-slate-400 text-xs">เลือกสิ่งที่ต้องการทำต่อ</p>
              </div>

              <div className="space-y-2 mb-5">
                {existingRoles.map((r) => (
                  <div key={`${r.shopId}-${r.role}`}
                    className="flex items-center justify-between gap-3 py-3 px-4 bg-slate-50 rounded-xl">
                    <span className="font-bold text-slate-800 text-sm truncate">{r.shopName || 'ร้านค้า'}</span>
                    <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full shrink-0 ${r.role === 'owner' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>
                      {r.role === 'owner' ? '👑 เจ้าของร้าน' : '🛡️ แอดมิน'}
                    </span>
                  </div>
                ))}
              </div>

              <div className="space-y-2.5">
                {existingRoles.map((r) => (
                  <button key={`goto-${r.shopId}-${r.role}`} onClick={() => goToExistingShop(r)}
                    className="w-full flex items-center justify-center gap-2 py-3.5 bg-blue-900 hover:bg-blue-700 text-white rounded-xl font-black text-sm transition-all shadow-lg">
                    <LogIn size={16}/> เข้าร้าน "{r.shopName}"
                  </button>
                ))}

                {!ownerRole && (
                  <button onClick={() => setDecision('form')}
                    className="w-full flex items-center justify-center gap-2 py-3.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-xl font-black text-sm transition-all border-2 border-emerald-200">
                    <Plus size={16}/> สมัครร้านใหม่แยกต่างหาก (จ่ายแพ็กเกจเอง)
                  </button>
                )}

                {ownerRole && (
                  <>
                    <button onClick={() => { setDeleteMode(true); setDeleteError(''); }}
                      className="w-full flex items-center justify-center gap-2 py-3.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-xl font-black text-sm transition-all border-2 border-red-200">
                      <Trash2 size={16}/> ลบร้านเดิมแล้วสมัครใหม่
                    </button>
                    <p className="text-[10px] text-slate-400 text-center leading-relaxed px-2">
                      * บัญชีนี้เป็นเจ้าของร้านอยู่แล้ว ระบบยังไม่รองรับการเป็นเจ้าของ 2 ร้านพร้อมกัน —
                      ถ้าต้องการเปิดร้านใหม่แยกต่างหาก ต้องลบร้านเดิมก่อน หรือใช้บัญชี LINE อื่นสมัคร
                    </p>
                  </>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="text-center mb-5">
                <div className="w-14 h-14 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center mx-auto mb-3">
                  <AlertTriangle size={28}/>
                </div>
                <h2 className="text-lg font-black text-slate-900 mb-1">ยืนยันการลบร้าน "{ownerRole?.shopName}"</h2>
                <p className="text-red-500 text-xs font-bold leading-relaxed">
                  ⚠️ ลบถาวร กู้คืนไม่ได้ — ข้อมูลร้าน/เครดิต/พนักงาน/สาขา/บัญชีธนาคารทั้งหมดจะถูกลบทิ้ง
                  และสิทธิ์ทดลองใช้ฟรี 30 วันของบัญชีนี้จะถูกใช้ไปแล้วถาวร (สมัครใหม่จะไม่ได้ trial อีก)
                </p>
              </div>

              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">
                พิมพ์ชื่อร้าน "{ownerRole?.shopName}" เพื่อยืนยัน
              </label>
              <input value={deleteConfirmText} onChange={e => setDeleteConfirmText(e.target.value)}
                placeholder={ownerRole?.shopName}
                className="w-full px-4 py-3 bg-slate-50 border-2 border-transparent rounded-xl focus:bg-white focus:border-red-400 outline-none transition-all font-bold text-sm mb-3"/>

              {deleteError && (
                <div className="bg-red-50 border border-red-200 text-red-600 text-xs font-bold px-4 py-3 rounded-xl mb-3">
                  {deleteError}
                </div>
              )}

              <div className="flex gap-3">
                <button onClick={() => { setDeleteMode(false); setDeleteConfirmText(''); setDeleteError(''); }}
                  className="flex-1 py-3 bg-slate-100 text-slate-500 rounded-xl font-bold text-sm hover:bg-slate-200 transition-all">
                  ยกเลิก
                </button>
                <button onClick={handleDeleteAndReregister} disabled={deleteLoading || !deleteConfirmText.trim()}
                  className="flex-[2] py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl font-black text-sm transition-all disabled:opacity-40">
                  {deleteLoading ? 'กำลังลบ...' : '🗑️ ลบถาวรแล้วสมัครใหม่'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  if (!userId && step !== 4) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-950 to-blue-800 flex items-center justify-center p-6">
        <div className="max-w-sm w-full bg-white rounded-3xl p-10 text-center shadow-2xl">
          <MessageCircle size={48} className="mx-auto mb-5 text-[#06C755]"/>
          <h2 className="text-xl font-black text-slate-900 mb-2">ต้องสมัครผ่าน LINE</h2>
          <p className="text-slate-400 text-sm mb-6">การสมัครครั้งแรกต้องใช้ LINE เพื่อยืนยันตัวตนและรับ User ID ของคุณ</p>
          <button onClick={() => window.location.href = '/api/auth/line'}
            className="w-full py-3.5 bg-[#06C755] text-white rounded-2xl font-black text-sm shadow-lg">
            เข้าสู่ระบบด้วย LINE
          </button>
        </div>
      </div>
    );
  }

  const inputClass = "w-full px-4 py-3.5 bg-slate-50 border-2 border-transparent rounded-xl focus:bg-white focus:border-blue-500 outline-none transition-all font-bold text-sm";
  const labelClass = "text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block";

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-950 via-blue-900 to-blue-800 py-10 px-4 font-sans">
      <Head><title>สมัครใช้งาน | Smile Slip Pro</title></Head>

      <div className="max-w-xl mx-auto">

        {/* Header */}
        <div className="text-center mb-8">
          <div className="text-4xl mb-2">😊</div>
          <h1 className="text-white font-black text-xl tracking-tight">สมัครใช้งาน Smile Slip Pro</h1>
          {name && <p className="text-blue-300 text-sm mt-1">ยินดีต้อนรับ คุณ{name}</p>}
        </div>

        {/* Progress Bar */}
        {step < 4 && (
          <div className="mb-6">
            <div className="flex items-center justify-between px-2 mb-3">
              {STEP_LABELS.map((label, i) => {
                const num = i + 1;
                return (
                  <div key={num} className="flex items-center">
                    <div className="flex flex-col items-center">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-black text-sm transition-all ${step > num ? 'bg-emerald-500 text-white' : step === num ? 'bg-white text-blue-900' : 'bg-blue-800 text-blue-400'}`}>
                        {step > num ? <CheckCircle2 size={18}/> : num}
                      </div>
                      <span className={`text-[9px] font-bold mt-1 ${step === num ? 'text-white' : 'text-blue-400'}`}>{label}</span>
                    </div>
                    {i < STEP_LABELS.length - 1 && (
                      <div className={`w-16 md:w-28 h-0.5 mx-2 mb-4 rounded-full transition-all ${step > num ? 'bg-emerald-500' : 'bg-blue-800'}`}/>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="bg-white rounded-3xl shadow-2xl p-8 border border-blue-100">

          {/* ═══ STEP 1: ข้อมูลธุรกิจ ═══ */}
          {step === 1 && (
            <div className="space-y-6 animate-in fade-in duration-300">
              <div>
                <h2 className="text-lg font-black text-slate-900 flex items-center gap-2 mb-1">
                  <Building2 size={20} className="text-blue-600"/> ข้อมูลธุรกิจ
                </h2>
                <p className="text-slate-400 text-xs">กรอกข้อมูลร้านค้าหรือบริษัทของคุณ</p>
              </div>

              {/* Individual / Corporate */}
              <div className="flex gap-2 p-1.5 bg-slate-100 rounded-2xl">
                <button onClick={() => setUserType('individual')}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all ${userType === 'individual' ? 'bg-white shadow text-blue-600' : 'text-slate-400'}`}>
                  บุคคลธรรมดา
                </button>
                <button onClick={() => setUserType('corporate')}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all ${userType === 'corporate' ? 'bg-white shadow text-blue-600' : 'text-slate-400'}`}>
                  นิติบุคคล
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className={labelClass}>ชื่อร้านค้า / บริษัท *</label>
                  <div className="relative">
                    <Store className="absolute left-4 top-3.5 text-slate-300" size={18}/>
                    <input required placeholder="เช่น ร้านข้าวแม่มาลี, บริษัท ABC จำกัด"
                      className={`${inputClass} pl-11`}
                      value={formData.shopName} onChange={set('shopName')}/>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>เลขประจำตัวผู้เสียภาษี</label>
                    <div className="relative">
                      <Hash className="absolute left-4 top-3.5 text-slate-300" size={16}/>
                      <input placeholder="13 หลัก (ถ้ามี)" maxLength={13}
                        className={`${inputClass} pl-10 font-mono`}
                        value={formData.taxId} onChange={set('taxId')}/>
                    </div>
                  </div>
                  <div>
                    <label className={labelClass}>ชื่อสาขา</label>
                    <div className="relative">
                      <Landmark className="absolute left-4 top-3.5 text-slate-300" size={16}/>
                      <input placeholder="สำนักงานใหญ่"
                        className={`${inputClass} pl-10`}
                        value={formData.branch} onChange={set('branch')}/>
                    </div>
                  </div>
                </div>
              </div>

              <button onClick={() => setStep(2)} disabled={!formData.shopName}
                className="w-full py-3.5 bg-blue-900 hover:bg-blue-700 text-white rounded-xl font-black text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-40 shadow-lg">
                ถัดไป: ที่อยู่ & ติดต่อ <ChevronRight size={18}/>
              </button>
            </div>
          )}

          {/* ═══ STEP 2: ที่อยู่ & ติดต่อ ═══ */}
          {step === 2 && (
            <div className="space-y-5 animate-in fade-in duration-300">
              <div>
                <h2 className="text-lg font-black text-slate-900 flex items-center gap-2 mb-1">
                  <MapPin size={20} className="text-blue-600"/> ที่อยู่ & ข้อมูลติดต่อ
                </h2>
                <p className="text-slate-400 text-xs">สำหรับออกใบกำกับภาษีและติดต่อกลับ</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>อีเมล *</label>
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-3.5 text-slate-300" size={16}/>
                    <input required type="email" placeholder="example@email.com"
                      className={`${inputClass} pl-10`}
                      value={formData.email} onChange={set('email')}/>
                  </div>
                </div>
                <div>
                  <label className={labelClass}>เบอร์โทรศัพท์ *</label>
                  <div className="relative">
                    <Phone className="absolute left-3.5 top-3.5 text-slate-300" size={16}/>
                    <input required placeholder="0812345678" maxLength={10}
                      className={`${inputClass} pl-10`}
                      value={formData.phone} onChange={set('phone')}/>
                  </div>
                </div>
              </div>

              <div>
                <label className={labelClass}>เลขที่ / อาคาร / ซอย / ถนน *</label>
                <input required placeholder="เช่น 76 หมู่ 9 ถ.เชียงใหม่-หางดง"
                  className={inputClass}
                  value={formData.addressDetail} onChange={set('addressDetail')}/>
              </div>

              {/* Province Dropdown */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>จังหวัด *</label>
                  <select required className={`${inputClass} cursor-pointer`}
                    value={formData.province} onChange={handleProvinceChange}>
                    <option value="">-- เลือกจังหวัด --</option>
                    {PROVINCES.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>อำเภอ / เขต *</label>
                  <select required className={`${inputClass} cursor-pointer`}
                    value={formData.district} onChange={set('district')}
                    disabled={!formData.province}>
                    <option value="">-- เลือกอำเภอ --</option>
                    {availableDistricts.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>ตำบล / แขวง *</label>
                  <input required placeholder="ตำบล/แขวง"
                    className={inputClass}
                    value={formData.subDistrict} onChange={set('subDistrict')}/>
                </div>
                <div>
                  <label className={labelClass}>รหัสไปรษณีย์ *</label>
                  <input required placeholder="50230" maxLength={5}
                    className={`${inputClass} font-mono`}
                    value={formData.postalCode} onChange={set('postalCode')}/>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setStep(1)}
                  className="flex-1 py-3 bg-slate-100 text-slate-500 rounded-xl font-bold text-sm hover:bg-slate-200 transition-all">
                  ย้อนกลับ
                </button>
                <button
                  onClick={() => {
                    if (!formData.email || !formData.phone || !formData.province || !formData.district || !formData.subDistrict || !formData.postalCode || !formData.addressDetail) {
                      return alert('กรุณากรอกข้อมูลให้ครบทุกช่อง');
                    }
                    setStep(3);
                  }}
                  className="flex-[2] py-3 bg-blue-900 hover:bg-blue-700 text-white rounded-xl font-black text-sm flex items-center justify-center gap-2 transition-all shadow-lg">
                  ถัดไป: ตั้งรหัสผ่าน <ChevronRight size={18}/>
                </button>
              </div>
            </div>
          )}

          {/* ═══ STEP 3: รหัสผ่าน + Consent ═══
              เดิมมีช่องกรอกบัญชีธนาคารร้านอยู่ในหน้านี้ด้วย — เอาออกแล้วตามที่ผู้ใช้ขอ (2026-07-20)
              เพื่อให้สมัครง่ายที่สุด ลูกค้าไปกรอกบัญชีธนาคารเองทีหลังได้ที่ Dashboard → ตั้งค่า */}
          {step === 3 && (
            <form onSubmit={handleSubmit} className="space-y-5 animate-in fade-in duration-300">
              {/* Password */}
              <div>
                <h3 className="text-lg font-black text-slate-900 flex items-center gap-2 mb-4">
                  <Lock size={20} className="text-blue-600"/> ตั้งรหัสผ่าน (สำหรับ login ด้วย Email)
                </h3>
                <div className="space-y-3">
                  <div>
                    <label className={labelClass}>รหัสผ่าน * (อย่างน้อย 8 ตัวอักษร)</label>
                    <div className="relative">
                      <Lock className="absolute left-4 top-3.5 text-slate-300" size={16}/>
                      <input required type={showPassword ? 'text' : 'password'}
                        placeholder="ตั้งรหัสผ่านของคุณ" minLength={8}
                        className={`${inputClass} pl-11 pr-11`}
                        value={formData.password} onChange={set('password')}/>
                      <button type="button" onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-4 top-3.5 text-slate-300 hover:text-slate-600">
                        {showPassword ? <EyeOff size={16}/> : <Eye size={16}/>}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className={labelClass}>ยืนยันรหัสผ่าน *</label>
                    <div className="relative">
                      <ShieldCheck className="absolute left-4 top-3.5 text-slate-300" size={16}/>
                      <input required type={showConfirm ? 'text' : 'password'}
                        placeholder="กรอกรหัสผ่านอีกครั้ง" minLength={8}
                        className={`${inputClass} pl-11 pr-11 ${formData.confirmPassword && formData.password !== formData.confirmPassword ? 'focus:border-red-400 border-red-200' : ''}`}
                        value={formData.confirmPassword} onChange={set('confirmPassword')}/>
                      <button type="button" onClick={() => setShowConfirm(!showConfirm)}
                        className="absolute right-4 top-3.5 text-slate-300 hover:text-slate-600">
                        {showConfirm ? <EyeOff size={16}/> : <Eye size={16}/>}
                      </button>
                    </div>
                    {formData.confirmPassword && formData.password !== formData.confirmPassword && (
                      <p className="text-red-500 text-xs mt-1 font-bold">รหัสผ่านไม่ตรงกัน</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Consent */}
              <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4">
                {!consentChecked ? (
                  <button type="button" onClick={() => { setTermsScrolled(false); setShowTermsModal(true); }}
                    className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-bold transition-all">
                    <ShieldCheck size={15}/> อ่านและยอมรับเงื่อนไข & นโยบาย
                  </button>
                ) : (
                  <label className="flex items-start gap-3 cursor-pointer" onClick={() => setConsentChecked(false)}>
                    <div className="w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 mt-0.5 bg-blue-600 border-blue-600">
                      <CheckCircle2 size={12} className="text-white"/>
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      ฉันได้อ่านและยอมรับเงื่อนไขการใช้บริการและนโยบายความเป็นส่วนตัวของ Smile Slip Pro แล้ว
                    </p>
                  </label>
                )}
              </div>

              <div className="flex gap-3">
                <button type="button" onClick={() => setStep(2)}
                  className="flex-1 py-3 bg-slate-100 text-slate-500 rounded-xl font-bold text-sm hover:bg-slate-200 transition-all">
                  ย้อนกลับ
                </button>
                <button type="submit" disabled={loading || !consentChecked}
                  className="flex-[2] py-3 bg-blue-900 hover:bg-blue-700 text-white rounded-xl font-black text-sm transition-all shadow-lg disabled:opacity-40">
                  {loading ? 'กำลังลงทะเบียน...' : 'ลงทะเบียนและเริ่มใช้งาน'}
                </button>
              </div>
            </form>
          )}

          {/* ═══ STEP 4: สำเร็จ ═══ */}
          {step === 4 && (
            <div className="py-2 animate-in zoom-in-95 duration-300">
              {/* Success header */}
              <div className="text-center mb-5">
                <div className="w-16 h-16 bg-emerald-50 text-emerald-500 rounded-3xl flex items-center justify-center mx-auto mb-4 shadow-inner">
                  <CheckCircle2 size={36} strokeWidth={2.5}/>
                </div>
                <h2 className="text-2xl font-black text-slate-900 mb-1 tracking-tight">สมัครสำเร็จ!</h2>
                <p className="text-slate-500 text-sm leading-relaxed">
                  ยินดีต้อนรับ <span className="text-blue-600 font-black">{formData.shopName}</span>
                </p>
                <p className="text-slate-400 text-xs mt-1">ได้รับเครดิตเริ่มต้น <strong>20 แผ่น</strong> ฟรี</p>
              </div>

              {/* ขั้นตอนถัดไป: เพิ่ม LINE Bot */}
              <div className="bg-[#06C755]/10 border-2 border-[#06C755]/40 rounded-2xl p-4 mb-4">
                <p className="font-black text-slate-800 text-sm mb-3 flex items-center gap-2">
                  <span className="text-lg">🤖</span> ขั้นตอนถัดไป — เพิ่ม LINE Bot
                </p>
                <div className="space-y-2 text-xs text-slate-600 mb-4">
                  <div className="flex items-start gap-2">
                    <span className="w-5 h-5 rounded-full bg-[#06C755] text-white flex items-center justify-center text-[10px] font-black shrink-0 mt-0.5">1</span>
                    <span>กดปุ่มด้านล่างเพื่อ <strong>เพิ่ม Smile Slip Bot</strong> เป็นเพื่อนใน LINE</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="w-5 h-5 rounded-full bg-[#06C755] text-white flex items-center justify-center text-[10px] font-black shrink-0 mt-0.5">2</span>
                    <span><strong>เชิญ Bot เข้ากลุ่ม LINE</strong> ของร้านคุณที่ใช้ส่งสลิป</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="w-5 h-5 rounded-full bg-[#06C755] text-white flex items-center justify-center text-[10px] font-black shrink-0 mt-0.5">3</span>
                    <span>พิมพ์ <strong>#ช่วยเหลือ</strong> ในกลุ่ม เพื่อเริ่มใช้งาน</span>
                  </div>
                </div>
                <a href="https://lin.ee/wdnoEN5" target="_blank" rel="noreferrer"
                  className="w-full flex items-center justify-center gap-2 bg-[#06C755] hover:bg-[#05a848] text-white font-black py-3 rounded-xl text-sm transition-all">
                  <svg width="18" height="18" viewBox="0 0 48 48" fill="currentColor"><path d="M24 4C12.95 4 4 11.86 4 21.5c0 5.5 2.93 10.4 7.52 13.6L9.5 44l9.3-4.64C20.5 39.78 22.22 40 24 40c11.05 0 20-7.86 20-17.5S35.05 4 24 4z"/></svg>
                  เพิ่ม Smile Slip Bot (@574unjqj)
                </a>
              </div>

              <button onClick={() => router.push(`/dashboard?userId=${userId}`)}
                className="w-full py-3.5 bg-blue-900 hover:bg-blue-700 text-white rounded-2xl font-black text-sm transition-all">
                ข้ามไปที่ Dashboard →
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <p className="text-center text-blue-400 text-xs mt-6">
          มีบัญชีอยู่แล้ว?{' '}
          <Link href="/login" className="text-white font-bold underline underline-offset-2">เข้าสู่ระบบ</Link>
        </p>
      </div>

      {/* ─── Terms & Privacy Modal ─── */}
      {showTermsModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl flex flex-col max-h-[90vh] shadow-2xl">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
              <h3 className="font-black text-slate-900 text-sm">📋 เงื่อนไขการใช้บริการ & นโยบายความเป็นส่วนตัว</h3>
              <button onClick={() => setShowTermsModal(false)} className="text-slate-400 hover:text-slate-600 text-2xl leading-none">×</button>
            </div>

            {/* เนื้อหา — สรุปสั้น + ลิงก์ไปอ่านฉบับเต็มจริง (ที่มาเดียวกับ /terms และ /privacy เสมอ ไม่ก๊อปแยก) */}
            <div className="overflow-y-auto flex-1 px-5 py-4 text-xs text-slate-600 leading-relaxed space-y-4"
              onScroll={e => {
                const el = e.currentTarget;
                if (el.scrollHeight - el.scrollTop - el.clientHeight < 50) setTermsScrolled(true);
              }}>
              <p className="text-slate-400">สรุปสาระสำคัญด้านล่างนี้ ส่วนฉบับเต็มกดอ่านได้จากปุ่มลิงก์ — เมื่อเลื่อนอ่านจนสุดหน้านี้แล้วจะกดยอมรับได้ครับ</p>

              <div>
                <p className="font-black text-slate-800 text-sm mb-2">เงื่อนไขการใช้บริการ (สรุป)</p>
                <p><strong>1. บริการ:</strong> Smile Slip Pro อ่านสลิปด้วย AI แล้วบันทึกลง Google Drive/Sheets ของร้านคุณเอง ไม่ใช่สถาบันการเงิน</p>
                <p className="mt-2"><strong>2. เครดิต:</strong> สแกนสลิป 1 ครั้ง = 1 เครดิต ซื้อแล้วไม่คืนเงิน เว้นแต่ระบบผิดพลาดจากฝั่งเรา</p>
                <p className="mt-2"><strong>3. ความรับผิดชอบ:</strong> ท่านรับผิดชอบความถูกต้องของข้อมูลที่บันทึก เราไม่รับผิดชอบความผิดพลาดจาก OCR</p>
                <p className="mt-2"><strong>4. แพ็กเกจ/การชำระเงิน:</strong> Shop Pro / Advance / Business / Enterprise เรียกเก็บอัตโนมัติผ่าน Stripe ยกเลิกได้ตลอดเวลา</p>
                <p className="mt-2"><strong>5. การระงับบัญชี:</strong> สงวนสิทธิ์ระงับบัญชีที่ใช้งานผิดกฎหมายหรือผิดเงื่อนไขทันที</p>
              </div>

              <div>
                <p className="font-black text-slate-800 text-sm mb-2 mt-4">นโยบายความเป็นส่วนตัว (PDPA) (สรุป)</p>
                <p><strong>1. ข้อมูลที่เก็บใน Database ของเรา:</strong> ชื่อร้าน, LINE User ID, อีเมล, เบอร์โทร, บัญชีธนาคาร, เครดิตคงเหลือ และ LINE ของผู้ดูแลร้าน (ถ้ามี)</p>
                <p className="mt-2"><strong>2. ข้อมูลธุรกรรม:</strong> รูปสลิป/ชื่อผู้โอน/ยอดเงิน เก็บใน Google Drive/Sheets ของร้านท่านเองโดยตรง ท่านควบคุมและลบได้เอง</p>
                <p className="mt-2"><strong>3. Anonymized Analytics:</strong> เก็บ pattern การใช้งาน (hash SHA-256 ไม่เก็บชื่อจริง) เพื่อปรับปรุงบริการ และแสดงเป็นฟีเจอร์ Marketing Intelligence ให้เจ้าของร้าน Enterprise ใช้วางแผนธุรกิจ</p>
                <p className="mt-2"><strong>4. การแชร์ข้อมูล:</strong> ไม่ขาย/แจกจ่ายให้บุคคลที่สาม ยกเว้นผู้ให้บริการที่จำเป็น (Google, Stripe, LINE, Supabase)</p>
                <p className="mt-2"><strong>5. สิทธิ์ของท่าน:</strong> ขอเข้าถึง แก้ไข ลบ หรือถอนความยินยอมได้ตลอดเวลา ติดต่อ DPO ได้ที่ smileslip.official@gmail.com</p>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-2">
                <a href="/terms" target="_blank" rel="noopener noreferrer"
                  className="text-center bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold rounded-xl py-2.5 text-xs transition-colors">
                  📋 อ่านเงื่อนไขฉบับเต็ม
                </a>
                <a href="/privacy" target="_blank" rel="noopener noreferrer"
                  className="text-center bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold rounded-xl py-2.5 text-xs transition-colors">
                  🔒 อ่านนโยบายฉบับเต็ม
                </a>
              </div>

              {/* sentinel — เมื่อมองเห็น element นี้ = scroll ถึงท้ายแล้ว */}
              <div className="h-4"/>
            </div>

            <div className="px-5 py-4 border-t border-slate-100 shrink-0">
              {!termsScrolled ? (
                <p className="text-center text-xs text-slate-400 mb-3">⬇️ เลื่อนอ่านจนจบเพื่อยืนยัน</p>
              ) : null}
              <button
                type="button"
                disabled={!termsScrolled}
                onClick={() => { setConsentChecked(true); setShowTermsModal(false); }}
                className={`w-full py-3 rounded-xl font-black text-sm transition-all ${termsScrolled ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg' : 'bg-slate-100 text-slate-300 cursor-not-allowed'}`}>
                {termsScrolled ? '✅ ฉันอ่านครบและยอมรับเงื่อนไขทั้งหมด' : 'กรุณาเลื่อนอ่านให้ครบก่อน'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
