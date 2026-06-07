import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';

export default function PaymentSuccess() {
  const router = useRouter();
  const { session_id } = router.query;
  const [countdown, setCountdown] = useState(5);

  useEffect(() => {
    if (!router.isReady) return;
    const timer = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) {
          clearInterval(timer);
          router.push('/dashboard');
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [router.isReady]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-950 to-blue-900 flex items-center justify-center font-sans px-6">
      <Head><title>ชำระเงินสำเร็จ | Smile Slip Pro</title></Head>
      <div className="bg-white rounded-3xl p-12 max-w-md w-full text-center shadow-2xl">
        <div className="w-20 h-20 bg-emerald-50 rounded-3xl flex items-center justify-center mx-auto mb-6">
          <CheckCircle2 size={48} className="text-emerald-500" strokeWidth={2}/>
        </div>
        <h1 className="text-2xl font-black text-slate-900 mb-2">ชำระเงินสำเร็จ!</h1>
        <p className="text-slate-500 text-sm mb-2">ระบบกำลังอัปเดตเครดิตและแพ็กเกจของคุณ</p>
        <p className="text-slate-400 text-xs mb-8">อาจใช้เวลา 1-2 นาทีก่อนที่การเปลี่ยนแปลงจะมีผล</p>
        <p className="text-blue-600 font-bold text-sm mb-6">
          กลับแดชบอร์ดใน {countdown} วินาที...
        </p>
        <Link href="/dashboard" className="w-full inline-block py-3 bg-blue-900 text-white rounded-xl font-black text-sm hover:bg-blue-700 transition-all">
          กลับแดชบอร์ดทันที
        </Link>
      </div>
    </div>
  );
}
