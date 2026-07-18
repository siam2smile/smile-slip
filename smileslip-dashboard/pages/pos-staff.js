/**
 * หน้าพนักงาน: ยืนยันการโอนเงิน (Staff PIN page)
 * เข้าด้วย PIN 4 หลัก → เห็นบิลที่ "รอยืนยัน" → ถ่ายสลิปยืนยัน
 * mobile-first, บุ๊กมาร์กได้ ไม่ต้อง login LINE
 */
import { useState, useRef } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';

export default function PosStaffPage() {
  const router = useRouter();
  const { shopId, order_no: deepLinkOrderNo } = router.query;

  const [step, setStep] = useState('pin'); // 'pin' | 'menu' | 'bills' | 'confirm' | 'deliveries' | 'deliver-confirm'
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [pinLoading, setPinLoading] = useState(false);
  const [shopName, setShopName] = useState('');
  const [staffName, setStaffName] = useState('');

  const [bills, setBills] = useState([]);
  const [billsLoading, setBillsLoading] = useState(false);

  const [selectedBill, setSelectedBill] = useState(null);
  const [slipUrl, setSlipUrl] = useState('');
  const [slipSender, setSlipSender] = useState('');
  const [slipRefNo, setSlipRefNo] = useState('');
  const [slipUploading, setSlipUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [toast, setToast] = useState('');
  const slipRef = useRef(null);

  // ── งานจัดส่ง (delivery) ────────────────────────────────────────────────
  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [products, setProducts] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [deliverPayMethod, setDeliverPayMethod] = useState('เก็บปลายทาง');
  const [deliverSlipUrl, setDeliverSlipUrl] = useState('');
  const [deliverSlipUploading, setDeliverSlipUploading] = useState(false);
  const [deliverQr, setDeliverQr] = useState('');
  const [deliverQrLoading, setDeliverQrLoading] = useState(false);
  const [returnedQty, setReturnedQty] = useState({}); // { sku: qty }
  const [deliverConfirming, setDeliverConfirming] = useState(false);
  const deliverSlipRef = useRef(null);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  }

  // ── PIN numpad ────────────────────────────────────────────────────────────
  function pressDigit(d) {
    if (pin.length < 4) setPin(p => p + d);
  }
  function backspace() { setPin(p => p.slice(0, -1)); }

  async function verifyPin() {
    if (pin.length !== 4 || !shopId) return;
    setPinLoading(true);
    setPinError('');
    try {
      const r = await fetch('/api/pos/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId, pin }),
      });
      const d = await r.json();
      if (d.ok) {
        fetchBills();
        fetchProducts();
        const fetchedOrders = await fetchOrders();
        // มาจากลิงก์ใน LINE push (มี order_no แนบมา) → พาไปหน้ายืนยันจัดส่งออเดอร์นั้นเลย
        const target = deepLinkOrderNo ? fetchedOrders.find(o => o.order_no === deepLinkOrderNo) : null;
        if (target) {
          openDeliverConfirm(target);
        } else {
          setStep(deepLinkOrderNo ? 'deliveries' : 'menu');
        }
      } else {
        setPinError('PIN ไม่ถูกต้อง');
        setPin('');
      }
    } catch {
      setPinError('เกิดข้อผิดพลาด');
    }
    setPinLoading(false);
  }

  // ── Bills ─────────────────────────────────────────────────────────────────
  async function fetchBills() {
    if (!shopId) return;
    setBillsLoading(true);
    try {
      const r = await fetch(`/api/pos/pending-bills?shopId=${shopId}`);
      const d = await r.json();
      if (d.bills) setBills(d.bills);
      if (d.shopName) setShopName(d.shopName);
    } catch {}
    setBillsLoading(false);
  }

  // ── งานจัดส่ง (delivery) ────────────────────────────────────────────────
  async function fetchOrders() {
    if (!shopId) return [];
    setOrdersLoading(true);
    let filtered = [];
    try {
      const r = await fetch(`/api/pos/delivery?shopId=${shopId}`);
      const d = await r.json();
      if (d.orders) {
        filtered = d.orders.filter(o => o.status === 'รอจัดส่ง' || o.status === 'กำลังส่ง');
        setOrders(filtered);
      }
    } catch {}
    setOrdersLoading(false);
    return filtered;
  }

  async function fetchProducts() {
    if (!shopId) return;
    try {
      const r = await fetch(`/api/pos/products?shopId=${shopId}`);
      const d = await r.json();
      if (d.products) setProducts(d.products);
    } catch {}
  }

  function openDeliverConfirm(order) {
    setSelectedOrder(order);
    setDeliverPayMethod(order.payment_method || 'เก็บปลายทาง');
    setDeliverSlipUrl('');
    setDeliverQr('');
    setReturnedQty({});
    setStep('deliver-confirm');
  }

  async function loadDeliverQr() {
    if (!selectedOrder || !shopId) return;
    setDeliverQrLoading(true);
    try {
      const r = await fetch(`/api/pos/promptpay-qr?shopId=${shopId}&amount=${selectedOrder.total}`);
      const d = await r.json();
      if (d.ok) setDeliverQr(d.qr);
      else alert(d.error || 'สร้าง QR ไม่ได้ — เช็คว่าร้านตั้งค่าพร้อมเพย์ไว้หรือยัง');
    } catch (err) { alert(err.message); }
    setDeliverQrLoading(false);
  }

  async function handleDeliverSlipCapture(e) {
    const file = e.target.files?.[0];
    if (!file || !shopId) return;
    setDeliverSlipUploading(true);
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const r = await fetch('/api/pos/process-slip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId, imageBase64: base64, mimeType: file.type }),
      });
      const d = await r.json();
      if (d.ok) setDeliverSlipUrl(d.url || '');
      else alert('อัปโหลดสลิปไม่สำเร็จ: ' + (d.error || ''));
    } catch (err) { alert(err.message); }
    setDeliverSlipUploading(false);
    if (deliverSlipRef.current) deliverSlipRef.current.value = '';
  }

  // สินค้าหมุนเวียน (เช่น ถังแก๊ส) ในออเดอร์นี้ — ต้องถามว่าลูกค้าคืนถังเปล่ามากี่ใบ
  const cyclicalItemsInOrder = (selectedOrder?.items || []).filter(item => {
    const prod = products.find(p => p.sku === item.sku);
    return prod?.type === 'หมุนเวียน';
  });

  async function confirmDeliverySubmit() {
    if (!selectedOrder || deliverConfirming) return;
    if (deliverPayMethod === 'โอนแล้ว' && !deliverSlipUrl) {
      if (!confirm('ยังไม่ได้แนบสลิปโอนเงิน ยืนยันต่อโดยไม่แนบสลิปเลยไหม?')) return;
    }
    setDeliverConfirming(true);
    try {
      const items = (selectedOrder.items || []).map(item => {
        const qty = parseInt(returnedQty[item.sku]) || 0;
        return qty > 0 ? { ...item, returned_qty: qty } : item;
      });
      const r = await fetch('/api/pos/delivery', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopId,
          order_no: selectedOrder.order_no,
          confirm_delivery: true,
          payment_method: deliverPayMethod,
          slip_url: deliverSlipUrl,
          confirmed_by: staffName.trim() || undefined,
          items,
        }),
      });
      const d = await r.json();
      if (d.ok) {
        showToast('✅ ยืนยันจัดส่งสำเร็จแล้ว');
        setOrders(prev => prev.filter(o => o.order_no !== selectedOrder.order_no));
        setSelectedOrder(null);
        setStep('deliveries');
      } else {
        alert(d.error || 'เกิดข้อผิดพลาด');
      }
    } catch (err) { alert(err.message); }
    setDeliverConfirming(false);
  }

  // ── Slip upload ───────────────────────────────────────────────────────────
  async function handleSlipCapture(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSlipUploading(true);
    setSlipUrl('');
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const r = await fetch('/api/pos/process-slip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId, imageBase64: base64, mimeType: file.type }),
      });
      const d = await r.json();
      if (d.ok) {
        setSlipUrl(d.url || '');
        setSlipSender(d.sender || '');
        setSlipRefNo(d.refNo || '');
      } else {
        alert('อัปโหลดสลิปไม่สำเร็จ: ' + (d.error || ''));
      }
    } catch (err) {
      alert(err.message);
    }
    setSlipUploading(false);
    if (slipRef.current) slipRef.current.value = '';
  }

  async function confirmBill() {
    if (!selectedBill || confirming) return;
    setConfirming(true);
    try {
      const r = await fetch('/api/pos/confirm-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopId,
          billNo: selectedBill.bill_no,
          slipUrl,
          slipSender,
          slipRefNo,
        }),
      });
      const d = await r.json();
      if (d.ok) {
        showToast('✅ ยืนยันการชำระเงินแล้ว');
        setBills(prev => prev.filter(b => b.bill_no !== selectedBill.bill_no));
        setSelectedBill(null);
        setSlipUrl('');
        setSlipSender('');
        setSlipRefNo('');
        setStep('bills');
      } else {
        alert(d.error || 'เกิดข้อผิดพลาด');
      }
    } catch (err) {
      alert(err.message);
    }
    setConfirming(false);
  }

  // ── render ────────────────────────────────────────────────────────────────
  if (!shopId) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
        <div className="text-gray-400 text-sm text-center">
          <div className="text-4xl mb-3">🔒</div>
          ไม่พบข้อมูลร้าน<br />
          <span className="text-xs">เปิดลิงก์จากหน้า POS → ตั้งค่า</span>
        </div>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Staff · Smile Slip POS</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
      </Head>
      <div className="min-h-screen bg-gray-950 text-white flex flex-col max-w-sm mx-auto">
        {/* Header */}
        <header className="bg-gray-900 border-b border-gray-800 px-5 py-4 flex items-center justify-between shrink-0">
          <div>
            <div className="text-white font-bold text-sm">🛒 Staff POS</div>
            {shopName && <div className="text-gray-400 text-xs">{shopName}</div>}
          </div>
          {step !== 'pin' && (
            <button onClick={() => { setStep('pin'); setPin(''); setBills([]); }}
              className="text-gray-400 hover:text-white text-xs border border-gray-700 px-3 py-1.5 rounded-lg">
              ออกจากระบบ
            </button>
          )}
        </header>

        <div className="flex-1 overflow-y-auto p-5">

          {/* ══ PIN entry ══════════════════════════════════════════════════ */}
          {step === 'pin' && (
            <div className="flex flex-col items-center pt-8">
              <div className="text-4xl mb-4">🔐</div>
              <h2 className="text-white font-bold text-xl mb-2">ใส่ PIN พนักงาน</h2>
              <p className="text-gray-400 text-sm mb-8">กรอก PIN 4 หลักเพื่อเข้าระบบ</p>

              {/* PIN dots */}
              <div className="flex gap-4 mb-6">
                {[0,1,2,3].map(i => (
                  <div key={i} className={`w-4 h-4 rounded-full border-2 transition-colors ${
                    i < pin.length ? 'bg-green-500 border-green-500' : 'border-gray-600'
                  }`} />
                ))}
              </div>

              {pinError && (
                <div className="text-red-400 text-sm mb-4">{pinError}</div>
              )}

              {/* Numpad */}
              <div className="grid grid-cols-3 gap-3 w-full max-w-xs">
                {[1,2,3,4,5,6,7,8,9,'',0,'⌫'].map((k, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      if (k === '⌫') backspace();
                      else if (k !== '') pressDigit(String(k));
                    }}
                    disabled={pinLoading || k === ''}
                    className={`h-16 rounded-2xl text-xl font-bold transition-colors ${
                      k === '' ? 'invisible' :
                      k === '⌫' ? 'bg-gray-800 hover:bg-gray-700 text-gray-300' :
                      'bg-gray-800 hover:bg-gray-700 active:bg-gray-600 text-white'
                    }`}
                  >
                    {k}
                  </button>
                ))}
              </div>

              <button
                onClick={verifyPin}
                disabled={pin.length !== 4 || pinLoading}
                className="mt-6 w-full max-w-xs bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-bold py-4 rounded-2xl text-lg transition-colors"
              >
                {pinLoading ? 'กำลังตรวจสอบ...' : 'เข้าสู่ระบบ'}
              </button>
            </div>
          )}

          {/* ══ Menu — เลือกงาน ══════════════════════════════════════════════ */}
          {step === 'menu' && (
            <div className="space-y-3">
              <div className="mb-2">
                <label className="text-gray-400 text-xs block mb-1.5">ชื่อพนักงาน (ไม่บังคับ — ใช้บันทึกว่าใครยืนยันงาน)</label>
                <input value={staffName} onChange={e => setStaffName(e.target.value)}
                  placeholder="เช่น สมชาย"
                  className="w-full bg-gray-800 text-white text-sm px-4 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500" />
              </div>
              <button onClick={() => setStep('bills')}
                className="w-full bg-gray-900 border border-gray-800 rounded-2xl p-5 text-left hover:bg-gray-800 transition-colors flex items-center justify-between">
                <div>
                  <div className="text-white font-bold">📷 บิลรอยืนยันการโอน</div>
                  <div className="text-gray-500 text-xs mt-0.5">ยืนยันสลิปการชำระเงินหน้าร้าน</div>
                </div>
                <span className="bg-yellow-900 text-yellow-300 text-xs px-2.5 py-1 rounded-full font-bold">{bills.length}</span>
              </button>
              <button onClick={() => setStep('deliveries')}
                className="w-full bg-gray-900 border border-gray-800 rounded-2xl p-5 text-left hover:bg-gray-800 transition-colors flex items-center justify-between">
                <div>
                  <div className="text-white font-bold">🚚 งานจัดส่ง</div>
                  <div className="text-gray-500 text-xs mt-0.5">ยืนยันจัดส่งสำเร็จ + รับเงิน</div>
                </div>
                <span className="bg-orange-900 text-orange-300 text-xs px-2.5 py-1 rounded-full font-bold">{orders.length}</span>
              </button>
            </div>
          )}

          {/* ══ Pending bills ══════════════════════════════════════════════ */}
          {step === 'bills' && (
            <div>
              <button onClick={() => setStep('menu')} className="text-gray-400 hover:text-white text-sm mb-4 flex items-center gap-1">← เมนู</button>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-white font-bold text-lg">บิลรอยืนยัน</h2>
                <button onClick={fetchBills} disabled={billsLoading}
                  className="text-green-400 text-xs border border-green-800 px-3 py-1.5 rounded-lg hover:bg-green-900/30 transition-colors">
                  {billsLoading ? '...' : '🔄 รีเฟรช'}
                </button>
              </div>

              {billsLoading ? (
                <div className="text-center text-gray-400 py-12">กำลังโหลด...</div>
              ) : bills.length === 0 ? (
                <div className="text-center py-16">
                  <div className="text-5xl mb-4">✅</div>
                  <div className="text-gray-300 font-medium">ไม่มีบิลรอยืนยัน</div>
                  <div className="text-gray-500 text-sm mt-1">บิลโอนทั้งหมดยืนยันแล้ว</div>
                </div>
              ) : (
                <div className="space-y-3">
                  {bills.map(bill => (
                    <div key={bill.bill_no} className="bg-gray-900 rounded-2xl p-4 border border-gray-800">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <div className="text-white font-bold text-lg">฿{bill.total.toLocaleString()}</div>
                          <div className="text-gray-500 text-xs font-mono mt-0.5">{bill.bill_no}</div>
                        </div>
                        <span className="bg-yellow-900 text-yellow-300 text-xs px-2 py-1 rounded-full shrink-0">รอยืนยัน</span>
                      </div>

                      {bill.notes && (
                        <div className="text-gray-400 text-xs mb-2 truncate">📝 {bill.notes}</div>
                      )}

                      <div className="space-y-0.5 mb-3">
                        {Array.isArray(bill.items) && bill.items.map((item, j) => (
                          <div key={j} className="flex justify-between text-xs">
                            <span className="text-gray-400">{item.name} ×{item.qty}</span>
                            <span className="text-gray-300">฿{(item.price * item.qty).toLocaleString()}</span>
                          </div>
                        ))}
                      </div>

                      <button
                        onClick={() => { setSelectedBill(bill); setSlipUrl(''); setSlipSender(''); setSlipRefNo(''); setStep('confirm'); }}
                        className="w-full bg-green-700 hover:bg-green-600 text-white text-sm font-bold py-2.5 rounded-xl transition-colors"
                      >
                        📷 ยืนยันการชำระเงิน
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ══ Confirm payment ════════════════════════════════════════════ */}
          {step === 'confirm' && selectedBill && (
            <div>
              <button onClick={() => setStep('bills')} className="text-gray-400 hover:text-white text-sm mb-5 flex items-center gap-1">
                ← กลับ
              </button>

              <div className="bg-gray-900 rounded-2xl p-4 border border-gray-800 mb-5">
                <div className="text-gray-400 text-xs mb-1">บิล {selectedBill.bill_no}</div>
                <div className="text-white font-bold text-2xl mb-3">฿{selectedBill.total.toLocaleString()}</div>
                {Array.isArray(selectedBill.items) && selectedBill.items.map((item, j) => (
                  <div key={j} className="flex justify-between text-xs text-gray-400">
                    <span>{item.name} ×{item.qty}</span>
                    <span>฿{(item.price * item.qty).toLocaleString()}</span>
                  </div>
                ))}
              </div>

              <h3 className="text-white font-bold mb-3">📷 แนบสลิปการโอน</h3>

              {slipUrl ? (
                <div className="bg-green-900/30 border border-green-800 rounded-2xl p-4 flex items-center gap-3 mb-4">
                  <div className="text-green-400 text-2xl shrink-0">✅</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-green-300 text-sm font-bold">อัปโหลดสลิปแล้ว</div>
                    {slipSender && <div className="text-green-200 text-xs mt-0.5">ผู้โอน: {slipSender}</div>}
                    {slipRefNo && <div className="text-gray-500 text-xs">อ้างอิง: {slipRefNo}</div>}
                  </div>
                  <button onClick={() => { setSlipUrl(''); setSlipSender(''); setSlipRefNo(''); }}
                    className="text-gray-500 hover:text-gray-300 shrink-0">✕</button>
                </div>
              ) : (
                <div className="mb-4">
                  <button
                    type="button"
                    onClick={() => slipRef.current?.click()}
                    disabled={slipUploading}
                    className="w-full bg-gray-800 hover:bg-gray-700 border-2 border-dashed border-gray-600 text-gray-300 font-medium py-6 rounded-2xl transition-colors flex flex-col items-center gap-2 disabled:opacity-60"
                  >
                    {slipUploading ? (
                      <><span className="text-3xl animate-spin">⏳</span><span className="text-sm">กำลังอ่านสลิป...</span></>
                    ) : (
                      <><span className="text-4xl">📷</span><span className="text-sm">ถ่ายรูป / เลือกสลิปโอน</span></>
                    )}
                  </button>
                  <input ref={slipRef} type="file" accept="image/*" capture="environment"
                    className="hidden" onChange={handleSlipCapture} />
                  <p className="text-gray-600 text-xs text-center mt-2">
                    หรือยืนยันโดยไม่แนบสลิป (ถ้าได้รับเงินแล้ว)
                  </p>
                </div>
              )}

              <button
                onClick={confirmBill}
                disabled={confirming}
                className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-bold py-4 rounded-2xl text-lg transition-colors"
              >
                {confirming ? 'กำลังบันทึก...' : '✅ ยืนยันรับชำระเงินแล้ว'}
              </button>
            </div>
          )}

          {/* ══ รายการงานจัดส่ง ══════════════════════════════════════════════ */}
          {step === 'deliveries' && (
            <div>
              <button onClick={() => setStep('menu')} className="text-gray-400 hover:text-white text-sm mb-4 flex items-center gap-1">← เมนู</button>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-white font-bold text-lg">งานจัดส่ง</h2>
                <button onClick={fetchOrders} disabled={ordersLoading}
                  className="text-green-400 text-xs border border-green-800 px-3 py-1.5 rounded-lg hover:bg-green-900/30 transition-colors">
                  {ordersLoading ? '...' : '🔄 รีเฟรช'}
                </button>
              </div>

              {ordersLoading ? (
                <div className="text-center text-gray-400 py-12">กำลังโหลด...</div>
              ) : orders.length === 0 ? (
                <div className="text-center py-16">
                  <div className="text-5xl mb-4">✅</div>
                  <div className="text-gray-300 font-medium">ไม่มีงานจัดส่งค้าง</div>
                </div>
              ) : (
                <div className="space-y-3">
                  {orders.map(order => (
                    <div key={order.order_no} className="bg-gray-900 rounded-2xl p-4 border border-gray-800">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <div className="text-white font-bold">{order.customer_name}</div>
                          {order.phone && <div className="text-gray-400 text-xs">📞 {order.phone}</div>}
                        </div>
                        <span className="bg-orange-900 text-orange-300 text-xs px-2 py-1 rounded-full shrink-0">{order.status}</span>
                      </div>
                      {order.address && <div className="text-gray-500 text-xs mb-2 truncate">📍 {order.address}</div>}
                      <div className="space-y-0.5 mb-3">
                        {Array.isArray(order.items) && order.items.map((item, j) => (
                          <div key={j} className="flex justify-between text-xs">
                            <span className="text-gray-400">{item.name} ×{item.qty}</span>
                            <span className="text-gray-300">฿{(item.price * item.qty).toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        {order.maps_link && (
                          <a href={order.maps_link} target="_blank" rel="noreferrer"
                            className="flex-1 text-center bg-gray-800 hover:bg-gray-700 text-gray-200 text-sm font-medium py-2.5 rounded-xl transition-colors">
                            🗺️ แผนที่
                          </a>
                        )}
                        <button onClick={() => openDeliverConfirm(order)}
                          className="flex-[2] bg-orange-600 hover:bg-orange-500 text-white text-sm font-bold py-2.5 rounded-xl transition-colors">
                          🛵 ยืนยันจัดส่งสำเร็จ
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ══ ยืนยันจัดส่งสำเร็จ ══════════════════════════════════════════════ */}
          {step === 'deliver-confirm' && selectedOrder && (
            <div>
              <button onClick={() => setStep('deliveries')} className="text-gray-400 hover:text-white text-sm mb-5 flex items-center gap-1">
                ← กลับ
              </button>

              <div className="bg-gray-900 rounded-2xl p-4 border border-gray-800 mb-5">
                <div className="text-white font-bold text-lg">{selectedOrder.customer_name}</div>
                {selectedOrder.phone && <div className="text-gray-400 text-xs mt-0.5">📞 {selectedOrder.phone}</div>}
                {selectedOrder.address && <div className="text-gray-500 text-xs mt-1">📍 {selectedOrder.address}</div>}
                <div className="border-t border-gray-800 mt-3 pt-3 space-y-0.5">
                  {Array.isArray(selectedOrder.items) && selectedOrder.items.map((item, j) => (
                    <div key={j} className="flex justify-between text-xs text-gray-400">
                      <span>{item.name} ×{item.qty}</span>
                      <span>฿{(item.price * item.qty).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
                <div className="flex justify-between font-bold mt-2 pt-2 border-t border-gray-800">
                  <span className="text-gray-300 text-sm">รวม</span>
                  <span className="text-white">฿{selectedOrder.total.toLocaleString()}</span>
                </div>
              </div>

              {/* วิธีชำระเงินจริง */}
              <h3 className="text-white font-bold mb-2">💳 รับเงินแบบไหน</h3>
              <div className="grid grid-cols-3 gap-2 mb-4">
                {['เก็บปลายทาง', 'โอนแล้ว', 'ค้างจ่าย'].map(m => (
                  <button key={m} onClick={() => { setDeliverPayMethod(m); setDeliverQr(''); }}
                    className={`py-2.5 rounded-xl text-xs font-bold transition-colors ${deliverPayMethod === m ? 'bg-orange-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}>
                    {m === 'เก็บปลายทาง' ? '💵 เงินสด' : m === 'โอนแล้ว' ? '📱 โอน' : '📒 ค้างจ่าย'}
                  </button>
                ))}
              </div>

              {/* QR ถ้าเลือกโอน */}
              {deliverPayMethod === 'โอนแล้ว' && (
                <div className="mb-4">
                  {deliverQr ? (
                    <div className="bg-white rounded-2xl p-4 flex flex-col items-center">
                      <img src={deliverQr} alt="QR พร้อมเพย์" className="w-48 h-48" />
                      <div className="text-gray-700 text-sm font-bold mt-2">฿{selectedOrder.total.toLocaleString()}</div>
                    </div>
                  ) : (
                    <button onClick={loadDeliverQr} disabled={deliverQrLoading}
                      className="w-full bg-gray-800 hover:bg-gray-700 text-gray-200 text-sm font-bold py-3 rounded-xl transition-colors disabled:opacity-50">
                      {deliverQrLoading ? 'กำลังสร้าง QR...' : '📱 แสดง QR ให้ลูกค้าสแกน'}
                    </button>
                  )}

                  <h4 className="text-white font-bold mt-4 mb-2 text-sm">📷 แนบสลิปการโอน</h4>
                  {deliverSlipUrl ? (
                    <div className="bg-green-900/30 border border-green-800 rounded-2xl p-4 flex items-center gap-3">
                      <div className="text-green-400 text-2xl shrink-0">✅</div>
                      <div className="flex-1 text-green-300 text-sm font-bold">อัปโหลดสลิปแล้ว</div>
                      <button onClick={() => setDeliverSlipUrl('')} className="text-gray-500 hover:text-gray-300 shrink-0">✕</button>
                    </div>
                  ) : (
                    <div>
                      <button type="button" onClick={() => deliverSlipRef.current?.click()} disabled={deliverSlipUploading}
                        className="w-full bg-gray-800 hover:bg-gray-700 border-2 border-dashed border-gray-600 text-gray-300 font-medium py-5 rounded-2xl transition-colors flex flex-col items-center gap-2 disabled:opacity-60">
                        {deliverSlipUploading ? (
                          <><span className="text-2xl animate-spin">⏳</span><span className="text-sm">กำลังอ่านสลิป...</span></>
                        ) : (
                          <><span className="text-3xl">📷</span><span className="text-sm">ถ่ายรูป / เลือกสลิปโอน</span></>
                        )}
                      </button>
                      <input ref={deliverSlipRef} type="file" accept="image/*" capture="environment"
                        className="hidden" onChange={handleDeliverSlipCapture} />
                    </div>
                  )}
                </div>
              )}

              {/* สินค้าหมุนเวียน — ถามว่าลูกค้าคืนถังเปล่ามากี่ใบ */}
              {cyclicalItemsInOrder.length > 0 && (
                <div className="mb-4">
                  <h3 className="text-white font-bold mb-2 text-sm">🔄 ลูกค้าคืนถังเปล่ามาไหม</h3>
                  <div className="space-y-2">
                    {cyclicalItemsInOrder.map(item => (
                      <div key={item.sku} className="bg-gray-900 rounded-xl p-3 border border-gray-800 flex items-center justify-between gap-3">
                        <div className="text-gray-300 text-sm flex-1">{item.name}</div>
                        <input type="number" min="0" max={item.qty}
                          value={returnedQty[item.sku] || ''}
                          onChange={e => setReturnedQty(q => ({ ...q, [item.sku]: e.target.value }))}
                          placeholder="0"
                          className="w-16 bg-gray-800 text-white text-sm text-center px-2 py-2 rounded-lg border border-gray-700 focus:outline-none focus:border-green-500" />
                      </div>
                    ))}
                  </div>
                  <p className="text-gray-600 text-xs mt-1.5">ใส่จำนวนถังเปล่าที่รับคืนมา ถ้าลูกค้ายังไม่คืน ปล่อยว่างไว้</p>
                </div>
              )}

              <button
                onClick={confirmDeliverySubmit}
                disabled={deliverConfirming}
                className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-bold py-4 rounded-2xl text-lg transition-colors"
              >
                {deliverConfirming ? 'กำลังบันทึก...' : '✅ ยืนยันจัดส่งสำเร็จ'}
              </button>
            </div>
          )}

        </div>

        {/* Toast */}
        {toast && (
          <div className="fixed bottom-6 left-4 right-4 bg-green-700 text-white text-sm font-medium px-4 py-3 rounded-2xl text-center z-50 shadow-xl max-w-sm mx-auto">
            {toast}
          </div>
        )}
      </div>
    </>
  );
}
