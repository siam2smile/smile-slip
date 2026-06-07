import Head from 'next/head';
import Link from 'next/link';

export default function Custom404() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-950 to-blue-900 flex flex-col items-center justify-center font-sans text-white px-6">
      <Head><title>404 — ไม่พบหน้านี้ | Smile Slip Pro</title></Head>
      <div className="text-center">
        <div className="text-7xl mb-6">😕</div>
        <h1 className="text-6xl font-black mb-3 tracking-tighter">404</h1>
        <p className="text-blue-300 text-lg font-medium mb-2">ไม่พบหน้าที่คุณต้องการ</p>
        <p className="text-blue-400 text-sm mb-10">หน้านี้อาจถูกลบหรือย้ายไปแล้ว</p>
        <div className="flex gap-4 justify-center">
          <Link href="/" className="px-8 py-3 bg-white text-blue-900 rounded-2xl font-black text-sm hover:bg-blue-50 transition-all shadow-lg">
            กลับหน้าหลัก
          </Link>
          <Link href="/login" className="px-8 py-3 bg-blue-800 text-white rounded-2xl font-black text-sm hover:bg-blue-700 transition-all">
            เข้าสู่ระบบ
          </Link>
        </div>
      </div>
    </div>
  );
}
