import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import axios from 'axios';
import { 
  Store, Phone, MapPin, Mail, 
  ChevronRight, CheckCircle2, ShieldCheck, Landmark, MessageCircle 
} from 'lucide-react';

export default function Register() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [isReady, setIsReady] = useState(false);
  const [userType, setUserType] = useState('individual');
  const [formData, setFormData] = useState({ 
    shopName: '', taxId: '', phone: '', address: '', email: '' 
  });
  const [loading, setLoading] = useState(false);

  // ดึงค่า ID จาก URL ที่ส่งมาจาก LINE
  const { userId, name } = router.query;

  useEffect(() => {
    if (router.isReady) setIsReady(true);
  }, [router.isReady]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!userId) {
      alert("ไม่พบข้อมูล LINE ID กรุณาลงทะเบียนผ่าน LINE OA เท่านั้นครับ");
      return;
    }
    setLoading(true);
    try {
      // บันทึกข้อมูลโดยแยกชัดเจน: ID LINE คือ userId / Email คือ email
      await axios.post('/api/register', {
        ...formData,
        userType,
        lineUserId: userId, 
        ownerName: name || 'คุณลูกค้า'
      });
      setStep(3);
    } catch (err) {
      alert("❌ บันทึกไม่สำเร็จ: " + (err.response?.data?.error || err.message));
    }
    setLoading(false);
  };

  if (!isReady) return <div className="min-h-screen flex items-center justify-center">😊 Loading...</div>;

  // --- กรณีเข้าหน้าเว็บตรงๆ โดยไม่ผ่าน LINE ---
  if (!userId && step !== 3) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 text-center">
        <div className="max-w-md bg-white p-12 rounded-[3rem] shadow-xl border border-rose-100">
          <div className="w-20 h-20 bg-rose-50 text-rose-500 rounded-full flex items-center justify-center mx-auto mb-6">
            <MessageCircle size={40} />
          </div>
          <h2 className="text-2xl font-black text-slate-900 mb-4 tracking-tight">กรุณาลงทะเบียนผ่าน LINE</h2>
          <p className="text-slate-500 mb-8 font-medium">เพื่อความปลอดภัยและการซิงค์ข้อมูลที่ถูกต้อง ระบบจำเป็นต้องเชื่อมต่อกับ LINE ของคุณก่อนครับ</p>
          <button 
            onClick={() => window.location.href = '/api/auth/line'} 
            className="w-full py-4 bg-[#06C755] text-white rounded-2xl font-black shadow-lg"
          >
            ไปที่หน้า LINE Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] py-12 px-6 font-sans text-slate-900">
      <div className="max-w-xl mx-auto">
        <header className="text-center mb-12 animate-in fade-in duration-700">
          <h1 className="text-3xl font-black italic tracking-tighter">SME REGISTRATION</h1>
          <div className="flex items-center justify-center gap-2 mt-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-indigo-500 bg-indigo-50 px-3 py-1 rounded-full">LINE CONNECTED</span>
          </div>
        </header>
        
        {/* Progress Bar */}
        <div className="flex items-center justify-between mb-12 px-8">
          {[1, 2, 3].map((num) => (
            <div key={num} className="flex items-center">
              <div className={`w-10 h-10 rounded-2xl flex items-center justify-center font-bold transition-all ${step >= num ? 'bg-indigo-600 text-white shadow-xl shadow-indigo-100' : 'bg-white text-slate-300 border-2 border-slate-50'}`}>
                {step > num ? <CheckCircle2 size={20}/> : num}
              </div>
              {num < 3 && <div className={`w-12 md:w-24 h-1 mx-2 rounded-full ${step > num ? 'bg-indigo-600' : 'bg-slate-100'}`} />}
            </div>
          ))}
        </div>

        <div className="bg-white rounded-[3.5rem] shadow-2xl shadow-slate-200/50 p-10 md:p-14 border border-slate-50 overflow-hidden relative">
          {step === 1 && (
            <div className="animate-in slide-in-from-right-8 duration-500">
              <h2 className="text-3xl font-black mb-10 text-slate-900 tracking-tight">ข้อมูลร้านค้า</h2>
              <div className="space-y-6">
                <div className="flex gap-2 p-1.5 bg-slate-100 rounded-2xl">
                  <button onClick={() => setUserType('individual')} className={`flex-1 py-3 rounded-xl font-bold transition-all ${userType === 'individual' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-400'}`}>บุคคลธรรมดา</button>
                  <button onClick={() => setUserType('corporate')} className={`flex-1 py-3 rounded-xl font-bold transition-all ${userType === 'corporate' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-400'}`}>นิติบุคคล</button>
                </div>
                <div className="relative group">
                  <Store className="absolute left-5 top-5 text-slate-300 group-focus-within:text-indigo-500 transition-colors" size={20}/>
                  <input required placeholder="ชื่อร้านค้า / บริษัท" className="w-full pl-14 pr-6 py-5 bg-slate-50 border-2 border-slate-50 rounded-2xl focus:bg-white focus:border-indigo-500 outline-none transition-all font-bold text-lg" 
                    onChange={(e) => setFormData({...formData, shopName: e.target.value})} />
                </div>
                {userType === 'corporate' && (
                  <div className="relative group animate-in zoom-in-95 duration-300">
                    <Landmark className="absolute left-5 top-5 text-slate-300 group-focus-within:text-indigo-500 transition-colors" size={20}/>
                    <input required placeholder="เลขประจำตัวผู้เสียภาษี 13 หลัก" className="w-full pl-14 pr-6 py-5 bg-slate-50 border-2 border-slate-50 rounded-2xl focus:bg-white focus:border-indigo-500 outline-none transition-all font-mono font-bold" 
                      onChange={(e) => setFormData({...formData, taxId: e.target.value})} />
                  </div>
                )}
                <button onClick={() => setStep(2)} disabled={!formData.shopName} className="w-full py-5 bg-slate-900 text-white rounded-2xl font-black text-lg flex items-center justify-center gap-3 hover:bg-indigo-600 shadow-xl shadow-slate-200 mt-6 disabled:opacity-50 transition-all">
                  ถัดไป <ChevronRight size={20}/>
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="animate-in slide-in-from-right-8 duration-500">
              <h2 className="text-3xl font-black mb-10 text-slate-900 tracking-tight italic">Contact & Sync</h2>
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="relative group">
                  <Mail className="absolute left-5 top-5 text-slate-300 group-focus-within:text-indigo-500 transition-colors" size={20}/>
                  <input required type="email" placeholder="อีเมลสำหรับ Google Drive" className="w-full pl-14 pr-6 py-5 bg-slate-50 border-2 border-slate-50 rounded-2xl focus:bg-white focus:border-indigo-500 outline-none transition-all font-bold" 
                    onChange={(e) => setFormData({...formData, email: e.target.value})} />
                </div>
                <div className="relative group">
                  <Phone className="absolute left-5 top-5 text-slate-300 group-focus-within:text-indigo-500 transition-colors" size={20}/>
                  <input required placeholder="เบอร์โทรศัพท์" className="w-full pl-14 pr-6 py-5 bg-slate-50 border-2 border-slate-50 rounded-2xl focus:bg-white focus:border-indigo-500 outline-none transition-all font-bold font-mono" 
                    onChange={(e) => setFormData({...formData, phone: e.target.value})} />
                </div>
                <div className="relative group">
                  <MapPin className="absolute left-5 top-5 text-slate-300 group-focus-within:text-indigo-500 transition-colors" size={20}/>
                  <textarea required placeholder="ที่อยู่ร้านค้า" className="w-full pl-14 pr-6 py-5 bg-slate-50 border-2 border-slate-50 rounded-2xl focus:bg-white focus:border-indigo-500 outline-none transition-all font-bold h-32" 
                    onChange={(e) => setFormData({...formData, address: e.target.value})} />
                </div>
                <div className="flex gap-4 pt-4">
                   <button type="button" onClick={() => setStep(1)} className="flex-1 py-5 bg-slate-50 text-slate-400 rounded-2xl font-bold hover:bg-slate-100 transition-all">ย้อนกลับ</button>
                   <button type="submit" disabled={loading} className="flex-[2] py-5 bg-indigo-600 text-white rounded-2xl font-black text-lg flex items-center justify-center gap-3 shadow-xl shadow-indigo-100">
                    {loading ? "กำลังบันทึก..." : "ยืนยันการลงทะเบียน"} <ChevronRight size={20}/>
                   </button>
                </div>
              </form>
            </div>
          )}

          {step === 3 && (
            <div className="text-center animate-in zoom-in-95 duration-500 pt-6">
              <div className="w-24 h-24 bg-emerald-50 text-emerald-600 rounded-[2.5rem] flex items-center justify-center mx-auto mb-10 shadow-inner">
                <CheckCircle2 size={48} strokeWidth={3} />
              </div>
              <h2 className="text-4xl font-black mb-4 text-slate-900 tracking-tight italic">Success!</h2>
              <p className="text-slate-500 mb-10 font-medium">ร้าน <span className="text-indigo-600 font-bold">{formData.shopName}</span> เชื่อมต่อ LINE สำเร็จ</p>
              
              <div className="bg-slate-50 p-8 rounded-[2rem] mb-10 text-left border border-slate-100">
                <h4 className="font-black text-slate-900 flex items-center gap-2 mb-2 uppercase text-[10px] tracking-widest"><ShieldCheck size={18} className="text-emerald-500"/> สำคัญมาก</h4>
                <p className="text-sm text-slate-500 font-medium leading-relaxed">ข้อมูลของคุณผูกกับ LINE ID เรียบร้อยแล้ว ต่อไปให้ไปที่หน้า Dashboard เพื่อเชื่อมต่อ Google Sheet สำหรับบันทึกบัญชีครับ</p>
              </div>

              <button 
                onClick={() => router.push(`/dashboard?userId=${userId}`)} 
                className="w-full py-6 bg-slate-900 text-white rounded-[2rem] font-black text-xl shadow-2xl shadow-slate-200 hover:scale-[1.02] active:scale-95 transition-all"
              >
                เข้าสู่หน้า Dashboard
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}