import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import axios from 'axios';
import Head from 'next/head';
import Link from 'next/link';
import {
  Store, Phone, MapPin, Mail, Lock, Eye, EyeOff,
  ChevronRight, CheckCircle2, MessageCircle, Building2,
  Hash, Landmark, CreditCard, ShieldCheck
} from 'lucide-react';
import { PROVINCES, DISTRICTS, BANKS } from '../data/thailand-address';

const STEP_LABELS = ['ข้อมูลธุรกิจ', 'ที่อยู่ & ติดต่อ', 'ธนาคาร & รหัสผ่าน'];

export default function Register() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [isReady, setIsReady] = useState(false);
  const [userType, setUserType] = useState('individual');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);

  const [formData, setFormData] = useState({
    shopName: '', taxId: '', branch: 'สำนักงานใหญ่',
    phone: '', email: '', password: '', confirmPassword: '',
    addressDetail: '', subDistrict: '', district: '', province: '', postalCode: '',
    bankName: '', bankAccountName: '', bankAccountNumber: '', bankAccountType: 'ออมทรัพย์'
  });

  const { userId, name } = router.query;

  useEffect(() => {
    if (router.isReady) setIsReady(true);
  }, [router.isReady]);

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
        ownerName: name || 'คุณลูกค้า'
      });
      setStep(4);
    } catch (err) {
      alert('❌ ' + (err.response?.data?.error || err.message));
    }
    setLoading(false);
  };

  if (!isReady) return (
    <div className="min-h-screen flex items-center justify-center bg-blue-950 text-white">
      <p className="animate-pulse font-bold tracking-widest text-sm">กำลังโหลด...</p>
    </div>
  );

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
                  ถัดไป: บัญชีธนาคาร <ChevronRight size={18}/>
                </button>
              </div>
            </div>
          )}

          {/* ═══ STEP 3: ธนาคาร + รหัสผ่าน + Consent ═══ */}
          {step === 3 && (
            <form onSubmit={handleSubmit} className="space-y-5 animate-in fade-in duration-300">
              {/* Bank Account */}
              <div>
                <h2 className="text-lg font-black text-slate-900 flex items-center gap-2 mb-1">
                  <Landmark size={20} className="text-blue-600"/> บัญชีธนาคารรับเงิน
                </h2>
                <p className="text-slate-400 text-xs">สำหรับแสดงใน Dashboard (แก้ไขได้ภายหลัง)</p>
              </div>

              <div>
                <label className={labelClass}>ธนาคาร</label>
                <select className={`${inputClass} cursor-pointer`}
                  value={formData.bankName} onChange={set('bankName')}>
                  <option value="">-- เลือกธนาคาร (ถ้ามี) --</option>
                  {BANKS.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>ชื่อบัญชี (ชื่อสำหรับรับเงิน)</label>
                  <input placeholder="ชื่อ-นามสกุล / ชื่อร้าน"
                    className={inputClass}
                    value={formData.bankAccountName} onChange={set('bankAccountName')}/>
                </div>
                <div>
                  <label className={labelClass}>เลขบัญชี</label>
                  <input placeholder="xxx-x-xxxxx-x" maxLength={20}
                    className={`${inputClass} font-mono`}
                    value={formData.bankAccountNumber} onChange={set('bankAccountNumber')}/>
                </div>
              </div>

              <div>
                <label className={labelClass}>ประเภทบัญชี</label>
                <div className="flex gap-2">
                  {['ออมทรัพย์', 'กระแสรายวัน'].map(t => (
                    <button key={t} type="button"
                      onClick={() => setFormData(prev => ({...prev, bankAccountType: t}))}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all border-2 ${formData.bankAccountType === t ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-100 bg-slate-50 text-slate-400'}`}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              {/* Password */}
              <div className="border-t border-slate-100 pt-5">
                <h3 className="text-sm font-black text-slate-900 flex items-center gap-2 mb-4">
                  <Lock size={16} className="text-blue-600"/> ตั้งรหัสผ่าน (สำหรับ login ด้วย Email)
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
                <label className="flex items-start gap-3 cursor-pointer">
                  <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 mt-0.5 transition-all ${consentChecked ? 'bg-blue-600 border-blue-600' : 'border-slate-300 bg-white'}`}
                    onClick={() => setConsentChecked(!consentChecked)}>
                    {consentChecked && <CheckCircle2 size={12} className="text-white"/>}
                  </div>
                  <input type="checkbox" className="hidden" checked={consentChecked} onChange={e => setConsentChecked(e.target.checked)}/>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    ฉันได้อ่านและยอมรับ{' '}
                    <Link href="/terms" target="_blank" className="text-blue-600 font-bold underline">เงื่อนไขการใช้บริการ</Link>
                    {' '}และ{' '}
                    <Link href="/privacy" target="_blank" className="text-blue-600 font-bold underline">นโยบายความเป็นส่วนตัว</Link>
                    {' '}ของ Smile Slip Pro รวมถึงยินยอมให้ระบบประมวลผลข้อมูลสลิปและบันทึกลง Google Drive/Sheets ของฉัน
                  </p>
                </label>
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
            <div className="text-center py-4 animate-in zoom-in-95 duration-300">
              <div className="w-20 h-20 bg-emerald-50 text-emerald-500 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-inner">
                <CheckCircle2 size={44} strokeWidth={2.5}/>
              </div>
              <h2 className="text-2xl font-black text-slate-900 mb-2 tracking-tight">สมัครสำเร็จ!</h2>
              <p className="text-slate-500 text-sm mb-2 leading-relaxed">
                ยินดีต้อนรับ <span className="text-blue-600 font-black">{formData.shopName}</span>
                <br/>เข้าสู่ครอบครัว Smile Slip Pro
              </p>
              <p className="text-slate-400 text-xs mb-8">คุณได้รับเครดิตเริ่มต้น <strong>20 แผ่น</strong> เพื่อทดลองใช้งาน</p>
              <button onClick={() => router.push(`/dashboard?userId=${userId}`)}
                className="w-full py-4 bg-blue-900 hover:bg-blue-700 text-white rounded-2xl font-black text-base shadow-xl transition-all">
                เข้าสู่ Dashboard →
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
    </div>
  );
}
