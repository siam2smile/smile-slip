import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { CheckCircle, Zap, Shield, Building2, Crown, CreditCard, ArrowLeft, Sparkles } from 'lucide-react';

export default function PricingPage() {
  const router = useRouter();
  const [isYearly, setIsYearly] = useState(false);
  const [shopId, setShopId] = useState(null);
  const [currentTier, setCurrentTier] = useState('normal');
  const [loadingPriceId, setLoadingPriceId] = useState(null);
  const [promotion, setPromotion] = useState(null);
  const { userId } = router.query;

  useEffect(() => {
    if (userId) {
      fetch(`/api/shop/data?userId=${encodeURIComponent(userId)}`)
        .then(r => r.json())
        .then(d => {
          if (d.profile?.id) {
            setShopId(d.profile.id);
            setCurrentTier((d.profile.subscription_tier || 'normal').toLowerCase());
          }
        });
    }
  }, [userId]);

  useEffect(() => {
    fetch('/api/promotion').then(r => r.json()).then(d => setPromotion(d.promotion || null)).catch(() => {});
  }, []);

  const handleCheckout = async (priceId) => {
    if (!shopId) {
      alert('ไม่พบข้อมูลร้านค้า กรุณาเข้าสู่ระบบผ่านแดชบอร์ดใหม่อีกครั้งครับ');
      return;
    }
    if (!priceId || priceId.startsWith('price_REPLACE_')) {
      alert('แพ็กเกจนี้ยังอยู่ระหว่างการเปิดตัว กรุณาติดต่อทีมงานผ่าน LINE ได้เลยครับ 😊');
      return;
    }
    setLoadingPriceId(priceId);
    try {
      const response = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priceId, shopId }),
      });
      const data = await response.json();
      if (data.url) {
        window.location.href = data.url;
      } else if (data.upgraded) {
        // Upgrade สำเร็จโดยไม่ต้องผ่าน checkout
        alert('✅ อัพเกรดแพ็กเกจสำเร็จ! เครดิตถูกเพิ่มให้แล้ว');
        router.push(`/dashboard?userId=${data.userId || userId}`);
      } else {
        alert('เกิดข้อผิดพลาด: ' + (data.error || 'ไม่สามารถสร้าง session ได้'));
      }
    } catch (error) {
      console.error('Checkout error:', error);
      alert('เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง');
    } finally {
      setLoadingPriceId(null);
    }
  };

  const TIER_ORDER = { normal: 0, pro: 1, advance: 2, business: 3, enterprise: 4, super: 4 };

  const plans = [
    {
      id: 'normal',
      name: 'Starter',
      target: 'ร้านค้าที่เพิ่งเริ่มต้น',
      monthlyPrice: 0,
      yearlyPrice: 0,
      priceIdMonthly: null,
      priceIdYearly: null,
      icon: <CheckCircle className="text-slate-400" size={32} />,
      color: 'bg-slate-50 border-slate-200',
      btnText: 'ใช้งานฟรี',
      btnColor: 'bg-slate-200 text-slate-700 cursor-default',
      badge: null,
      features: [
        '🤖 AI อ่านสลิปอัตโนมัติ',
        '📊 บันทึก Google Sheet อัตโนมัติ',
        '📁 รูปสลิปใน Google Drive',
        '🔒 ตรวจจับสลิปซ้ำ',
        '🎁 50 แผ่นแรกฟรี (ไม่หมดอายุ)',
        '📝 คีย์รายการเองได้เสมอ',
      ],
      note: 'หมดเครดิตแล้ว → Bot หยุด แต่คีย์เองได้',
    },
    {
      id: 'pro',
      name: 'Shop Pro',
      target: 'ร้านค้าที่มีพนักงาน',
      monthlyPrice: 199,
      yearlyPrice: 1990,
      priceIdMonthly: 'price_1TYKnm3ZvivzvZ6qHQpT6tDf',
      priceIdYearly: 'price_1TYKnm3ZvivzvZ6qmXeH3i2a',
      icon: <Zap className="text-amber-500" size={32} />,
      color: 'bg-amber-50 border-amber-300',
      btnText: 'อัปเกรด Pro',
      btnColor: 'bg-amber-500 hover:bg-amber-600 text-white',
      badge: 'ยอดนิยม',
      badgeColor: 'bg-amber-400 text-white',
      features: [
        '✅ ทุกอย่างใน Starter',
        '🔓 200 สลิป/เดือน รวมในราคา',
        '📅 #สรุปวันนี้ / #สรุปเดือน',
        '💰 #กำไรขาดทุน',
        '🔔 แจ้งเจ้าของส่วนตัวทันที',
        '📈 กราฟรายรับ-รายจ่าย',
      ],
      note: '฿199 = เวลาที่ประหยัดได้ 2-3 ชม./วัน',
    },
    {
      id: 'advance',
      name: 'Advance',
      target: 'SME ที่มีนักบัญชี',
      monthlyPrice: 499,
      yearlyPrice: 4990,
      priceIdMonthly: 'price_1TYKrd3ZvivzvZ6qQ2P0rHIg',
      priceIdYearly: 'price_1TYKre3ZvivzvZ6qlqgiu8t5',
      icon: <Shield className="text-indigo-500" size={32} />,
      color: 'bg-indigo-50 border-indigo-300',
      btnText: 'อัปเกรด Advance',
      btnColor: 'bg-indigo-600 hover:bg-indigo-700 text-white',
      badge: null,
      features: [
        '✅ ทุกอย่างใน Pro',
        '🔓 500 สลิป/เดือน รวมในราคา',
        '🏢 รองรับสูงสุด 5 สาขา',
        '🛡️ ป้องกันสลิปซ้ำข้ามสาขา',
        '📊 เปรียบเทียบยอดแต่ละสาขา',
        '📤 Export Excel ส่งนักบัญชี',
        '💬 #สรุปทุกสาขา',
      ],
      note: 'แทนนักบัญชีรายเดือน ฿8,000-15,000',
    },
    {
      id: 'business',
      name: 'Business',
      target: 'ร้านอาหาร / แฟรนไชส์เล็ก',
      monthlyPrice: 999,
      yearlyPrice: 9990,
      priceIdMonthly: 'price_1Tg4zU3ZvivzvZ6ql61Q0szc',
      priceIdYearly:  'price_1Tg4zU3ZvivzvZ6qP2AE2Yz0',
      icon: <Building2 className="text-emerald-500" size={32} />,
      color: 'bg-emerald-50 border-emerald-300',
      btnText: 'อัปเกรด Business',
      btnColor: 'bg-emerald-600 hover:bg-emerald-700 text-white',
      badge: '🔥 ใหม่',
      badgeColor: 'bg-emerald-500 text-white',
      features: [
        '✅ ทุกอย่างใน Advance',
        '🔓 1,000 สลิป/เดือน รวมในราคา',
        '🏢 รองรับสูงสุด 10 สาขา',
        '👥 แดชบอร์ด 3 Admin',
        '📊 กราฟ Top Sender รายเดือน',
        '📱 Dashboard Mobile-first',
      ],
      note: 'จัดการ 10 สาขาจากโทรศัพท์เครื่องเดียว',
    },
    {
      id: 'enterprise',
      name: 'Enterprise',
      target: 'แฟรนไชส์ใหญ่ & องค์กร',
      monthlyPrice: 2990,
      yearlyPrice: 29900,
      priceIdMonthly: 'price_1TYKv33ZvivzvZ6qDs5eBbqA',
      priceIdYearly: 'price_1TYKv33ZvivzvZ6q9dIPU3ud',
      icon: <Crown className="text-violet-500" size={32} />,
      color: 'bg-violet-50 border-violet-300',
      btnText: 'ติดต่อทีมงาน',
      btnColor: 'bg-violet-700 hover:bg-violet-800 text-white',
      badge: 'VIP',
      badgeColor: 'bg-violet-600 text-white',
      features: [
        '✅ ทุกอย่างใน Business',
        '♾️ Unlimited scan (ไม่ตัดเครดิต)',
        '🏢 รองรับสูงสุด 20 สาขา',
        '🎯 Priority Support ตอบภายใน 4 ชม. (จ–ส 08–17น.)',
        '🚀 Onboarding ส่วนตัว + Setup โดยทีมงาน',
        '📊 รายงาน Excel Custom (ทีมงานจัดทำให้)',
        '☁️ Cloud Run High Availability',
      ],
      note: 'เราดูแลทุกอย่างตั้งแต่ต้น',
    },
  ];

  const credits = [
    { name: 'Starter Pack', amount: 100, price: 99, priceId: 'price_1TYLy93ZvivzvZ6qMaWLnlhH', color: 'border-slate-200', perUnit: '฿0.99/แผ่น' },
    { name: 'Value Pack', amount: 500, price: 299, priceId: 'price_1TYLyA3ZvivzvZ6q78LPY9Fh', color: 'border-blue-200', perUnit: '฿0.60/แผ่น' },
    { name: 'Volume Pack', amount: 1000, price: 499, priceId: 'price_1TYLy93ZvivzvZ6qXziQSdMo', color: 'border-blue-200 ring-2 ring-blue-100', perUnit: '฿0.50/แผ่น', badge: 'ประหยัดสุด' },
    { name: 'Mega Pack', amount: 3000, price: 999, priceId: 'price_1Tg56f3ZvivzvZ6qX4163cg5', color: 'border-purple-200', perUnit: '฿0.33/แผ่น', badge: 'สุดคุ้ม' },
  ];

  return (
    <div className="min-h-screen bg-slate-50 font-sans flex flex-col">

      {/* ── Top bar ── */}
      <div className="max-w-7xl mx-auto px-6 pt-6 w-full">
        <button onClick={() => router.push(`/dashboard?userId=${userId}`)}
          className="flex items-center gap-2 text-blue-700 hover:text-blue-900 font-medium transition-all mb-6 text-sm">
          <ArrowLeft size={16}/> กลับไปยังแดชบอร์ด
        </button>
      </div>

      {/* ── Hero ── */}
      <div className="bg-blue-800 text-white py-12 text-center px-4 rounded-[2.5rem] shadow-2xl max-w-7xl mx-auto w-full">
        {promotion && (
          <div className="inline-flex items-center gap-2 bg-amber-400 text-amber-950 text-sm font-black px-5 py-2.5 rounded-full mb-4 shadow-lg animate-pulse">
            🎉 {promotion.title} — {promotion.badgeText}
            {promotion.validUntil && <span className="font-normal">· หมดเขต {promotion.validUntil}</span>}
          </div>
        )}
        <div className="inline-flex items-center gap-2 bg-white/10 text-blue-200 text-xs font-medium px-4 py-2 rounded-full mb-4">
          <Sparkles size={12}/> 50 สลิปแรกฟรี — ไม่ต้องใส่บัตรเครดิต
        </div>
        <h1 className="text-3xl md:text-5xl font-black mb-3">เลือกแพ็กเกจที่ใช่</h1>
        <p className="text-blue-300 text-sm mb-8">ยิ่งสะดวก ยิ่งคุ้ม — เหมือนเปลี่ยนจากต้มน้ำเองมาใช้ไมโครเวฟ</p>
        <div className="flex items-center justify-center gap-4">
          <span className={!isYearly ? 'text-white font-semibold' : 'text-blue-400 text-sm'}>รายเดือน</span>
          <button onClick={() => setIsYearly(!isYearly)}
            className="w-14 h-7 bg-indigo-600 rounded-full p-1 transition-all flex items-center">
            <div className={`w-5 h-5 bg-white rounded-full transition-transform ${isYearly ? 'translate-x-7' : ''}`}/>
          </button>
          <span className={isYearly ? 'text-white font-semibold' : 'text-blue-400 text-sm'}>
            รายปี <span className="text-emerald-400 font-bold text-xs ml-1">(ประหยัด 2 เดือน)</span>
          </span>
        </div>
        <p className="text-blue-200 text-xs mt-3">
          ℹ️ ราคาที่แสดงยังไม่รวมภาษีมูลค่าเพิ่ม (VAT) 7% · ระบบจะคิด VAT เพิ่มตอนชำระเงิน · สามารถออกใบกำกับภาษีเต็มรูปแบบได้
        </p>
      </div>

      {/* ── Plan Cards ── */}
      <div className="max-w-7xl mx-auto px-4 -mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {plans.map((plan) => {
          const isCurrentPlan = currentTier === plan.id || (plan.id === 'enterprise' && currentTier === 'super');
          const isDowngrade = TIER_ORDER[currentTier] > TIER_ORDER[plan.id];
          const priceId = isYearly ? plan.priceIdYearly : plan.priceIdMonthly;
          const isLoading = loadingPriceId === priceId;

          return (
            <div key={plan.id}
              className={`bg-white rounded-3xl p-5 shadow-xl border-2 flex flex-col justify-between transition-all
                ${plan.color}
                ${isCurrentPlan ? 'ring-2 ring-blue-500 ring-offset-2' : ''}
              `}>
              <div>
                {/* Badge */}
                <div className="flex justify-between items-start mb-3">
                  <div>{plan.icon}</div>
                  {plan.badge && (
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${plan.badgeColor}`}>
                      {plan.badge}
                    </span>
                  )}
                  {isCurrentPlan && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-600 text-white">
                      แพ็กเกจปัจจุบัน
                    </span>
                  )}
                </div>

                <h2 className="text-lg font-black text-slate-800">{plan.name}</h2>
                <p className="text-xs text-slate-400 mb-3">{plan.target}</p>

                {/* ราคา */}
                <div className="mb-4">
                  {plan.monthlyPrice === 0 ? (
                    <span className="text-3xl font-black text-slate-800">ฟรี</span>
                  ) : (() => {
                    const basePrice = isYearly ? plan.yearlyPrice : plan.monthlyPrice;
                    const finalPrice = promotion ? Math.round(basePrice * (1 - promotion.discountPercent / 100)) : basePrice;
                    return (
                    <>
                      {promotion && (
                        <div className="text-sm text-slate-400 line-through">฿{basePrice.toLocaleString()}</div>
                      )}
                      <span className="text-3xl font-black">
                        ฿{finalPrice.toLocaleString()}
                      </span>
                      <span className="text-slate-400 text-xs">/{isYearly ? 'ปี' : 'เดือน'}</span>
                      {promotion && (
                        <div className="text-[10px] text-rose-600 font-bold mt-0.5">🎉 {promotion.badgeText}</div>
                      )}
                      {isYearly && (
                        <div className="mt-0.5 space-y-0.5">
                          <div className="text-[10px] text-slate-400">
                            = ฿{Math.round(finalPrice / 12).toLocaleString()}/เดือน
                          </div>
                          <div className="text-[10px] text-emerald-600 font-bold">
                            🎉 ประหยัด ฿{((plan.monthlyPrice * 12) - plan.yearlyPrice).toLocaleString()}/ปี
                          </div>
                        </div>
                      )}
                      <div className="text-[10px] text-slate-400 mt-1">
                        ราคานี้ยังไม่รวม VAT 7% (ยอดชำระจริง ฿{Math.round(finalPrice * 1.07).toLocaleString()})
                      </div>
                    </>
                    );
                  })()}
                </div>

                {/* Features */}
                <ul className="space-y-1.5 mb-4">
                  {plan.features.map((f, i) => (
                    <li key={i} className="text-xs text-slate-600 leading-relaxed">{f}</li>
                  ))}
                </ul>

                {/* Note */}
                {plan.note && (
                  <div className="text-[10px] text-slate-400 italic border-t border-slate-100 pt-2 mb-3">
                    💡 {plan.note}
                  </div>
                )}
              </div>

              {/* Button */}
              {isCurrentPlan ? (
                <div className="w-full py-2.5 rounded-xl font-bold text-xs text-center bg-blue-50 text-blue-600 border border-blue-200">
                  ✓ แพ็กเกจปัจจุบัน
                </div>
              ) : isDowngrade ? (
                <div className="w-full py-2.5 rounded-xl font-bold text-xs text-center bg-slate-100 text-slate-400 cursor-not-allowed">
                  ไม่รองรับการลดแพ็กเกจ
                </div>
              ) : plan.name === 'Starter' ? (
                <button onClick={() => router.push(`/dashboard?userId=${userId}`)}
                  className={`w-full py-2.5 rounded-xl font-bold text-xs transition-all ${plan.btnColor}`}>
                  {plan.btnText}
                </button>
              ) : (
                <button
                  disabled={isLoading}
                  onClick={() => {
                    if (plan.id === 'enterprise') {
                      window.open('https://line.me/ti/p/~smileslip', '_blank');
                    } else {
                      handleCheckout(priceId);
                    }
                  }}
                  className={`w-full py-2.5 rounded-xl font-bold text-xs transition-all ${plan.btnColor} ${isLoading ? 'opacity-50 cursor-wait' : ''}`}>
                  {isLoading ? 'กำลังพาไปชำระเงิน...' : plan.btnText}
                </button>
              )}

              {plan.name !== 'Starter' && (
                <p className="text-center text-[9px] text-slate-400 mt-1.5 leading-relaxed">
                  ยอมรับ{' '}
                  <a href="/terms" target="_blank" rel="noreferrer" className="underline">เงื่อนไข</a>
                  {' '}และ{' '}
                  <a href="/privacy" target="_blank" rel="noreferrer" className="underline">นโยบาย</a>
                </p>
              )}

              {['advance', 'business', 'enterprise'].includes(plan.id) && (
                <button
                  onClick={() => router.push(`/invoice/request?plan=${plan.id}&yearly=${isYearly}&userId=${userId}`)}
                  className="w-full mt-2 py-2 rounded-xl text-[10px] font-bold border border-slate-300 text-slate-500 hover:border-indigo-400 hover:text-indigo-600 transition-all bg-white">
                  🏛️ ชำระในนามบริษัท (โอนธนาคาร)
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* ── ระบบแนะนำเพื่อน ── */}
      <div className="max-w-7xl mx-auto px-4 mt-16">
        <div className="bg-gradient-to-r from-blue-800 to-indigo-800 rounded-3xl p-8 text-white text-center">
          <div className="text-3xl mb-3">🎁</div>
          <h2 className="text-2xl font-black mb-2">แนะนำเพื่อน รับเครดิตฟรี</h2>
          <p className="text-blue-200 text-sm mb-6">
            แชร์ลิงก์ให้เพื่อนสมัครใช้งาน — ทั้งคุณและเพื่อนได้รับ <span className="text-white font-bold">50 เครดิต</span> ทันที
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl mx-auto">
            {[
              { step: '1', title: 'แชร์ลิงก์', desc: 'คัดลอกลิงก์แนะนำในหน้า Dashboard' },
              { step: '2', title: 'เพื่อนสมัคร', desc: 'เพื่อนสมัครและเชื่อมต่อ Google Drive' },
              { step: '3', title: 'รับเครดิต', desc: 'ทั้งสองฝ่ายได้รับ 50 เครดิตทันที' },
            ].map(s => (
              <div key={s.step} className="bg-white/10 rounded-2xl p-4">
                <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center font-black text-sm mx-auto mb-2">{s.step}</div>
                <p className="font-bold text-sm">{s.title}</p>
                <p className="text-blue-200 text-xs mt-1">{s.desc}</p>
              </div>
            ))}
          </div>
          <button onClick={() => router.push(`/dashboard?userId=${userId}`)}
            className="mt-6 inline-flex items-center gap-2 bg-white text-blue-800 font-black px-6 py-3 rounded-xl hover:bg-blue-50 transition-all text-sm">
            ดูลิงก์แนะนำของฉัน →
          </button>
        </div>
      </div>

      {/* ── เติมเครดิต ── */}
      <div className="max-w-7xl mx-auto px-4 mt-16">
        <div className="text-center mb-8">
          <h2 className="text-3xl font-black text-slate-900 mb-2">เติมเครดิตตรวจสลิป</h2>
          <p className="text-slate-500">ซื้อครั้งเดียว ไม่หมดอายุ ใช้ได้กับทุกแพ็กเกจ</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 max-w-3xl mx-auto">
          {credits.map((credit) => (
            <div key={credit.priceId}
              className={`bg-white rounded-3xl p-7 shadow-xl border-2 ${credit.color} flex flex-col items-center text-center relative`}>
              {credit.badge && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-[10px] font-bold px-3 py-1 rounded-full">
                  {credit.badge}
                </div>
              )}
              <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center mb-3">
                <CreditCard className="text-blue-600" size={24}/>
              </div>
              <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mb-1">{credit.name}</p>
              <h3 className="text-4xl font-black text-slate-900 mb-0.5">{credit.amount.toLocaleString()}</h3>
              <p className="text-xs text-slate-400 mb-1">แผ่น</p>
              <p className="text-[10px] text-slate-300 mb-4">{credit.perUnit}</p>
              {promotion ? (
                <div className="mb-5">
                  <p className="text-sm text-slate-400 line-through">฿{credit.price}</p>
                  <p className="text-2xl font-black text-rose-600">฿{Math.round(credit.price * (1 - promotion.discountPercent / 100))}</p>
                </div>
              ) : (
                <p className="text-2xl font-black text-blue-600 mb-5">฿{credit.price}</p>
              )}
              <button
                disabled={loadingPriceId !== null}
                onClick={() => handleCheckout(credit.priceId)}
                className={`w-full py-2.5 rounded-xl font-bold text-sm bg-blue-700 text-white hover:bg-blue-800 transition-all ${loadingPriceId === credit.priceId ? 'opacity-50 cursor-wait' : ''}`}>
                {loadingPriceId === credit.priceId ? 'กำลังดำเนินการ...' : 'ซื้อเครดิต'}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* ── FAQ ── */}
      <div className="max-w-3xl mx-auto px-4 mt-16">
        <h2 className="text-2xl font-black text-slate-900 text-center mb-6">คำถามที่พบบ่อย</h2>
        <div className="space-y-3">
          {[
            {
              q: 'ถ้าเครดิตหมดจะเกิดอะไรขึ้น?',
              a: 'Bot LINE จะหยุดรับสลิปชั่วคราว แต่คุณยังสามารถเข้าสู่ Dashboard และคีย์รายการด้วยตัวเองได้เสมอ พอเติมเครดิตแล้ว Bot จะกลับมาทำงานได้ทันที'
            },
            {
              q: 'เครดิตรายเดือนสะสมได้ไหม?',
              a: 'ได้ครับ! เครดิตรายเดือน (Pro/Advance/Business) จะเพิ่มเข้ายอดคงเหลือทุกเดือน ไม่มีการหมดอายุ ไม่มี "use it or lose it"'
            },
            {
              q: 'อัปเกรดกลางเดือนได้ไหม ราคายังไง?',
              a: 'ได้เลยครับ Stripe คำนวณส่วนต่างที่เหลือของเดือนให้อัตโนมัติ (Proration) คุณจ่ายเฉพาะส่วนที่เหลือในเดือนนั้น'
            },
            {
              q: 'Enterprise มีอะไรพิเศษกว่า Business?',
              a: 'Enterprise = Unlimited scan (ไม่มีลิมิตเครดิตเลย) + VIP Support ตอบใน 4 ชม. + Setup ส่วนตัว + รายงาน Custom สำหรับแฟรนไชส์ที่มีปริมาณสลิปสูงมาก (5,000+/เดือน)'
            },
          ].map((faq, i) => (
            <details key={i} className="bg-white rounded-2xl border border-slate-200 p-5 cursor-pointer group">
              <summary className="font-bold text-slate-800 text-sm list-none flex justify-between items-center">
                {faq.q}
                <span className="text-slate-400 group-open:rotate-45 transition-transform text-xl font-light">+</span>
              </summary>
              <p className="mt-3 text-slate-500 text-sm leading-relaxed">{faq.a}</p>
            </details>
          ))}
        </div>
      </div>

      {/* ── WHT / Corporate Invoice Banner ── */}
      <div className="max-w-3xl mx-auto px-4 mt-16">
        <div className="bg-slate-900 rounded-3xl p-8 text-white">
          <div className="flex flex-col md:flex-row items-start md:items-center gap-6">
            <div className="shrink-0 text-4xl">🏛️</div>
            <div className="flex-1">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">สำหรับลูกค้านิติบุคคล</p>
              <h3 className="text-lg font-black mb-2">ชำระในนามบริษัท · ออกใบแจ้งหนี้ · หัก ณ ที่จ่าย 3%</h3>
              <p className="text-slate-300 text-sm leading-relaxed mb-4">
                Smile Slip Pro จดทะเบียนนิติบุคคลและ VAT ถูกต้อง ยินดีออกใบกำกับภาษีเต็มรูปแบบ
                สำหรับแพ็กเกจ <span className="text-white font-bold">Advance ขึ้นไป</span> หรือ <span className="text-white font-bold">ชำระรายปี</span> —
                ทีมงานจะออกใบแจ้งหนี้พร้อมคำนวณยอดสุทธิหลังหัก 3% ให้ครบ แล้วเปิดสิทธิ์ให้ทันทีหลังยืนยันการโอน
              </p>
              <a href="https://lin.ee/uYhct4L" target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-2 bg-[#06C755] hover:bg-[#05a848] text-white font-black px-6 py-3 rounded-xl transition-all text-sm">
                <svg width="18" height="18" viewBox="0 0 48 48" fill="currentColor">
                  <path d="M24 4C12.95 4 4 11.86 4 21.5c0 5.5 2.93 10.4 7.52 13.6L9.5 44l9.3-4.64C20.5 39.78 22.22 40 24 40c11.05 0 20-7.86 20-17.5S35.05 4 24 4z"/>
                </svg>
                ติดต่อทีมงานผ่าน LINE
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* ── Footer ── */}
      <footer className="mt-auto pt-10 pb-8 border-t border-slate-200 max-w-7xl mx-auto px-4 w-full mt-16">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-1 text-xs text-slate-400 flex-wrap justify-center">
            <a href="/terms" className="hover:text-blue-600 transition-colors px-2 py-1">เงื่อนไขการใช้งาน</a>
            <span className="text-slate-300">·</span>
            <a href="/privacy" className="hover:text-blue-600 transition-colors px-2 py-1">นโยบายความเป็นส่วนตัว (PDPA)</a>
            <span className="text-slate-300">·</span>
            <a href="mailto:support@smileslip.pro" className="hover:text-blue-600 transition-colors px-2 py-1">ติดต่อเรา</a>
          </div>
          <p className="text-xs text-slate-300 whitespace-nowrap">© {new Date().getFullYear()} Siam Global Network Enterprise</p>
        </div>
      </footer>
    </div>
  );
}
