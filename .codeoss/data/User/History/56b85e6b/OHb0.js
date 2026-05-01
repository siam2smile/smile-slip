import React from 'react';
import { MessageCircle } from 'lucide-react';

export default function Login() {
  const handleLineLogin = () => {
    const clientId = "2009797558";
    const redirectUri = "https://smileslip-dashboard-832247688217.asia-southeast1.run.app/api/auth/callback/line";
    const lineUrl = `https://access.line.me/oauth2/v2.1/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=smile123&scope=profile%20openid%20email&bot_prompt=normal`;
    window.location.href = lineUrl;
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center px-6 text-center">
      <div className="max-w-md w-full bg-white rounded-3xl shadow-2xl p-10 border border-indigo-50">
        <div className="text-6xl mb-6">😊</div>
        <h2 className="text-3xl font-bold text-slate-900 mb-2">Smile Slip Pro</h2>
        <p className="text-slate-500 mb-10 text-lg italic text-balance">"ระบบจัดการบัญชีที่ทำให้คุณยิ้มได้"</p>
        <button 
          onClick={handleLineLogin} 
          className="w-full bg-[#06C755] hover:bg-[#05b34c] text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-3 shadow-lg transition-transform active:scale-95"
        >
          <MessageCircle fill="white" size={24} />
          เข้าสู่ระบบด้วย LINE
        </button>
      </div>
    </div>
  );
}
