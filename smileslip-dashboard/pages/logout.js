/**
 * หน้า Logout — เรียก liff.logout() เพื่อ clear LINE session ก่อน redirect ไป /login
 */
import { useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Script from 'next/script';

export default function Logout() {
  const router = useRouter();

  const doLogout = () => {
    try {
      if (window.liff) {
        window.liff.init({ liffId: process.env.NEXT_PUBLIC_LIFF_ID }).then(() => {
          if (window.liff.isLoggedIn()) window.liff.logout();
        }).catch(() => {}).finally(() => router.replace('/login'));
      } else {
        router.replace('/login');
      }
    } catch {
      router.replace('/login');
    }
  };

  // fallback: ถ้า SDK ไม่โหลดใน 3 วิ ให้ redirect เลย
  useEffect(() => {
    const t = setTimeout(() => router.replace('/login'), 3000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-950 to-blue-900 flex items-center justify-center font-sans">
      <Head><title>กำลังออกจากระบบ | Smile Slip Pro</title></Head>
      <Script
        src="https://static.line-scdn.net/liff/edge/2/sdk.js"
        strategy="afterInteractive"
        onLoad={doLogout}
        onError={() => router.replace('/login')}
      />
      <div className="text-center text-white">
        <div className="text-4xl mb-4 animate-pulse">😊</div>
        <p className="text-sm text-blue-300">กำลังออกจากระบบ...</p>
      </div>
    </div>
  );
}
