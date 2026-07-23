import { useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import Script from 'next/script';
import { Mail, Lock, ChevronRight, Eye, EyeOff, MessageCircle } from 'lucide-react';
import axios from 'axios';

export default function LoginPage() {
  const router = useRouter();
  // 'loading' | 'options' | 'confirm' | 'email'
  const [view, setView] = useState('loading');
  const [pendingProfile, setPendingProfile] = useState(null); // { userId, displayName, pictureUrl } รอผู้ใช้ยืนยันว่าใช่บัญชีนี้
  const [switching, setSwitching] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [error, setError] = useState('');

  // ตรวจ userId กับระบบแล้วพาไปหน้าที่ถูกต้อง — แยกออกมาต่างหากเพื่อให้เรียกซ้ำได้ทั้งจาก
  // ปุ่ม LINE ตรงๆ (user gesture ชัดเจน ไม่ต้อง confirm ซ้ำ) และจากหน้ายืนยันบัญชี (หลังกด "ใช่")
  const proceedWithProfile = async (profile) => {
    try {
      const res = await fetch(`/api/auth/check-user?userId=${profile.userId}`);
      const data = await res.json();

      // รองรับ ?next=pricing ฯลฯ
      const next = router.query.next;
      if (data.exists) {
        if (data.role === 'admin') {
          router.push(`/dashboard?userId=${data.ownerId}&adminId=${profile.userId}`);
        } else if (next) {
          router.push(`/${next}?userId=${profile.userId}`);
        } else {
          router.push(`/dashboard?userId=${profile.userId}`);
        }
      } else {
        router.push(`/register?userId=${profile.userId}&name=${encodeURIComponent(profile.displayName)}`);
      }
    } catch (err) {
      console.error('LINE login error:', err);
      // LIFF ล้มเหลว → fallback LINE OAuth (ไม่ค้างหน้าเดิม)
      window.location.href = '/api/auth/line';
    }
  };

  // เรียกเมื่อผู้ใช้กดปุ่ม "เข้าสู่ระบบด้วย LINE" เอง (user gesture ชัดเจนอยู่แล้วว่าตั้งใจเข้าบัญชีนี้)
  const doLineLogin = async () => {
    try {
      // ถ้า LIFF SDK ยังไม่โหลด → ใช้ LINE OAuth ธรรมดา (แสดง QR บน desktop เหมือนกัน)
      if (!window.liff) {
        window.location.href = '/api/auth/line';
        return;
      }
      if (!window.liff.isLoggedIn()) {
        // user gesture → LINE redirect → desktop แสดง QR code ให้สแกน
        window.liff.login();
        return;
      }
      const profile = await window.liff.getProfile();
      await proceedWithProfile(profile);
    } catch (err) {
      console.error('LINE login error:', err);
      window.location.href = '/api/auth/line';
    }
  };

  // ผู้ใช้กด "ไม่ใช่บัญชีนี้" ในหน้ายืนยัน — ล้าง session LIFF ของเบราว์เซอร์นี้ทิ้ง แล้วรีโหลด
  // ให้กลับไปเจอหน้าตัวเลือกเข้าสู่ระบบใหม่ (กดปุ่ม LINE อีกครั้งจะให้เลือก/ล็อกอินบัญชีใหม่ได้)
  const switchAccount = async () => {
    setSwitching(true);
    try {
      if (window.liff?.logout) window.liff.logout();
    } catch {}
    window.location.reload();
  };

  // เรียกหลัง LIFF SDK โหลดจาก CDN สำเร็จ
  const initLiff = async () => {
    // timeout 8 วิ — ถ้า LIFF ค้างให้แสดงหน้าตัวเลือก
    const fallbackTimer = setTimeout(() => setView('options'), 8000);
    try {
      await window.liff.init({ liffId: process.env.NEXT_PUBLIC_LIFF_ID });
      clearTimeout(fallbackTimer);

      // อยู่ใน LINE app เอง → auto-login ได้เลย ไม่ต้องถามยืนยัน เพราะ LIFF ผูกกับบัญชีที่
      // เปิดแอป LINE อยู่ตรงๆ อยู่แล้ว ไม่มีทางสลับบัญชีผิดจากตรงนี้
      if (window.liff.isInClient()) {
        await doLineLogin();
        return;
      }

      // เปิดผ่านเบราว์เซอร์ + เคย login ค้างไว้จากรอบก่อน — เดิม auto เข้าระบบทันทีโดยไม่ถาม
      // ทำให้เผลอเข้าบัญชีเดิมตอนตั้งใจจะสลับบัญชี → เปลี่ยนเป็นถามยืนยันก่อนเสมอ
      if (window.liff.isLoggedIn()) {
        try {
          const profile = await window.liff.getProfile();
          setPendingProfile(profile);
          setView('confirm');
        } catch {
          setView('options');
        }
        return;
      }

      // Browser + ยังไม่ login → แสดงปุ่มให้เลือก (user gesture ก่อน login)
      setView('options');
    } catch (err) {
      clearTimeout(fallbackTimer);
      setView('options');
    }
  };

  const handleEmailLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoginLoading(true);
    try {
      const res = await axios.post('/api/auth/email-login', { email, password });
      if (res.data.userId) router.push(`/dashboard?userId=${res.data.userId}`);
    } catch (err) {
      setError(err.response?.data?.error || 'เกิดข้อผิดพลาด กรุณาลองใหม่');
    }
    setLoginLoading(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-950 via-blue-900 to-blue-800 flex flex-col justify-center items-center px-6 py-12 font-sans">
      <Head><title>เข้าสู่ระบบ | Smile Slip Pro</title></Head>

      {/* โหลด LIFF SDK จาก CDN — ไม่ต้องติดตั้ง npm package */}
      <Script
        src="https://static.line-scdn.net/liff/edge/2/sdk.js"
        strategy="afterInteractive"
        onLoad={initLiff}
        onError={() => setView('options')}
      />

      {/* Logo */}
      <div className="text-center mb-8">
        <div className="text-5xl mb-3">😊</div>
        <h1 className="text-white font-black text-2xl">Smile Slip <span className="text-blue-300 font-medium">Pro</span></h1>
        <p className="text-blue-400 text-sm mt-1">ระบบจัดการสลิปอัจฉริยะสำหรับธุรกิจไทย</p>
      </div>

      <div className="max-w-md w-full bg-white rounded-3xl shadow-2xl shadow-blue-950/50 p-8">

        {/* ─── Loading ─── */}
        {view === 'loading' && (
          <div className="text-center py-6">
            <div className="text-4xl mb-4 animate-bounce">😊</div>
            <h2 className="text-lg font-black text-slate-900 mb-1">กำลังโหลด...</h2>
            <p className="text-slate-400 text-sm mb-6">กรุณารอสักครู่</p>
            <div className="flex gap-1.5 justify-center">
              <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}/>
              <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}/>
              <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}/>
            </div>
          </div>
        )}

        {/* ─── ยืนยันบัญชี LINE (มี session ค้างในเบราว์เซอร์นี้อยู่แล้ว) ─── */}
        {view === 'confirm' && pendingProfile && (
          <div className="text-center py-2">
            <h2 className="text-lg font-black text-slate-900 mb-1">เข้าสู่ระบบด้วยบัญชีนี้ใช่ไหม?</h2>
            <p className="text-slate-400 text-xs mb-5">เบราว์เซอร์นี้ล็อกอิน LINE ค้างไว้อยู่แล้ว</p>

            <div className="flex flex-col items-center gap-2 mb-6">
              {pendingProfile.pictureUrl && (
                <img src={pendingProfile.pictureUrl} alt="" className="w-16 h-16 rounded-full border-4 border-blue-50 shadow"/>
              )}
              <p className="font-black text-slate-900 text-sm">{pendingProfile.displayName}</p>
            </div>

            <button onClick={() => proceedWithProfile(pendingProfile)}
              className="w-full py-3.5 bg-[#06C755] hover:bg-[#05b34c] text-white rounded-xl font-bold text-sm transition-all shadow-lg mb-3">
              ✅ ใช่ เข้าสู่ระบบด้วยบัญชีนี้
            </button>
            <button onClick={switchAccount} disabled={switching}
              className="w-full py-3.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl font-bold text-sm transition-all disabled:opacity-50">
              {switching ? 'กำลังออกจากระบบ...' : '🔄 ไม่ใช่ ต้องการเปลี่ยนบัญชี LINE'}
            </button>
          </div>
        )}

        {/* ─── ตัวเลือก Login ─── */}
        {view === 'options' && (
          <div className="space-y-4">
            <div className="text-center mb-6">
              <h2 className="text-xl font-black text-slate-900 mb-1">เข้าสู่ระบบ</h2>
              <p className="text-slate-400 text-xs">เลือกวิธีเข้าสู่ระบบ</p>
            </div>

            {/* ปุ่ม LINE — user gesture → LINE redirect → desktop แสดง QR */}
            <button onClick={doLineLogin}
              className="w-full flex items-center justify-center gap-3 py-3.5 bg-[#06C755] hover:bg-[#05b34c] text-white rounded-xl font-bold text-sm transition-all shadow-lg">
              <MessageCircle size={18}/>
              เข้าสู่ระบบด้วย LINE
            </button>

            <div className="flex items-center gap-3 my-2">
              <div className="flex-1 h-px bg-slate-100"/>
              <span className="text-xs text-slate-300 font-medium">หรือ</span>
              <div className="flex-1 h-px bg-slate-100"/>
            </div>

            <button onClick={() => setView('email')}
              className="w-full flex items-center justify-center gap-2 py-3.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl font-bold text-sm transition-all">
              <Mail size={16}/>
              เข้าสู่ระบบด้วยอีเมล
            </button>
          </div>
        )}

        {/* ─── Email Login ─── */}
        {view === 'email' && (
          <>
            <div className="flex items-center gap-2 mb-5">
              <button onClick={() => setView('options')} className="text-blue-600 hover:text-blue-700 text-lg">
                ←
              </button>
              <h2 className="text-lg font-black text-slate-900">เข้าสู่ระบบด้วยอีเมล</h2>
            </div>

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

              <button type="submit" disabled={loginLoading}
                className="w-full py-3.5 bg-blue-800 hover:bg-blue-700 text-white rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg disabled:opacity-50 text-sm">
                {loginLoading ? 'กำลังตรวจสอบ...' : 'เข้าสู่ระบบ'} <ChevronRight size={17}/>
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
