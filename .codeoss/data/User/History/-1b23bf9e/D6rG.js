import React from 'react';
import Link from 'next/link';
import { ChevronRight, ShieldCheck, Zap } from 'lucide-react';

export default function Home() {
  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col items-center justify-center font-sans px-6 relative overflow-hidden">
      {/* Background Decor */}
      <div className="absolute top-[-10%] right-[-10%] w-96 h-96 bg-indigo-50 rounded-full blur-3xl opacity-50"></div>
      <div className="absolute bottom-[-10%] left-[-10%] w-96 h-96 bg-blue-50 rounded-full blur-3xl opacity-50"></div>

      <div className="z-10 text-center">
        <div className="w-24 h-24 bg-white rounded-[2.5rem] flex items-center justify-center text-4xl shadow-2xl shadow-indigo-100 mx-auto mb-8 border border-slate-50">😊</div>
        <h1 className="text-6xl font-black text-slate-900 mb-4 italic tracking-tighter">
          SMILE SLIP <span className="text-indigo-600">PRO</span>
        </h1>
        <p className="text-slate-500 mb-12 text-xl font-medium max-w-md mx-auto leading-relaxed">
          พนักงานบัญชี AI อัจฉริยะ <br/>
          <span className="text-slate-400 text-sm uppercase tracking-[0.3em]">โดย สยาม โกลบอล เน็ทเวิร์คฯ</span>
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
          <Link href="/login" className="w-full sm:w-auto px-10 py-5 bg-slate-900 text-white rounded-2xl font-black shadow-2xl shadow-slate-200 hover:bg-indigo-600 transition-all flex items-center justify-center gap-2 group">
            เข้าสู่ระบบ <ChevronRight size={20} className="group-hover:translate-x-1 transition-transform"/>
          </Link>
          <Link href="/register" className="w-full sm:w-auto px-10 py-5 bg-white text-slate-900 border-2 border-slate-100 rounded-2xl font-black shadow-sm hover:border-indigo-200 transition-all">
            ลงทะเบียนร้านค้า
          </Link>
        </div>

        <div className="mt-16 flex gap-8 justify-center text-slate-400">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest"><ShieldCheck size={16}/> Secure</div>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest"><Zap size={16}/> Fast Sync</div>
        </div>
      </div>
    </div>
  );
}