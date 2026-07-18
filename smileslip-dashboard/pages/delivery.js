/**
 * /delivery - ระบบส่งของ Smile Slip Delivery
 * ข้อมูลลูกค้า+ออเดอร์ เก็บใน Google Sheets ของร้าน (PDPA compliant)
 */
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

const STATUS = {
  pending:   { label: 'รอดำเนินการ', color: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
  assigned:  { label: 'มอบหมายแล้ว', color: 'bg-blue-100 text-blue-800 border-blue-200' },
  delivered: { label: 'ส่งแล้ว',      color: 'bg-green-100 text-green-800 border-green-200' },
  paid:      { label: 'ชำระแล้ว',     color: 'bg-purple-100 text-purple-800 border-purple-200' },
  cancelled: { label: 'ยกเลิก',       color: 'bg-red-100 text-red-800 border-red-200' },
};

export default function DeliveryPage() {
  const router = useRouter();
  const { userId } = router.query;

  const [shopId, setShopId]     = useState(null);
  const [shopName, setShopName] = useState('');
  const [branches, setBranches] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [tab, setTab]           = useState('orders');

  // ── Setup ──
  const [configured, setConfigured]       = useState(false);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [settingUp, setSettingUp]         = useState(false);
  const [setupError, setSetupError]       = useState('');

  // ── Orders tab ──
  const [orders, setOrders]               = useState([]);
  const [orderFilter, setOrderFilter]     = useState('all');
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [ordersLoading, setOrdersLoading] = useState(false);

  // ── Create order tab ──
  const [phone, setPhone]                 = useState('');
  const [lookingUp, setLookingUp]         = useState(false);
  const [foundCustomer, setFoundCustomer] = useState(null);
  const [custName, setCustName]           = useState('');
  const [custAddress, setCustAddress]     = useState('');
  const [custCoords, setCustCoords]       = useState('');
  const [custNotes, setCustNotes]         = useState('');
  const [gettingLocation, setGettingLocation] = useState(false);
  const [items, setItems]                 = useState([{ name: '', qty: 1, price: '' }]);
  const [orderNotes, setOrderNotes]       = useState('');
  const [assignDriver, setAssignDriver]   = useState('');
  const [submitting, setSubmitting]       = useState(false);
  const [createSuccess, setCreateSuccess] = useState('');

  // ── Customers tab ──
  const [customers, setCustomers]           = useState([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [customerOrders, setCustomerOrders] = useState([]);
  const [custLoading, setCustLoading]       = useState(false);

  // ── Driver tab ──
  const [driverFilter, setDriverFilter] = useState('');
  const [driverOrders, setDriverOrders] = useState([]);

  // ── โหลดข้อมูลร้าน + เช็ค setup ──
  useEffect(() => {
    if (!userId) return;
    (async () => {
      const shopRes = await fetch(`/api/shop/data?userId=${userId}`).then(r => r.json()).catch(() => ({}));
      if (shopRes.profile) {
        const sid = shopRes.profile.id;
        setShopId(sid);
        setShopName(shopRes.profile.shop_name);
        setGoogleConnected(!!(shopRes.googleConfig?.google_refresh_token));

        const branchRes = await fetch(`/api/shop/branches?shopId=${sid}`).then(r => r.json()).catch(() => ({}));
        if (branchRes.branches) setBranches(branchRes.branches.filter(b => b.is_active));

        const s = await fetch(`/api/delivery/setup?shopId=${sid}`).then(r => r.json()).catch(() => ({}));
        setConfigured(!!s.configured);
      }
      setLoading(false);
    })();
  }, [userId]);

  // ── เปิดใช้ Delivery ──
  const runSetup = async () => {
    setSettingUp(true);
    setSetupError('');
    const r = await fetch('/api/delivery/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shopId }),
    }).then(r => r.json()).catch(e => ({ error: e.message }));
    if (r.ok) {
      setConfigured(true);
    } else if (r.notConnected) {
      setSetupError('กรุณาเชื่อมต่อ Google Drive ในหน้า Dashboard → การตั้งค่า ก่อนเปิด Delivery');
    } else {
      setSetupError(r.error || 'เกิดข้อผิดพลาด ลองใหม่อีกครั้ง');
    }
    setSettingUp(false);
  };

  // ── โหลดออเดอร์ ──
  const loadOrders = useCallback(async () => {
    if (!shopId || !configured) return;
    setOrdersLoading(true);
    const r = await fetch(`/api/delivery/orders?shopId=${shopId}&status=${orderFilter}`).then(r => r.json()).catch(() => ({}));
    setOrders(r.orders || []);
    setOrdersLoading(false);
  }, [shopId, configured, orderFilter]);

  useEffect(() => { if (tab === 'orders') loadOrders(); }, [tab, loadOrders]);

  // ── โหลดลูกค้า ──
  const loadCustomers = useCallback(async () => {
    if (!shopId || !configured) return;
    setCustLoading(true);
    const r = await fetch(`/api/delivery/customers?shopId=${shopId}&q=${encodeURIComponent(customerSearch)}`).then(r => r.json()).catch(() => ({}));
    setCustomers(r.customers || []);
    setCustLoading(false);
  }, [shopId, configured, customerSearch]);

  useEffect(() => { if (tab === 'customers') loadCustomers(); }, [tab, loadCustomers]);

  // ── ค้นหาเบอร์ ──
  const lookupPhone = async () => {
    if (!phone.trim() || !shopId) return;
    setLookingUp(true);
    setFoundCustomer(null);
    const r = await fetch(`/api/delivery/customers?shopId=${shopId}&phone=${encodeURIComponent(phone.trim())}`).then(r => r.json()).catch(() => ({}));
    if (r.customer) {
      setFoundCustomer(r.customer);
      setCustName(r.customer.name || '');
      setCustAddress(r.customer.address || '');
      setCustCoords(r.customer.coords || '');
      setCustNotes(r.customer.notes || '');
    } else {
      setCustName(''); setCustAddress(''); setCustCoords(''); setCustNotes('');
    }
    setLookingUp(false);
  };

  // ── GPS ──
  const getLocation = () => {
    if (!navigator.geolocation) { alert('เบราว์เซอร์ไม่รองรับ GPS'); return; }
    setGettingLocation(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        setCustCoords(`${pos.coords.latitude.toFixed(6)},${pos.coords.longitude.toFixed(6)}`);
        setGettingLocation(false);
      },
      err => { alert('รับพิกัดไม่ได้: ' + err.message); setGettingLocation(false); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  // ── สินค้า ──
  const addItem    = () => setItems(p => [...p, { name: '', qty: 1, price: '' }]);
  const removeItem = i  => setItems(p => p.filter((_, idx) => idx !== i));
  const updateItem = (i, f, v) => setItems(p => p.map((it, idx) => idx === i ? { ...it, [f]: v } : it));
  const totalAmount = items.reduce((s, it) => s + (parseFloat(it.price) || 0) * (parseInt(it.qty) || 0), 0);

  // ── สร้างออเดอร์ ──
  const submitOrder = async () => {
    if (!phone.trim() || !custName.trim()) { alert('กรุณากรอกเบอร์โทรและชื่อลูกค้า'); return; }
    if (items.some(it => !it.name.trim())) { alert('กรุณากรอกชื่อสินค้าทุกรายการ'); return; }
    setSubmitting(true);
    const r = await fetch('/api/delivery/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shopId, phone: phone.trim(), customerName: custName.trim(),
        deliveryAddress: custAddress.trim(), coords: custCoords.trim(),
        items, totalAmount, notes: orderNotes.trim(), driverName: assignDriver || null,
      }),
    }).then(r => r.json()).catch(e => ({ error: e.message }));
    if (r.ok) {
      setCreateSuccess(r.orderNo);
      setTimeout(() => {
        setCreateSuccess('');
        setPhone(''); setFoundCustomer(null);
        setCustName(''); setCustAddress(''); setCustCoords(''); setCustNotes('');
        setItems([{ name: '', qty: 1, price: '' }]);
        setOrderNotes(''); setAssignDriver('');
        setTab('orders');
      }, 2000);
    } else { alert('ผิดพลาด: ' + (r.error || 'unknown')); }
    setSubmitting(false);
  };

  // ── อัปเดตสถานะ ──
  const updateStatus = async (orderNo, status, extra = {}) => {
    await fetch(`/api/delivery/orders/${orderNo}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shopId, status, ...extra }),
    });
    setSelectedOrder(null);
    loadOrders();
    if (driverFilter) loadDriverOrders(driverFilter);
  };

  // ── เปิดประวัติลูกค้า ──
  const openCustomer = async (c) => {
    setSelectedCustomer(c);
    const r = await fetch(`/api/delivery/orders?shopId=${shopId}&phone=${encodeURIComponent(c.phone)}`).then(r => r.json()).catch(() => ({}));
    setCustomerOrders(r.orders || []);
  };

  // ── โหลดออเดอร์พนักงาน ──
  const loadDriverOrders = async (driver) => {
    setDriverFilter(driver);
    if (!driver) { setDriverOrders([]); return; }
    const r = await fetch(`/api/delivery/orders?shopId=${shopId}&driver=${encodeURIComponent(driver)}&status=assigned`).then(r => r.json()).catch(() => ({}));
    setDriverOrders(r.orders || []);
  };

  const fmt = (n) => parseFloat(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 });

  // ── Loading ──
  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <p className="text-gray-400 text-sm">กำลังโหลด...</p>
    </div>
  );

  // ── Setup Screen ──
  if (!configured) return (
    <>
      <Head>
        <title>เปิดใช้งาน Delivery — Smile Slip</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <div className="bg-blue-900 text-white px-4 py-3 flex items-center gap-3">
          <button onClick={() => router.push(`/dashboard?userId=${userId}`)} className="text-white/70 hover:text-white text-lg">←</button>
          <p className="font-bold text-sm">🚚 Smile Slip Delivery</p>
        </div>
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-sm w-full text-center space-y-5">
            <div className="text-6xl">🚚</div>
            <h1 className="text-xl font-bold text-gray-900">ระบบส่งของ Delivery</h1>
            <p className="text-sm text-gray-500 leading-relaxed">
              บันทึกออเดอร์ · ติดตามสถานะ · ดูประวัติลูกค้าพร้อมพิกัด<br/>
              ข้อมูลทั้งหมดเก็บใน <strong>Google Drive ของคุณ</strong>
            </p>

            {!googleConnected ? (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-left">
                <p className="text-sm font-bold text-amber-800">⚠️ ต้องเชื่อมต่อ Google Drive ก่อน</p>
                <p className="text-xs text-amber-600 mt-1">ไปที่ Dashboard → การตั้งค่า → เชื่อมต่อ Google Drive</p>
                <button onClick={() => router.push(`/dashboard?userId=${userId}`)}
                  className="mt-3 w-full bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold py-2 rounded-lg transition-colors">
                  ไปตั้งค่า →
                </button>
              </div>
            ) : (
              <>
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-left text-sm text-blue-700 space-y-1">
                  <p>✅ Google Drive: พร้อมแล้ว</p>
                  <p>📁 จะสร้างโฟลเดอร์ "📦 ระบบจัดส่ง" ใน Drive</p>
                  <p>📊 สร้าง Sheet ลูกค้า + Sheet ออเดอร์ อัตโนมัติ</p>
                </div>
                {setupError && (
                  <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-xl p-3">{setupError}</p>
                )}
                <button onClick={runSetup} disabled={settingUp}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-3.5 rounded-xl font-bold text-base transition-colors shadow-lg">
                  {settingUp ? 'กำลังสร้าง Sheets...' : '🚀 เปิดใช้งาน Delivery'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );

  // ── Main App ──
  return (
    <>
      <Head>
        <title>Delivery — {shopName}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <div className="min-h-screen bg-gray-50 flex flex-col">

        {/* Header */}
        <div className="bg-blue-900 text-white px-4 py-3 flex items-center gap-3 sticky top-0 z-40 shadow-lg">
          <button onClick={() => router.push(`/dashboard?userId=${userId}`)} className="text-white/70 hover:text-white text-lg">←</button>
          <div className="flex-1">
            <p className="font-bold text-sm">🚚 Delivery</p>
            <p className="text-xs text-white/60">{shopName}</p>
          </div>
          <button onClick={() => setTab('create')}
            className="bg-white/20 hover:bg-white/30 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors">
            + ออเดอร์ใหม่
          </button>
        </div>

        {/* Tabs */}
        <div className="bg-white border-b flex sticky top-14 z-30 shadow-sm">
          {[['orders','📋 ออเดอร์'],['create','➕ สร้าง'],['driver','🛵 พนักงาน']].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`flex-1 px-2 sm:px-5 py-3 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                tab === k ? 'border-blue-600 text-blue-600 bg-blue-50' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}>
              {l}
            </button>
          ))}
        </div>

        <div className="flex-1 max-w-2xl mx-auto w-full p-4 pb-12">

          {/* ═══ ORDERS ═══ */}
          {tab === 'orders' && (
            <div>
              <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
                {[['all','ทั้งหมด'],['pending','รอ'],['assigned','มอบหมาย'],['delivered','ส่งแล้ว'],['paid','ชำระแล้ว']].map(([k, v]) => (
                  <button key={k} onClick={() => setOrderFilter(k)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-colors ${
                      orderFilter === k ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'
                    }`}>{v}</button>
                ))}
              </div>

              {ordersLoading ? (
                <div className="text-center py-10 text-gray-400 text-sm">กำลังโหลด...</div>
              ) : orders.length === 0 ? (
                <div className="text-center py-16 text-gray-400">
                  <p className="text-5xl mb-3">📦</p>
                  <p className="text-sm">ยังไม่มีออเดอร์</p>
                  <button onClick={() => setTab('create')} className="mt-3 text-blue-600 text-sm font-medium">+ สร้างออเดอร์แรก</button>
                </div>
              ) : (
                <div className="space-y-3">
                  {orders.map((order, i) => (
                    <div key={i} className="bg-white rounded-xl border shadow-sm p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            <span className="font-semibold text-gray-900">{order.customer_name}</span>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${STATUS[order.status]?.color}`}>
                              {STATUS[order.status]?.label}
                            </span>
                          </div>
                          <p className="text-xs text-gray-500">📞 {order.customer_phone}</p>
                          {order.delivery_address && <p className="text-xs text-gray-500 mt-0.5 truncate">📍 {order.delivery_address}</p>}
                          {order.coords && (
                            <a href={`https://www.google.com/maps?q=${order.coords}`} target="_blank" rel="noreferrer"
                              className="text-xs text-blue-500 mt-0.5 block">🗺️ ดูแผนที่</a>
                          )}
                          {order.driver_name && <p className="text-xs text-blue-600 mt-0.5">🛵 {order.driver_name}</p>}
                          <div className="flex items-center gap-3 mt-1.5">
                            <span className="text-sm font-bold text-green-700">฿{fmt(order.total_amount)}</span>
                            <span className="text-[10px] text-gray-400 font-mono">{order.order_no}</span>
                          </div>
                        </div>
                        <button onClick={() => setSelectedOrder(order)}
                          className="text-blue-600 text-xs border border-blue-200 rounded-lg px-2.5 py-1.5 hover:bg-blue-50 transition-colors shrink-0">
                          จัดการ
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ═══ CREATE ═══ */}
          {tab === 'create' && (
            <div className="space-y-4">
              {createSuccess && (
                <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center text-green-700 font-medium">
                  ✅ สร้างออเดอร์สำเร็จ! <span className="font-mono text-sm">{createSuccess}</span>
                </div>
              )}

              <div className="bg-white rounded-xl border shadow-sm p-4">
                <h3 className="font-semibold text-gray-700 mb-3 text-sm">📞 เบอร์โทรลูกค้า</h3>
                <div className="flex gap-2">
                  <input type="tel" value={phone} onChange={e => { setPhone(e.target.value); setFoundCustomer(null); }}
                    placeholder="0812345678" onKeyDown={e => e.key === 'Enter' && lookupPhone()}
                    className="flex-1 border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                  <button onClick={lookupPhone} disabled={lookingUp || !phone.trim()}
                    className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-blue-700 transition-colors">
                    {lookingUp ? '...' : 'ค้นหา'}
                  </button>
                </div>
                {foundCustomer && (
                  <div className="mt-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                    <p className="text-sm text-green-700 font-medium">✅ พบลูกค้า: {foundCustomer.name}</p>
                    {foundCustomer.order_count > 0 && <p className="text-xs text-green-600 mt-0.5">สั่งมาแล้ว {foundCustomer.order_count} ครั้ง</p>}
                  </div>
                )}
                {phone && !foundCustomer && !lookingUp && (
                  <p className="mt-2 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    ⚠️ ไม่พบลูกค้า — จะสร้างข้อมูลใหม่
                  </p>
                )}
              </div>

              {phone && (
                <>
                  <div className="bg-white rounded-xl border shadow-sm p-4 space-y-3">
                    <h3 className="font-semibold text-gray-700 text-sm">👤 ข้อมูลลูกค้า</h3>
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">ชื่อลูกค้า *</label>
                      <input value={custName} onChange={e => setCustName(e.target.value)} placeholder="ชื่อ-นามสกุล"
                        className="w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">ที่อยู่จัดส่ง</label>
                      <textarea value={custAddress} onChange={e => setCustAddress(e.target.value)} rows={2}
                        placeholder="บ้านเลขที่ / ซอย / ถนน / ตำบล / อำเภอ"
                        className="w-full border rounded-lg px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-300" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">พิกัด GPS <span className="text-gray-400">(ไม่บังคับ)</span></label>
                      <div className="flex gap-2">
                        <input value={custCoords} onChange={e => setCustCoords(e.target.value)}
                          placeholder="13.736717,100.523186"
                          className="flex-1 border rounded-lg px-3 py-2.5 text-sm font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-300" />
                        <button onClick={getLocation} disabled={gettingLocation}
                          className="shrink-0 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 border text-gray-700 text-xs px-3 py-2 rounded-lg transition-colors">
                          {gettingLocation ? '...' : '📍 GPS'}
                        </button>
                      </div>
                      {custCoords && (
                        <a href={`https://www.google.com/maps?q=${custCoords}`} target="_blank" rel="noreferrer"
                          className="mt-1 text-xs text-blue-500 block">🗺️ ดูบน Google Maps →</a>
                      )}
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">หมายเหตุลูกค้า</label>
                      <input value={custNotes} onChange={e => setCustNotes(e.target.value)}
                        placeholder="เช่น ชำระเงินเสมอ, ต้องโทรก่อนส่ง"
                        className="w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                    </div>
                  </div>

                  <div className="bg-white rounded-xl border shadow-sm p-4">
                    <h3 className="font-semibold text-gray-700 mb-3 text-sm">🛒 รายการสินค้า</h3>
                    <div className="grid grid-cols-12 gap-1 mb-1">
                      <span className="col-span-5 text-[10px] text-gray-400">ชื่อสินค้า</span>
                      <span className="col-span-2 text-[10px] text-gray-400 text-center">จำนวน</span>
                      <span className="col-span-4 text-[10px] text-gray-400">ราคา/ชิ้น</span>
                    </div>
                    {items.map((item, i) => (
                      <div key={i} className="grid grid-cols-12 gap-1 items-center mb-1.5">
                        <input value={item.name} onChange={e => updateItem(i, 'name', e.target.value)} placeholder="ชื่อสินค้า"
                          className="col-span-5 border rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-300" />
                        <input type="number" value={item.qty} onChange={e => updateItem(i, 'qty', e.target.value)} min="1"
                          className="col-span-2 border rounded-lg px-1 py-2 text-sm text-center focus:outline-none focus:ring-1 focus:ring-blue-300" />
                        <input type="number" value={item.price} onChange={e => updateItem(i, 'price', e.target.value)} placeholder="0"
                          className="col-span-4 border rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-300" />
                        <button onClick={() => removeItem(i)} disabled={items.length === 1}
                          className="col-span-1 text-red-400 text-xl text-center disabled:opacity-20">×</button>
                      </div>
                    ))}
                    <button onClick={addItem} className="mt-1 text-blue-600 text-sm font-medium hover:text-blue-700">+ เพิ่มรายการ</button>
                    <div className="mt-3 pt-3 border-t flex justify-between items-center">
                      <span className="text-sm text-gray-600">ยอดรวม</span>
                      <span className="text-lg font-bold text-green-600">฿{fmt(totalAmount)}</span>
                    </div>
                  </div>

                  <div className="bg-white rounded-xl border shadow-sm p-4 space-y-3">
                    <h3 className="font-semibold text-gray-700 text-sm">🛵 มอบหมายพนักงานส่ง</h3>
                    <select value={assignDriver} onChange={e => setAssignDriver(e.target.value)}
                      className="w-full border rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-300">
                      <option value="">— ยังไม่มอบหมาย —</option>
                      {branches.map(b => <option key={b.id} value={b.branch_name}>{b.branch_name}</option>)}
                    </select>
                    <input value={orderNotes} onChange={e => setOrderNotes(e.target.value)} placeholder="หมายเหตุออเดอร์"
                      className="w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                  </div>

                  <button onClick={submitOrder} disabled={submitting || !!createSuccess}
                    className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-3.5 rounded-xl font-bold text-base transition-colors shadow-lg">
                    {submitting ? 'กำลังบันทึก...' : '✅ สร้างออเดอร์'}
                  </button>
                </>
              )}
            </div>
          )}

          {/* ═══ CUSTOMERS ═══ */}
          {tab === 'customers' && (
            <div>
              {selectedCustomer ? (
                <div>
                  <button onClick={() => { setSelectedCustomer(null); setCustomerOrders([]); }}
                    className="text-blue-600 text-sm mb-3 hover:text-blue-700">← กลับ</button>
                  <div className="bg-white rounded-xl border shadow-sm p-4 mb-4">
                    <h3 className="font-bold text-base text-gray-900">{selectedCustomer.name || 'ไม่ระบุชื่อ'}</h3>
                    <p className="text-sm text-gray-500 mt-1">📞 {selectedCustomer.phone}</p>
                    {selectedCustomer.address && <p className="text-sm text-gray-500 mt-0.5">📍 {selectedCustomer.address}</p>}
                    {selectedCustomer.coords && (
                      <a href={`https://www.google.com/maps?q=${selectedCustomer.coords}`} target="_blank" rel="noreferrer"
                        className="text-sm text-blue-500 mt-0.5 block">🗺️ ดูแผนที่จัดส่ง →</a>
                    )}
                    {selectedCustomer.notes && <p className="text-sm text-gray-400 mt-0.5">💬 {selectedCustomer.notes}</p>}
                    <button onClick={() => {
                      setPhone(selectedCustomer.phone);
                      setFoundCustomer(selectedCustomer);
                      setCustName(selectedCustomer.name || '');
                      setCustAddress(selectedCustomer.address || '');
                      setCustCoords(selectedCustomer.coords || '');
                      setCustNotes(selectedCustomer.notes || '');
                      setItems([{ name: '', qty: 1, price: '' }]);
                      setTab('create');
                    }} className="mt-3 w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2 rounded-lg transition-colors">
                      + สร้างออเดอร์ให้ลูกค้านี้
                    </button>
                  </div>
                  <h4 className="font-semibold text-gray-700 text-sm mb-2">ประวัติออเดอร์ ({customerOrders.length})</h4>
                  <div className="space-y-2">
                    {customerOrders.map((o, i) => (
                      <div key={i} className="bg-white border rounded-xl p-3">
                        <div className="flex justify-between items-start mb-1">
                          <span className="font-semibold text-sm text-green-700">฿{fmt(o.total_amount)}</span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${STATUS[o.status]?.color}`}>{STATUS[o.status]?.label}</span>
                        </div>
                        <p className="text-xs font-mono text-gray-400">{o.order_no}</p>
                        <p className="text-xs text-gray-400">{o.created_at}</p>
                        {o.items_text && <p className="text-xs text-gray-600 mt-0.5 line-clamp-2">{o.items_text}</p>}
                      </div>
                    ))}
                    {customerOrders.length === 0 && <p className="text-center text-gray-400 text-sm py-8">ยังไม่มีออเดอร์</p>}
                  </div>
                </div>
              ) : (
                <>
                  <input value={customerSearch} onChange={e => setCustomerSearch(e.target.value)}
                    placeholder="🔍 ค้นหาด้วยเบอร์โทรหรือชื่อ..."
                    className="w-full border rounded-xl px-4 py-2.5 bg-white shadow-sm text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 mb-4" />
                  {custLoading ? (
                    <div className="text-center py-10 text-gray-400 text-sm">กำลังโหลด...</div>
                  ) : customers.length === 0 ? (
                    <div className="text-center py-16 text-gray-400">
                      <p className="text-5xl mb-3">👤</p>
                      <p className="text-sm">ยังไม่มีลูกค้า</p>
                      <p className="text-xs mt-1">ลูกค้าจะถูกบันทึกอัตโนมัติเมื่อสร้างออเดอร์</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {customers.map((c, i) => (
                        <div key={i} onClick={() => openCustomer(c)}
                          className="bg-white rounded-xl border shadow-sm p-4 cursor-pointer hover:border-blue-300 transition-colors">
                          <div className="flex items-center justify-between">
                            <div className="min-w-0 flex-1">
                              <p className="font-semibold text-gray-900">{c.name || 'ไม่ระบุชื่อ'}</p>
                              <p className="text-xs text-gray-500 mt-0.5">📞 {c.phone}</p>
                              {c.address && <p className="text-xs text-gray-400 mt-0.5 truncate">📍 {c.address}</p>}
                              {c.coords && <p className="text-xs text-blue-400 mt-0.5">🗺️ มีพิกัด GPS</p>}
                            </div>
                            <p className="text-[10px] text-gray-400 shrink-0 ml-3">ดูประวัติ →</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ═══ DRIVER ═══ */}
          {tab === 'driver' && (
            <div>
              <div className="bg-white rounded-xl border shadow-sm p-4 mb-4">
                <h3 className="font-semibold text-gray-700 text-sm mb-3">🛵 เลือกพนักงาน / รถส่ง</h3>
                <select value={driverFilter} onChange={e => loadDriverOrders(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-300">
                  <option value="">— เลือกพนักงาน —</option>
                  {branches.map(b => <option key={b.id} value={b.branch_name}>{b.branch_name}</option>)}
                </select>
                {branches.length === 0 && (
                  <p className="mt-2 text-xs text-amber-600">ยังไม่มีสาขา —{' '}
                    <button onClick={() => router.push(`/dashboard?userId=${userId}`)} className="underline">จัดการสาขา</button>
                  </p>
                )}
              </div>

              {driverFilter && (
                driverOrders.length === 0 ? (
                  <div className="text-center py-12 text-gray-400">
                    <p className="text-4xl mb-2">✅</p>
                    <p className="text-sm">ไม่มีออเดอร์ค้างส่ง</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {driverOrders.map((order, i) => (
                      <div key={i} className="bg-white rounded-xl border shadow-sm p-4">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-gray-900">{order.customer_name}</p>
                            <p className="text-xs text-gray-500">📞 {order.customer_phone}</p>
                            {order.delivery_address && <p className="text-xs text-gray-600 mt-0.5">📍 {order.delivery_address}</p>}
                            {order.coords && (
                              <a href={`https://www.google.com/maps?q=${order.coords}`} target="_blank" rel="noreferrer"
                                className="text-xs text-blue-500 mt-0.5 block">🗺️ นำทาง Google Maps →</a>
                            )}
                          </div>
                          <span className="text-sm font-bold text-green-700 shrink-0">฿{fmt(order.total_amount)}</span>
                        </div>
                        <div className="bg-gray-50 rounded-lg p-2 mb-3 text-xs text-gray-700">{order.items_text || '—'}</div>
                        {order.notes && <p className="text-xs text-amber-600 mb-2">💬 {order.notes}</p>}
                        <button onClick={() => updateStatus(order.order_no, 'delivered')}
                          className="w-full bg-green-600 hover:bg-green-700 text-white py-2 rounded-lg text-sm font-medium transition-colors">
                          ✅ ยืนยันส่งสำเร็จ
                        </button>
                      </div>
                    ))}
                  </div>
                )
              )}
            </div>
          )}

        </div>
      </div>

      {/* ═══ ORDER MODAL ═══ */}
      {selectedOrder && (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
          <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md max-h-[90vh] overflow-y-auto">
            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-base text-gray-900">จัดการออเดอร์</h3>
                <button onClick={() => setSelectedOrder(null)} className="text-gray-400 text-xl hover:text-gray-600">✕</button>
              </div>

              <div className="space-y-1.5 text-sm mb-4">
                <div className="flex justify-between">
                  <span className="text-gray-500">เลขออเดอร์</span>
                  <span className="font-mono text-xs">{selectedOrder.order_no}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">สถานะ</span>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${STATUS[selectedOrder.status]?.color}`}>
                    {STATUS[selectedOrder.status]?.label}
                  </span>
                </div>
                <div className="flex justify-between"><span className="text-gray-500">ลูกค้า</span><span className="font-medium">{selectedOrder.customer_name}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">โทร</span><span>{selectedOrder.customer_phone}</span></div>
                {selectedOrder.delivery_address && (
                  <div className="flex justify-between gap-3">
                    <span className="text-gray-500 shrink-0">ที่อยู่</span>
                    <span className="text-right text-xs">{selectedOrder.delivery_address}</span>
                  </div>
                )}
                {selectedOrder.coords && (
                  <a href={`https://www.google.com/maps?q=${selectedOrder.coords}`} target="_blank" rel="noreferrer"
                    className="text-blue-500 text-sm block">🗺️ Google Maps →</a>
                )}
                {selectedOrder.driver_name && <div className="flex justify-between"><span className="text-gray-500">พนักงานส่ง</span><span>{selectedOrder.driver_name}</span></div>}
              </div>

              <div className="bg-gray-50 rounded-xl p-3 mb-4">
                <p className="text-xs font-semibold text-gray-600 mb-1.5">รายการสินค้า</p>
                <p className="text-xs text-gray-700">{selectedOrder.items_text || '—'}</p>
                <div className="flex justify-between text-sm font-bold border-t border-gray-200 mt-2 pt-2">
                  <span>รวม</span>
                  <span className="text-green-600">฿{fmt(selectedOrder.total_amount)}</span>
                </div>
              </div>

              <div className="space-y-2">
                {selectedOrder.status === 'pending' && (
                  <button onClick={() => updateStatus(selectedOrder.order_no, 'assigned')}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-xl text-sm font-bold transition-colors">
                    📋 ยืนยันมอบหมาย
                  </button>
                )}
                {selectedOrder.status === 'assigned' && (
                  <button onClick={() => updateStatus(selectedOrder.order_no, 'delivered')}
                    className="w-full bg-green-600 hover:bg-green-700 text-white py-2.5 rounded-xl text-sm font-bold transition-colors">
                    📦 ยืนยันส่งสำเร็จ
                  </button>
                )}
                {selectedOrder.status === 'delivered' && (
                  <>
                    <button onClick={() => updateStatus(selectedOrder.order_no, 'paid', { payment_method: 'cash' })}
                      className="w-full bg-purple-600 hover:bg-purple-700 text-white py-2.5 rounded-xl text-sm font-bold transition-colors">
                      💵 ชำระแล้ว — เงินสด
                    </button>
                    <button onClick={() => updateStatus(selectedOrder.order_no, 'paid', { payment_method: 'transfer' })}
                      className="w-full bg-purple-500 hover:bg-purple-600 text-white py-2.5 rounded-xl text-sm font-bold transition-colors">
                      💳 ชำระแล้ว — โอน
                    </button>
                  </>
                )}
                {['pending', 'assigned'].includes(selectedOrder.status) && (
                  <button onClick={() => { if (confirm('ยืนยันยกเลิกออเดอร์?')) updateStatus(selectedOrder.order_no, 'cancelled'); }}
                    className="w-full border border-red-200 text-red-500 hover:bg-red-50 py-2.5 rounded-xl text-sm font-medium transition-colors">
                    ❌ ยกเลิกออเดอร์
                  </button>
                )}
                {['paid', 'cancelled'].includes(selectedOrder.status) && (
                  <p className="text-center text-xs text-gray-400 py-2">ออเดอร์นี้เสร็จสิ้นแล้ว</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
