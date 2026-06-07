import React from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { ChevronRight, ShieldCheck, Zap, FileSpreadsheet, MessageCircle } from 'lucide-react';

export default function Home() {
  return (
    <>
      <Head>
        <title>Smile Slip Pro — AI ตรวจสลิปอัตโนมัติสำหรับ SME ไทย</title>
        <meta name="description" content="ระบบตรวจสอบสลิปโอนเงินอัตโนมัติด้วย AI บน LINE บันทึกลง Google Sheets และ Google Drive ทันที เหมาะสำหรับร้านค้าและ SME ไทย"/>
        <meta name="keywords" content="ตรวจสลิป, LINE Bot, บัญชีร้านค้า, SME ไทย, Google Sheets, AI"/>
        <meta property="og:title" content="Smile Slip Pro — AI ตรวจสลิปอัตโนมัติ"/>
        <meta property="og:description" content="พนักงานส่งสลิปใน LINE บอทอ่าน OCR บันทึกบัญชีอัตโนมัติ"/>
        <meta property="og:type" content="website"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
      </Head>

      <div className="min-h-screen bg-gradient-to-br from-blue-950 via-blue-900 to-blue-800 flex flex-col items-center justify-center font-sans px-6 relative overflow-hidden">
        {/* Decorative blobs */}
        <div className="absolute top-[-10%] right-[-10%] w-96 h-96 bg-blue-700/20 rounded-full blur-3xl"/>
        <div className="absolute bottom-[-10%] left-[-10%] w-96 h-96 bg-indigo-600/20 rounded-full blur-3xl"/>

        <div className="z-10 text-center max-w-2xl">
          <div className="w-24 h-24 bg-white/10 backdrop-blur rounded-[2rem] flex items-center justify-center text-4xl shadow-2xl mx-auto mb-8 border border-white/20">
            😊
          </div>

          <h1 className="text-5xl md:text-6xl font-black text-white mb-4 tracking-tighter">
            SMILE SLIP <span className="text-blue-300">PRO</span>
          </h1>
          <p className="text-blue-200 mb-3 text-lg font-medium">
            AI ตรวจสลิปอัตโนมัติ · บันทึกบัญชีทันที · สำหรับ SME ไทย
          </p>
          <p className="text-blue-400 text-sm mb-10 uppercase tracking-[0.3em]">
            โดย บริษัท สยาม โกลบอล เน็ทเวิร์ค เอ็นเตอร์ไพรส์ จำกัด
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-14">
            <Link href="/login"
              className="px-10 py-4 bg-white text-blue-900 rounded-2xl font-black shadow-2xl hover:bg-blue-50 transition-all flex items-center justify-center gap-2 group text-sm">
              เข้าสู่ระบบ <ChevronRight size={18} className="group-hover:translate-x-1 transition-transform"/>
            </Link>
            <Link href="/login"
              className="px-10 py-4 bg-white/10 border border-white/20 text-white rounded-2xl font-black hover:bg-white/20 transition-all text-sm backdrop-blur">
              ลงทะเบียนร้านค้า (ผ่าน LINE)
            </Link>
          </div>

          {/* Features row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { icon: <MessageCircle size={18}/>, label: 'ส่งสลิปใน LINE' },
              { icon: <Zap size={18}/>, label: 'AI อ่านทันที' },
              { icon: <FileSpreadsheet size={18}/>, label: 'บันทึก Google Sheets' },
              { icon: <ShieldCheck size={18}/>, label: 'ปลอดภัย PDPA' },
            ].map((f, i) => (
              <div key={i} className="bg-white/10 backdrop-blur border border-white/10 rounded-2xl p-4 text-center">
                <div className="text-blue-300 flex justify-center mb-2">{f.icon}</div>
                <p className="text-white text-xs font-bold">{f.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
