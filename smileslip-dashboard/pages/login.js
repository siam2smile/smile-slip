import { useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import Script from 'next/script';
import { Mail, Lock, ChevronRight, Eye, EyeOff } from 'lucide-react';
import axios from 'axios';

export default function LoginPage() {
  const router = useRouter();
  const [liffFailed, setLiffFailed] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // เรียกหลัง LIFF SDK โหลดจาก CDN สำเร็จ
  const initLiff = async () => {
    try {
      await window.liff.init({ liffId: process.env.NEXT_PUBLIC_LIFF_ID });

      if (!window.liff.isLoggedIn()) {
        window.liff.login();
        return;
      }

      const profile = await window.liff.getProfile();
      const lineUserId = profile.userId;
      const displayName = profile.displayName;

      // เช็คว่ามีบัญชีในระบบหรือยัง
      const res = await fetch(`/api/auth/check-user?userId=${lineUserId}`);
      const { exists } = await res.json();

      if (exists) {
        router.push(`/dashboard?userId=${lineUserId}`);
      } else {
        router.push(`/register?userId=${lineUserId}&name=${encodeURIComponent(displayName)}`);
      }
    } catch (err) {
      console.error('LIFF init error:', err);
      setLiffFailed(true);
    }
  };

  const handleEmailLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await axios.post('/api/auth/email-login', { email, password });
      if (res.data.userId) router.push(`/dashboard?userId=${res.data.userId}`);
    } catch (err) {
      setError(err.response?.data?.error || 'เกิดข้อผิดพลาด กรุณาลองใหม่');
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-950 via-blue-900 to-blue-800 flex flex-col justify-center items-center px-6 py-12 font-sans">
      <Head><title>เข้าสู่ระบบ | Smile Slip Pro</title></Head>

      {/* โหลด LIFF SDK จาก CDN — ไม่ต้องติดตั้ง npm package */}
      <Script
        src="https://static.line-scdn.net/liff/edge/2/sdk.js"
        strategy="afterInteractive"
        onLoad={initLiff}
        onError={() => setLiffFailed(true)}
      />

      {/* Logo */}
      <div className="text-center mb-8">
        <div className="text-5xl mb-3">😊</div>
        <h1 className="text-white font-black text-2xl">Smile Slip <span className="text-blue-300 font-medium">Pro</span></h1>
        <p className="text-blue-400 text-sm mt-1">ระบบจัดการสลิปอัจฉริยะสำหรับธุรกิจไทย</p>
      </div>

      <div className="max-w-md w-full bg-white rounded-3xl shadow-2xl shadow-blue-950/50 p-8">

        {/* กำลังเชื่อมต่อ LINE */}
        {!liffFailed ? (
          <div className="text-center py-6">
            <div className="text-4xl mb-4 animate-bounce">😊</div>
            <h2 className="text-lg font-black text-slate-900 mb-1">กำลังเชื่อมต่อกับ LINE...</h2>
            <p className="text-slate-400 text-sm mb-6">กรุณารอสักครู่</p>
            <div className="flex gap-1.5 justify-center">
              <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}/>
              <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}/>
              <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}/>
            </div>
            <p className="text-xs text-slate-300 mt-6">
              เข้าไม่ได้?{' '}
              <button onClick={() => setLiffFailed(true)} className="text-blue-600 font-bold underline">
                เข้าด้วยอีเมลแทน
              </button>
            </p>
          </div>
        ) : (
          /* Fallback: Email Login */
          <>
            <h2 className="text-lg font-black text-slate-900 mb-1">เข้าสู่ระบบด้วยอีเมล</h2>
            <p className="text-slate-400 text-xs mb-6">
              <button onClick={() => { setLiffFailed(false); window.location.reload(); }}
                className="text-blue-600 font-bold underline underline-offset-2">
                ลองเชื่อมต่อ LINE อีกครั้ง
              </button>
              {' '}หรือกรอกอีเมล + รหัสผ่านด้านล่าง
            </p>

            <form onSubmit={handleEmailLogin} className="space-y-3">
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-600 text-xs font-bold px-4 py-3 rounded-xl">
                  {error}
                </div>
              )}

              <div className="relative group">
                <Mail className="absolute left-4 top-3.5 text-slate-300 group-focus-within:text-blue-500 transition-colors" size={17}/>
                <input required type="email" placeholder="อีเมลที่ลงทะเบียนไว้"
                  className="w-full pl-11 pr-4 py-3.5 bg-slate-50 border-2 border-transparent rounded-xl focus:bg-white focus:border-blue-500 outline-none transition-all font-bold text-sm"
                  value={email} onChange={e => setEmail(e.target.value)}/>
              </div>

              <div className="relative group">
                <Lock className="absolute left-4 top-3.5 text-slate-300 group-focus-within:text-blue-500 transition-colors" size={17}/>
                <input required type={showPassword ? 'text' : 'password'} placeholder="รหัสผ่าน"
                  className="w-full pl-11 pr-11 py-3.5 bg-slate-50 border-2 border-transparent rounded-xl focus:bg-white focus:border-blue-500 outline-none transition-all font-bold text-sm"
                  value={password} onChange={e => setPassword(e.target.value)}/>
                <button type="button" onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-3.5 text-slate-300 hover:text-slate-600">
                  {showPassword ? <EyeOff size={17}/> : <Eye size={17}/>}
                </button>
              </div>

              <button type="submit" disabled={loading}
                className="w-full py-3.5 bg-blue-900 hover:bg-blue-700 text-white rounded-xl font-black flex items-center justify-center gap-2 transition-all shadow-lg disabled:opacity-50 text-sm">
                {loading ? 'กำลังตรวจสอบ...' : 'เข้าสู่ระบบ'} <ChevronRight size={17}/>
              </button>
            </form>
          </>
        )}

        <p className="mt-5 text-center text-[10px] text-slate-400">
          <Link href="/terms" className="underline hover:text-blue-600">เงื่อนไขการใช้บริการ</Link>
          {' '}·{' '}
          <Link href="/privacy" className="underline hover:text-blue-600">ความเป็นส่วนตัว</Link>
        </p>
      </div>
    </div>
  );
}
