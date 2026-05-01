import React, { useState } from 'react';
import { useRouter } from 'next/router';
import { MessageCircle, Mail, ChevronRight, ArrowLeft } from 'lucide-react';
import axios from 'axios';
import Link from 'next/link';

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLineLogin = () => {
    const clientId = "2009797558";
    const redirectUri = "https://smileslip-dashboard-832247688217.asia-southeast1.run.app/api/auth/callback/line";
    const lineUrl = `https://access.line.me/oauth2/v2.1/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=smile123&scope=profile%20openid%20email&bot_prompt=normal`;
    window.location.href = lineUrl;
  };

  const handleEmailLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      // ส่งไปเช็คที่ API ว่าอีเมลนี้มีในระบบไหม
      const res = await axios.post('/api/auth/email-login', { email });
      if (res.data.userId) {
        router.push(`/dashboard?userId=${res.data.userId}`);
      }
    } catch (err) {
      alert("ไม่พบข้อมูลผู้ใช้งานด้วยอีเมลนี้ กรุณาลงทะเบียนก่อนครับ 😊");
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col justify-center items-center px-6 py-12 font-sans relative">
      <Link href="/" className="absolute top-8 left-8 text-slate-400 hover:text-indigo-600 transition-colors flex items-center gap-2 font-bold uppercase text-[10px] tracking-widest">
        <ArrowLeft size={16}/> Back to Home
      </Link>

      <div className="max-w-md w-full bg-white rounded-[3rem] shadow-2xl shadow-slate-200/50 p-12 border border-slate-50 relative overflow-hidden">
        <div className="text-center mb-10">
          <div className="text-5xl mb-4">😊</div>
          <h2 className="text-3xl font-black text-slate-900 tracking-tight italic">Welcome Back</h2>
          <p className="text-slate-400 font-medium">เลือกวิธีเข้าใช้งานระบบของคุณ</p>
        </div>

        {/* LINE LOGIN */}
        <button 
          onClick={handleLineLogin} 
          className="w-full bg-[#06C755] text-white font-black py-5 rounded-2xl flex items-center justify-center gap-3 shadow-xl shadow-green-100 hover:scale-[1.02] active:scale-95 transition-all mb-10"
        >
          <MessageCircle fill="white" size={24} />
          เข้าสู่ระบบด้วย LINE
        </button>

        <div className="relative mb-10">
          <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-100"></div></div>
          <div className="relative flex justify-center text-[10px] uppercase font-black tracking-[0.3em] text-slate-300"><span className="bg-white px-4">หรือใช้อีเมล</span></div>
        </div>

        {/* EMAIL LOGIN */}
        <form onSubmit={handleEmailLogin} className="space-y-4">
          <div className="relative group">
            <Mail className="absolute left-4 top-4 text-slate-300 group-focus-within:text-indigo-500 transition-colors" size={20}/>
            <input 
              required 
              type="email" 
              placeholder="ใส่อีเมลที่คุณลงทะเบียนไว้" 
              className="w-full pl-12 pr-4 py-4 bg-slate-50 border-2 border-slate-50 rounded-2xl focus:bg-white focus:border-indigo-500 outline-none transition-all font-bold"
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <button 
            disabled={loading}
            className="w-full py-5 bg-slate-900 text-white rounded-2xl font-black flex items-center justify-center gap-3 hover:bg-indigo-600 transition-all shadow-xl shadow-slate-200"
          >
            {loading ? "กำลังตรวจสอบ..." : "เข้าสู่ระบบ"} <ChevronRight size={20}/>
          </button>
        </form>

        <p className="mt-10 text-center text-slate-400 text-sm font-medium">
          ยังไม่มีบัญชี? <Link href="/register" className="text-indigo-600 font-black underline underline-offset-4">สร้างบัญชีใหม่</Link>
        </p>
      </div>
    </div>
  );
}