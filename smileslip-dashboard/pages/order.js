import { useState, useEffect, useMemo } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { ShoppingCart, Plus, Minus, Trash2, CheckCircle2, Loader2 } from 'lucide-react';

// หน้าสั่งซื้อ/สั่งจัดส่งสำหรับลูกค้า — สาธารณะ ไม่ต้อง login (ร้านแชร์ลิงก์ /order?shopId=xxx ให้ลูกค้าเอง)
// ส่งเข้าคิว "ออเดอร์ลูกค้ารอยืนยัน" เสมอ — ร้านต้องกดยืนยันในหน้า POS ก่อนถึงจะกลายเป็นออเดอร์จัดส่งจริง
export default function CustomerOrderPage() {
  const router = useRouter();
  const { shopId } = router.query;

  const [loading, setLoading] = useState(true);
  const [shopInfo, setShopInfo] = useState(null);
  const [branches, setBranches] = useState([]);
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState({}); // { sku: qty }
  const [step, setStep] = useState('browse'); // browse | checkout | done
  const [form, setForm] = useState({ name: '', phone: '', address: '', branch: '', paymentMethod: 'เก็บปลายทาง', notes: '' });
  const [slipUrl, setSlipUrl] = useState('');
  const [slipUploading, setSlipUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [doneInfo, setDoneInfo] = useState(null);

  useEffect(() => {
    if (!shopId) return;
    async function init() {
      setLoading(true);
      try {
        const [infoRes, branchRes, prodRes] = await Promise.all([
          fetch(`/api/pos/public-shop-info?shopId=${shopId}`),
          fetch(`/api/shop/branches?shopId=${shopId}`),
          fetch(`/api/pos/products?shopId=${shopId}`),
        ]);
        const info = await infoRes.json();
        const branchData = await branchRes.json();
        const prodData = await prodRes.json();
        setShopInfo(info);
        setBranches((branchData.branches || []).filter(b => b.is_active !== false));
        // ไม่ให้สั่งสินค้าประเภท "หมุนเวียน" ผ่านหน้านี้ (ต้องคุยเรื่องแลก/ยืมของเก่ากับร้านโดยตรง)
        setProducts((prodData.products || []).filter(p => p.type !== 'หมุนเวียน'));
      } catch {}
      setLoading(false);
    }
    init();
  }, [shopId]);

  const cartItems = useMemo(() => {
    return Object.entries(cart)
      .map(([sku, qty]) => ({ product: products.find(p => p.sku === sku), qty }))
      .filter(i => i.product && i.qty > 0);
  }, [cart, products]);

  const cartTotal = cartItems.reduce((s, i) => s + i.product.price * i.qty, 0);
  const cartCount = cartItems.reduce((s, i) => s + i.qty, 0);

  function setQty(sku, qty) {
    setCart(prev => ({ ...prev, [sku]: Math.max(0, qty) }));
  }

  async function handleSlipUpload(e) {
    const file = e.target.files?.[0];
    if (!file || !shopId) return;
    setSlipUploading(true);
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const r = await fetch('/api/pos/upload-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId, imageBase64: base64, mimeType: file.type, folderLabel: 'customer-order' }),
      });
      const d = await r.json();
      if (d.ok) setSlipUrl(d.url);
      else setSubmitError(d.error || 'อัปโหลดสลิปไม่สำเร็จ');
    } catch (err) {
      setSubmitError(err.message);
    }
    setSlipUploading(false);
  }

  async function submitOrder() {
    if (!form.name.trim() || !form.phone.trim() || !form.address.trim()) {
      setSubmitError('กรุณากรอกชื่อ เบอร์โทร และที่อยู่จัดส่งให้ครบ');
      return;
    }
    if (!cartItems.length) { setSubmitError('กรุณาเลือกสินค้าอย่างน้อย 1 รายการ'); return; }
    setSubmitting(true);
    setSubmitError('');
    try {
      const r = await fetch('/api/pos/customer-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopId,
          customer_name: form.name.trim(),
          phone: form.phone.trim(),
          address: form.address.trim(),
          branch: form.branch,
          items: cartItems.map(i => ({ sku: i.product.sku, qty: i.qty })),
          payment_method: form.paymentMethod,
          slip_url: form.paymentMethod === 'โอนแล้ว' ? slipUrl : '',
          notes: form.notes.trim(),
        }),
      });
      const d = await r.json();
      if (d.ok) {
        setDoneInfo(d);
        setStep('done');
      } else {
        setSubmitError(d.error || 'ระบบไม่พร้อมใช้งานขณะนี้ กรุณาติดต่อร้านค้าโดยตรง');
      }
    } catch (err) {
      setSubmitError('เกิดข้อผิดพลาด กรุณาลองใหม่หรือติดต่อร้านค้าโดยตรง');
    }
    setSubmitting(false);
  }

  if (!shopId) return null;

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="animate-spin text-blue-600" size={32} />
      </div>
    );
  }

  if (!shopInfo?.accepting_orders) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-3xl border border-slate-200 p-8 max-w-sm w-full text-center">
          <div className="text-4xl mb-3">🛑</div>
          <h1 className="font-black text-slate-800 mb-2">ร้านนี้ไม่เปิดรับออเดอร์ขณะนี้</h1>
          <p className="text-slate-500 text-sm">กรุณาติดต่อร้านค้าโดยตรงสำหรับการสั่งซื้อ</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <Head><title>สั่งซื้อ/สั่งจัดส่ง — {shopInfo?.shop_name || 'ร้านค้า'}</title></Head>
      <div className="min-h-screen bg-slate-50 pb-28">
        <header className="bg-white border-b border-slate-200 px-4 py-4 sticky top-0 z-10">
          <h1 className="font-black text-slate-800">{shopInfo?.shop_name || 'ร้านค้า'}</h1>
          <p className="text-slate-400 text-xs">สั่งซื้อ/สั่งจัดส่งออนไลน์</p>
        </header>

        {step === 'browse' && (
          <div className="max-w-lg mx-auto p-4">
            {!products.length ? (
              <div className="text-center text-slate-400 text-sm py-16">ร้านนี้ยังไม่มีสินค้าให้สั่งซื้อขณะนี้</div>
            ) : (
              <div className="space-y-2">
                {products.map(p => (
                  <div key={p.sku} className="bg-white rounded-2xl border border-slate-200 p-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-slate-800 text-sm truncate">{p.name}</div>
                      <div className="text-blue-700 font-black text-sm">฿{p.price.toLocaleString()} <span className="text-slate-400 text-xs font-normal">/{p.unit}</span></div>
                    </div>
                    {cart[p.sku] > 0 ? (
                      <div className="flex items-center gap-2 shrink-0">
                        <button onClick={() => setQty(p.sku, (cart[p.sku] || 0) - 1)}
                          className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600"><Minus size={14}/></button>
                        <span className="w-6 text-center font-bold text-slate-800 text-sm">{cart[p.sku]}</span>
                        <button onClick={() => setQty(p.sku, (cart[p.sku] || 0) + 1)}
                          className="w-8 h-8 rounded-full bg-blue-600 hover:bg-blue-700 flex items-center justify-center text-white"><Plus size={14}/></button>
                      </div>
                    ) : (
                      <button onClick={() => setQty(p.sku, 1)}
                        className="shrink-0 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-4 py-2 rounded-xl transition-colors">
                        + เพิ่ม
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {cartCount > 0 && (
              <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 p-4">
                <button onClick={() => setStep('checkout')}
                  className="max-w-lg mx-auto w-full bg-blue-700 hover:bg-blue-800 text-white font-black py-3.5 rounded-2xl flex items-center justify-center gap-2 transition-colors">
                  <ShoppingCart size={18}/> ดูตะกร้า ({cartCount}) — ฿{cartTotal.toLocaleString()}
                </button>
              </div>
            )}
          </div>
        )}

        {step === 'checkout' && (
          <div className="max-w-lg mx-auto p-4 space-y-4">
            <button onClick={() => setStep('browse')} className="text-slate-400 hover:text-slate-600 text-sm">← กลับไปเลือกสินค้าต่อ</button>

            <div className="bg-white rounded-2xl border border-slate-200 p-4">
              <h2 className="font-bold text-slate-700 text-sm mb-3">🛒 รายการที่เลือก</h2>
              <div className="space-y-2">
                {cartItems.map(i => (
                  <div key={i.product.sku} className="flex items-center justify-between text-sm">
                    <span className="text-slate-600">{i.product.name} × {i.qty}</span>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-800">฿{(i.product.price * i.qty).toLocaleString()}</span>
                      <button onClick={() => setQty(i.product.sku, 0)} className="text-red-400 hover:text-red-600"><Trash2 size={14}/></button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="border-t border-slate-100 mt-3 pt-3 flex justify-between font-black text-slate-800">
                <span>ยอดรวม</span><span>฿{cartTotal.toLocaleString()}</span>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
              <h2 className="font-bold text-slate-700 text-sm">📋 ข้อมูลผู้สั่งซื้อ</h2>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 block">ชื่อ-นามสกุล *</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-blue-400"/>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 block">เบอร์โทร *</label>
                <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-blue-400"/>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 block">ที่อยู่จัดส่ง *</label>
                <textarea value={form.address} rows={2} onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-blue-400 resize-none"/>
              </div>
              {branches.length > 0 && (
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 block">สาขาที่ต้องการให้จัดส่ง</label>
                  <select value={form.branch} onChange={e => setForm(f => ({ ...f, branch: e.target.value }))}
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-blue-400 bg-white">
                    <option value="">— ไม่ระบุ —</option>
                    {branches.map(b => <option key={b.id} value={b.branch_name}>{b.brand_name || b.branch_name}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">วิธีชำระเงิน</label>
                <div className="grid grid-cols-2 gap-2">
                  {['เก็บปลายทาง', 'โอนแล้ว'].map(m => (
                    <button key={m} type="button" onClick={() => setForm(f => ({ ...f, paymentMethod: m }))}
                      className={`py-2.5 rounded-xl text-sm font-bold border-2 transition-all ${form.paymentMethod === m ? 'bg-blue-50 border-blue-500 text-blue-700' : 'border-slate-200 text-slate-400'}`}>
                      {m === 'เก็บปลายทาง' ? '💵 เก็บเงินปลายทาง' : '📱 โอนแล้ว (แนบสลิป)'}
                    </button>
                  ))}
                </div>
              </div>
              {form.paymentMethod === 'โอนแล้ว' && (
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">แนบรูปสลิปโอนเงิน</label>
                  {slipUrl ? (
                    <div className="bg-green-50 border border-green-200 rounded-xl p-3 flex items-center gap-2 text-green-700 text-sm">
                      <CheckCircle2 size={16}/> แนบสลิปแล้ว
                    </div>
                  ) : (
                    <label className="flex items-center justify-center gap-2 border-2 border-dashed border-slate-300 rounded-xl py-3 cursor-pointer hover:border-blue-400 text-slate-500 text-sm">
                      <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleSlipUpload} disabled={slipUploading}/>
                      {slipUploading ? 'กำลังอัปโหลด...' : '📷 แตะเพื่อแนบรูปสลิป'}
                    </label>
                  )}
                </div>
              )}
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 block">หมายเหตุ (ไม่บังคับ)</label>
                <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-blue-400"/>
              </div>
            </div>

            {submitError && <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl p-3">{submitError}</div>}

            <button onClick={submitOrder} disabled={submitting}
              className="w-full bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white font-black py-3.5 rounded-2xl transition-colors">
              {submitting ? 'กำลังส่งคำสั่งซื้อ...' : `✅ ยืนยันสั่งซื้อ — ฿${cartTotal.toLocaleString()}`}
            </button>
            <p className="text-center text-slate-400 text-xs">ร้านค้าจะตรวจสอบและติดต่อกลับเพื่อยืนยันออเดอร์อีกครั้ง</p>
          </div>
        )}

        {step === 'done' && doneInfo && (
          <div className="max-w-lg mx-auto p-6">
            <div className="bg-white rounded-3xl border border-slate-200 p-8 text-center">
              <div className="text-5xl mb-3">✅</div>
              <h2 className="font-black text-slate-800 text-lg mb-1">ส่งคำสั่งซื้อสำเร็จ</h2>
              <p className="text-slate-400 text-sm mb-4">เลขที่คำสั่งซื้อ {doneInfo.order_no}</p>
              <p className="text-slate-600 text-sm">ร้านค้าจะตรวจสอบและติดต่อกลับเพื่อยืนยันออเดอร์เร็วๆ นี้</p>
              <div className="text-blue-700 font-black text-xl mt-4">฿{(doneInfo.total || 0).toLocaleString()}</div>
            </div>
          </div>
        )}

        {!shopInfo?.isWhiteLabel && (
          <p className="text-center text-slate-300 text-[11px] py-4">ออกโดย Smile Slip Pro · smileslippro.com</p>
        )}
      </div>
    </>
  );
}
