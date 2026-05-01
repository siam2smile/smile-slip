import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import axios from 'axios';
import { 
  Store, User, Phone, MapPin, Mail, 
  ChevronRight, CheckCircle2, ShieldCheck, Landmark 
} from 'lucide-react';

export default function Register() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [isReady, setIsReady] = useState(false);
  const [userType, setUserType] = useState('individual'); // individual หรือ corporate
  const [formData, setFormData] = useState({ 
    shopName: '', 
    taxId: '', 
    phone: '', 
    address: '',
    email: '' 
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (router.isReady) setIsReady(true);
  }, [router.isReady]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      // 1. บันทึกข้อมูลลงฐานข้อมูล Supabase ผ่าน API
      const res = await axios.post('/api/register', {
        ...formData,
        userType,
        lineUserId: router.query.userId || 'test_user',
        ownerName: router.query.name || 'คุณลูกค้า'
      });

      // 2. ถ้าบันทึกสำเร็จ ให้ข้ามไปขั้นตอนสุดท้าย (Connect Google)
      setStep(3);
    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message;
      alert("❌ บันทึกไม่สำเร็จ: " + errorMsg);
    }
    setLoading(false);
  };

  if (!isReady) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 font-sans">
      <div className="text-center">
        <div className="text-4xl animate-bounce">😊</div>
        <p className="mt-4 text-slate-400 font-bold tracking-widest uppercase text-xs">Preparing System...</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F8FAFC] py-12 px-6 font-sans text-slate-900">
      <div className="max-w-xl mx-auto">
        
        {/* Progress Bar */}
        <div className="flex items-center justify-between mb-12 px-4">
          {[1, 2, 3].map((num) => (
            <div key={num} className="flex items-center">
              <div className={`w-10 h-10 rounded-2xl flex items-center justify-center font-bold transition-all ${step >= num ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-100' : 'bg-white text-slate-300'}`}>
                {step > num ? <CheckCircle2 size={20}/> : num}
              </div>
              {num < 3 && <div className={`w-12 md:w-24 h-1 mx-2 rounded-full ${step > num ? 'bg-indigo-600' : 'bg-slate-200'}`} />}
            </div>
          ))}
        </div>

        <div className="bg-white rounded-[3rem] shadow-2xl shadow-slate-200/50 p-10 md:p-12 border border-slate-100 relative overflow-hidden">
          
          {step === 1 && (
            <div className="animate-in slide-in-from-right-8 duration-500">
              <h2 className="text-3xl font-black mb-2 text-slate-900 tracking-tight">ข้อมูลร้านค้า</h2>
              <p className="text-slate-400 mb-10 font-medium italic">บอกให้เรารู้จักธุรกิจของคุณมากขึ้น</p>
              
              <div className="space-y-6">
                <div className="flex gap-2 p-1.5 bg-slate-100 rounded-2xl">
                  <button onClick={() => setUserType('individual')} className={`flex-1 py-3 rounded-xl font-bold transition-all ${userType === 'individual' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-400'}`}>บุคคลธรรมดา</button>
                  <button onClick={() => setUserType('corporate')} className={`flex-1 py-3 rounded-xl font-bold transition-all ${userType === 'corporate' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-400'}`}>นิติบุคคล</button>
                </div>

                <div className="relative group">
                  <Store className="absolute left-4 top-4 text-slate-300 group-focus-within:text-indigo-500 transition-colors" size={20}/>
                  <input required placeholder="ชื่อร้านค้า / บริษัท" className="w-full pl-12 pr-4 py-4 bg-slate-50 border-2 border-slate-50 rounded-2xl focus:bg-white focus:border-indigo-500 outline-none transition-all font-bold" 
                    onChange={(e) => setFormData({...formData, shopName: e.target.value})} />
                </div>

                {userType === 'corporate' && (
                  <div className="relative group animate-in fade-in zoom-in-95">
                    <Landmark className="absolute left-4 top-4 text-slate-300 group-focus-within:text-indigo-500 transition-colors" size={20}/>
                    <input required placeholder="เลขประจำตัวผู้เสียภาษี 13 หลัก" className="w-full pl-12 pr-4 py-4 bg-slate-50 border-2 border-slate-50 rounded-2xl focus:bg-white focus:border-indigo-500 outline-none transition-all font-mono font-bold" 
                      onChange={(e) => setFormData({...formData, taxId: e.target.value})} />
                  </div>
                )}

                <button onClick={() => setStep(2)} disabled={!formData.shopName} className="w-full py-5 bg-slate-900 text-white rounded-[1.5rem] font-black text-lg flex items-center justify-center gap-3 hover:bg-indigo-600 transition-all shadow-xl shadow-slate-200 mt-6 disabled:opacity-50">
                  ถัดไป <ChevronRight size={20}/>
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="animate-in slide-in-from-right-8 duration-500">
              <h2 className="text-3xl font-black mb-2 text-slate-900 tracking-tight">ข้อมูลติดต่อ</h2>
              <p className="text-slate-400 mb-10 font-medium italic">เราจะใช้ข้อมูลนี้เพื่อซิงค์ระบบ Google และแจ้งเตือน</p>
              
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="relative group">
                  <Mail className="absolute left-4 top-4 text-slate-300 group-focus-within:text-indigo-500 transition-colors" size={20}/>
                  <input required type="email" placeholder="อีเมล (สำหรับเชื่อม Google Drive)" className="w-full pl-12 pr-4 py-4 bg-slate-50 border-2 border-slate-50 rounded-2xl focus:bg-white focus:border-indigo-500 outline-none transition-all font-bold" 
                    onChange={(e) => setFormData({...formData, email: e.target.value})} />
                </div>

                <div className="relative group">
                  <Phone className="absolute left-4 top-4 text-slate-300 group-focus-within:text-indigo-500 transition-colors" size={20}/>
                  <input required placeholder="เบอร์โทรศัพท์มือถือ" className="w-full pl-12 pr-4 py-4 bg-slate-50 border-2 border-slate-50 rounded-2xl focus:bg-white focus:border-indigo-500 outline-none transition-all font-bold font-mono" 
                    onChange={(e) => setFormData({...formData, phone: e.target.value})} />
                </div>

                <div className="relative group">
                  <MapPin className="absolute left-4 top-4 text-slate-300 group-focus-within:text-indigo-500 transition-colors" size={20}/>
                  <textarea required placeholder="ที่อยู่ในการออกเอกสาร" className="w-full pl-12 pr-4 py-4 bg-slate-50 border-2 border-slate-50 rounded-2xl focus:bg-white focus:border-indigo-500 outline-none transition-all font-bold h-32" 
                    onChange={(e) => setFormData({...formData, address: e.target.value})} />
                </div>

                <div className="flex gap-4">
                   <button type="button" onClick={() => setStep(1)} className="flex-1 py-5 bg-slate-100 text-slate-500 rounded-[1.5rem] font-bold hover:bg-slate-200 transition-all">ย้อนกลับ</button>
                   <button type="submit" disabled={loading} className="flex-[2] py-5 bg-indigo-600 text-white rounded-[1.5rem] font-black text-lg flex items-center justify-center gap-3 shadow-xl shadow-indigo-100">
                    {loading ? "กำลังบันทึก..." : "ยืนยันลงทะเบียน"} <ChevronRight size={20}/>
                   </button>
                </div>
              </form>
            </div>
          )}

          {step === 3 && (
            <div className="text-center animate-in zoom-in-95 duration-500">
              <div className="w-24 h-24 bg-emerald-100 text-emerald-600 rounded-[2rem] flex items-center justify-center mx-auto mb-8 shadow-inner">
                <CheckCircle2 size={48} />
              </div>
              <h2 className="text-3xl font-black mb-4 text-slate-900 tracking-tight italic">Registration Success!</h2>
              <p className="text-slate-500 mb-10 font-medium">ยินดีต้อนรับคุณ <span className="text-indigo-600 font-bold">{formData.shopName}</span> เข้าสู่ระบบ</p>
              
              <div className="bg-indigo-50 p-8 rounded-[2.5rem] mb-10 text-left border border-indigo-100">
                <h4 className="font-black text-indigo-900 flex items-center gap-2 mb-2"><ShieldCheck size={18}/> ขั้นตอนสุดท้าย: เชื่อมต่อ Google Drive</h4>
                <p className="text-sm text-indigo-600/80 font-medium">เพื่อเปิดใช้งานระบบตรวจสลิปอัตโนมัติและบันทึกบัญชีลง Google Sheet ของคุณ</p>
              </div>

              <button 
                onClick={() => router.push(`/dashboard?userId=${router.query.userId}`)} 
                className="w-full py-6 bg-slate-900 text-white rounded-[2rem] font-black text-xl shadow-2xl shadow-slate-200 hover:scale-[1.02] active:scale-95 transition-all"
              >
                เข้าสู่หน้า Dashboard
              </button>
            </div>
          )}
        </div>

        <p className="mt-8 text-center text-slate-400 text-sm font-medium">
          © 2026 Smile Slip SME Ecosystem. <br/>
          <span className="text-[10px] uppercase tracking-widest opacity-50">Affordable Luxury Experience</span>
        </p>
      </div>
    </div>
  );
}