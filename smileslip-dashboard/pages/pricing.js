import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { CheckCircle, Zap, Shield, Building2, CreditCard, ArrowLeft } from 'lucide-react';

export default function PricingPage() {
  const router = useRouter();
  const [isYearly, setIsYearly] = useState(false);
  const [shopId, setShopId] = useState(null);
  const [loadingPriceId, setLoadingPriceId] = useState(null);
  const { userId } = router.query;

  useEffect(() => {
    if (userId) {
      fetch(`/api/shop/data?userId=${encodeURIComponent(userId)}`)
        .then(r => r.json())
        .then(d => { if (d.profile?.id) setShopId(d.profile.id); });
    }
  }, [userId]);

  const handleCheckout = async (priceId) => {
    if (!shopId) {
      alert("ไม่พบข้อมูลร้านค้า กรุณาเข้าสู่ระบบผ่านแดชบอร์ดใหม่อีกครั้งครับ");
      return;
    }
    setLoadingPriceId(priceId);
    try {
      // ยิงข้อมูลไปหาเซิร์ฟเวอร์หลังบ้านฝั่ง Stripe ที่เราเตรียมไว้เรียบร้อยแล้ว
      const response = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priceId, shopId }),
      });
      const data = await response.json();
      if (data.url) window.location.href = data.url;
      else alert('เกิดข้อผิดพลาด: ' + (data.error || 'ไม่สามารถสร้าง session ได้'));
    } catch (error) {
      console.error("Checkout link error:", error);
      alert('เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง');
    } finally {
      setLoadingPriceId(null);
    }
  };

  const plans = [
    {
      name: "Normal", target: "ร้านค้าเริ่มต้น", monthlyPrice: 0, yearlyPrice: 0, priceIdMonthly: null, priceIdYearly: null,
      icon: <CheckCircle className="text-slate-400" size={32} />,
      features: ["AI ตรวจสลิปอัตโนมัติ", "เชื่อมต่อ LINE 1 กลุ่ม", "บันทึก Google Sheet (รวม)", "1 สิทธิ์เข้า Dashboard"],
      color: "bg-slate-50", btnText: "ใช้งานฟรี", btnColor: "bg-slate-200 text-slate-800"
    },
    {
      name: "Shop Pro", target: "ร้านค้าที่มีลูกจ้าง", monthlyPrice: 199, yearlyPrice: 1990,
      priceIdMonthly: "price_1TfERr3ZvivzvZ6qPXOhc10t", priceIdYearly: "price_1TfERr3ZvivzvZ6qbsLKKPlV",
      icon: <Zap className="text-amber-500" size={32} />,
      features: ["ผู้ใช้ 3 คน", "สรุปยอดปิดกะรายวัน", "แจ้งเตือนยอดโอนไม่ตรง", "Smart Tagging & CRM", "แจ้งเตือนส่วนตัวเจ้าของ"],
      color: "bg-amber-50 border-amber-200", btnText: "อัปเกรดเป็น Pro", btnColor: "bg-amber-500 text-white"
    },
    {
      name: "Advance", target: "SME ที่มีนักบัญชี", monthlyPrice: 499, yearlyPrice: 4990,
      priceIdMonthly: "price_1TfERs3ZvivzvZ6qw9SB10YE", priceIdYearly: "price_1TfERs3ZvivzvZ6qPKQaBSHQ",
      icon: <Shield className="text-indigo-500" size={32} />,
      features: ["เชื่อมต่อ 5 สาขา", "ไม่จำกัดผู้ใช้งาน", "ป้องกันสลิปวนข้ามสาขา", "แท็กแยกภาษี (VAT 7%)", "Export ไฟล์ให้โปรแกรมบัญชี"],
      color: "bg-indigo-50 border-indigo-200", btnText: "อัปเกรดเป็น Advance", btnColor: "bg-indigo-600 text-white"
    },
    {
      name: "Super", target: "องค์กร & แฟรนไชส์", monthlyPrice: 2990, yearlyPrice: 29900,
      priceIdMonthly: "price_1TfERs3ZvivzvZ6qrTxPwYKs", priceIdYearly: "price_1TfERt3ZvivzvZ6qgpoAJvaU",
      icon: <Building2 className="text-emerald-500" size={32} />,
      features: ["ฟรีเครดิต 5,000 แผ่น/เดือน", "เชื่อมต่อ 20 สาขา", "กระทบยอดอัตโนมัติ (Reconcile)", "VIP Support", "รองรับคิวสลิป 500+/วัน"],
      color: "bg-emerald-50 border-emerald-200", btnText: "อัปเกรดเป็น Super", btnColor: "bg-emerald-600 text-white"
    }
  ];

  const credits = [
    { name: "Starter", amount: 100, price: 99, priceId: "price_1TfERt3ZvivzvZ6qfbOMCZnp" },
    { name: "Value", amount: 500, price: 299, priceId: "price_1TfERu3ZvivzvZ6q96qkkfKx" },
    { name: "Volume", amount: 1000, price: 499, priceId: "price_1TfERu3ZvivzvZ6qpTZDUhHZ" }
  ];

  return (
    <div className="min-h-screen bg-[#F8FAFC] font-sans pb-20">
      <div className="max-w-7xl mx-auto px-6 pt-6">
        <button onClick={() => router.push(`/dashboard?userId=${userId}`)} className="flex items-center gap-2 text-slate-500 hover:text-slate-900 font-bold transition-all mb-6">
          <ArrowLeft size={18}/> กลับไปยังแดชบอร์ด
        </button>
      </div>
      <div className="bg-slate-900 text-white py-12 text-center px-4 rounded-[3rem] shadow-2xl max-w-7xl mx-auto">
        <h1 className="text-3xl md:text-5xl font-black mb-4">เลือกแพ็กเกจที่ใช่สำหรับร้านค้าคุณ</h1>
        <div className="flex items-center justify-center gap-4 mt-8">
          <span className={!isYearly ? 'text-white' : 'text-slate-500'}>รายเดือน</span>
          <button onClick={() => setIsYearly(!isYearly)} className="w-14 h-8 bg-indigo-600 rounded-full p-1 transition-all flex">
            <div className={`w-6 h-6 bg-white rounded-full transition-transform ${isYearly ? 'translate-x-6' : ''}`}></div>
          </button>
          <span className={isYearly ? 'text-white' : 'text-slate-500'}>รายปี <span className="text-emerald-400 font-bold text-xs">(ประหยัด 2 เดือน)</span></span>
        </div>
      </div>
      <div className="max-w-7xl mx-auto px-4 -mt-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {plans.map((plan, idx) => (
          <div key={idx} className={`bg-white rounded-3xl p-8 shadow-xl border-2 transition-all flex flex-col justify-between ${plan.color}`}>
            <div>
              <div className="mb-4">{plan.icon}</div>
              <h2 className="text-xl font-black text-slate-800">{plan.name}</h2>
              <p className="text-xs text-slate-400 mb-4">{plan.target}</p>
              <div className="mb-6">
                <span className="text-3xl font-black">฿{isYearly ? plan.yearlyPrice.toLocaleString() : plan.monthlyPrice.toLocaleString()}</span>
                <span className="text-slate-400 text-sm">/{isYearly ? 'ปี' : 'เดือน'}</span>
              </div>
              <ul className="space-y-3 mb-6">
                {plan.features.map((f, i) => <li key={i} className="text-xs font-bold text-slate-600 flex gap-2">✓ {f}</li>)}
              </ul>
            </div>
            <button
              disabled={loadingPriceId !== null}
              onClick={() => plan.name !== "Normal" && handleCheckout(isYearly ? plan.priceIdYearly : plan.priceIdMonthly)}
              className={`w-full py-3 rounded-xl font-black text-sm transition-all ${plan.btnColor} ${loadingPriceId ? 'opacity-50 cursor-wait' : ''}`}
            >
              {loadingPriceId === (isYearly ? plan.priceIdYearly : plan.priceIdMonthly) ? "กำลังพาท่านไปชำระเงิน..." : plan.btnText}
            </button>
            {plan.name !== "Normal" && (
              <p className="text-center text-[10px] text-slate-400 mt-2 leading-relaxed">
                ในการชำระเงิน ท่านยอมรับ{' '}
                <a href="/terms" target="_blank" rel="noreferrer" className="underline hover:text-slate-600">เงื่อนไขการใช้บริการ</a>
                {' '}และ{' '}
                <a href="/privacy" target="_blank" rel="noreferrer" className="underline hover:text-slate-600">นโยบายความเป็นส่วนตัว</a>
              </p>
            )}
          </div>
        ))}
      </div>
      {/* ═══ เติมเครดิต (One-time) ═══ */}
      <div className="max-w-7xl mx-auto px-4 mt-20">
        <div className="text-center mb-10">
          <h2 className="text-3xl font-black text-slate-900 mb-2">เติมเครดิตตรวจสลิป</h2>
          <p className="text-slate-500 font-medium">ซื้อครั้งเดียว ไม่หมดอายุ ใช้ได้กับทุกแพ็กเกจ</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-3xl mx-auto">
          {credits.map((credit, idx) => (
            <div key={idx} className="bg-white rounded-3xl p-8 shadow-xl border-2 border-slate-100 hover:border-blue-200 transition-all flex flex-col items-center text-center">
              <div className="w-14 h-14 bg-blue-50 rounded-2xl flex items-center justify-center mb-4">
                <CreditCard className="text-blue-600" size={28}/>
              </div>
              <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mb-1">{credit.name}</p>
              <h3 className="text-4xl font-black text-slate-900 mb-1">{credit.amount.toLocaleString()}</h3>
              <p className="text-sm text-slate-400 mb-4">แผ่น</p>
              <p className="text-2xl font-black text-blue-600 mb-6">฿{credit.price}</p>
              <button
                disabled={loadingPriceId !== null}
                onClick={() => handleCheckout(credit.priceId)}
                className={`w-full py-3 rounded-xl font-black text-sm bg-blue-600 text-white hover:bg-blue-700 transition-all ${loadingPriceId === credit.priceId ? 'opacity-50 cursor-wait' : ''}`}
              >
                {loadingPriceId === credit.priceId ? 'กำลังดำเนินการ...' : 'ซื้อเครดิต'}
              </button>
              <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">
                ในการชำระเงิน ท่านยอมรับ{' '}
                <a href="/terms" target="_blank" rel="noreferrer" className="underline hover:text-slate-600">เงื่อนไข</a>
                {' '}และ{' '}
                <a href="/privacy" target="_blank" rel="noreferrer" className="underline hover:text-slate-600">นโยบาย</a>
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}