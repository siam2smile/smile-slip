/**
 * หน้าพนักงาน: ยืนยันการโอนเงิน (Staff PIN page)
 * เข้าด้วย PIN 4 หลัก → เห็นบิลที่ "รอยืนยัน" → ถ่ายสลิปยืนยัน
 * mobile-first, บุ๊กมาร์กได้ ไม่ต้อง login LINE
 */
import { useState, useRef, useEffect } from 'react';
import Head from 'next/head';
import Script from 'next/script';
import { useRouter } from 'next/router';
import { withBrandFooter } from '../lib/branding';

// ก็อปจาก pages/pos.js ตามธรรมเนียมโปรเจกต์ (คนละ bundle คนละหน้า ไม่แชร์ component ข้ามไฟล์)
// ใช้ Leaflet + OpenStreetMap ฟรี ไม่ต้องมี API key — คนขับปักหมุดตำแหน่งจัดส่งจริงเองได้
function MapPickerModal({ initCoords, onConfirm, onClose }) {
  const mapDivRef = useRef(null);
  const leafletMapRef = useRef(null);
  const markerRef = useRef(null);
  const [pickedCoords, setPickedCoords] = useState(initCoords || null);
  const [loadState, setLoadState] = useState('loading');
  const [gpsLoading, setGpsLoading] = useState(false);

  useEffect(() => {
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css';
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }

    if (window.L) { initLeaflet(); return; }

    if (document.getElementById('leaflet-js')) {
      const timer = setInterval(() => { if (window.L) { clearInterval(timer); initLeaflet(); } }, 100);
      return () => clearInterval(timer);
    }

    const script = document.createElement('script');
    script.id = 'leaflet-js';
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = initLeaflet;
    script.onerror = () => setLoadState('error');
    document.head.appendChild(script);
  }, []);

  function initLeaflet() {
    if (!mapDivRef.current || leafletMapRef.current) return;
    setLoadState('ready');

    const center = initCoords ? [initCoords.lat, initCoords.lng] : [13.7563, 100.5018];
    const zoom = initCoords ? 16 : 12;
    const map = window.L.map(mapDivRef.current).setView(center, zoom);

    window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    if (initCoords) {
      markerRef.current = window.L.marker([initCoords.lat, initCoords.lng]).addTo(map);
    }

    map.on('click', e => {
      const lat = parseFloat(e.latlng.lat.toFixed(6));
      const lng = parseFloat(e.latlng.lng.toFixed(6));
      if (markerRef.current) {
        markerRef.current.setLatLng([lat, lng]);
      } else {
        markerRef.current = window.L.marker([lat, lng]).addTo(map);
      }
      setPickedCoords({ lat, lng });
    });

    leafletMapRef.current = map;
  }

  function useCurrentGps() {
    if (!navigator.geolocation) { alert('เบราว์เซอร์ไม่รองรับ GPS'); return; }
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(pos => {
      const lat = parseFloat(pos.coords.latitude.toFixed(6));
      const lng = parseFloat(pos.coords.longitude.toFixed(6));
      if (leafletMapRef.current) {
        leafletMapRef.current.setView([lat, lng], 17);
        if (markerRef.current) { markerRef.current.setLatLng([lat, lng]); }
        else { markerRef.current = window.L.marker([lat, lng]).addTo(leafletMapRef.current); }
        setPickedCoords({ lat, lng });
      }
      setGpsLoading(false);
    }, () => { alert('ดึง GPS ไม่ได้ — กรุณาอนุญาตการเข้าถึงตำแหน่ง'); setGpsLoading(false); },
    { enableHighAccuracy: true, timeout: 10000 });
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-3">
      <div className="bg-white rounded-2xl w-full max-w-lg border border-gray-200 shadow-2xl overflow-hidden flex flex-col" style={{ maxHeight: '92vh' }}>
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between shrink-0">
          <div>
            <h3 className="text-gray-900 font-bold text-sm">📍 เลือกตำแหน่งบนแผนที่</h3>
            <p className="text-gray-400 text-xs mt-0.5">แตะบนแผนที่เพื่อวางหมุด</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-900 text-xl w-8 h-8 flex items-center justify-center">✕</button>
        </div>

        <div className="relative" style={{ height: '360px', flexShrink: 0 }}>
          <div ref={mapDivRef} style={{ height: '100%', width: '100%' }} />
          {loadState === 'loading' && (
            <div className="absolute inset-0 flex items-center justify-center bg-white text-gray-500 text-sm animate-pulse">
              กำลังโหลดแผนที่...
            </div>
          )}
          {loadState === 'error' && (
            <div className="absolute inset-0 flex items-center justify-center bg-white text-red-600 text-sm text-center px-4">
              โหลดแผนที่ไม่ได้<br/>ตรวจสอบการเชื่อมต่ออินเทอร์เน็ต
            </div>
          )}
        </div>

        <div className="p-3 space-y-2 shrink-0">
          {pickedCoords ? (
            <div className="bg-white rounded-xl px-3 py-2 text-xs text-green-600 flex items-center gap-2">
              <span>✅</span>
              <span className="flex-1">วางหมุดที่ {pickedCoords.lat}, {pickedCoords.lng}</span>
            </div>
          ) : (
            <div className="bg-white/50 rounded-xl px-3 py-2 text-xs text-gray-400 text-center">
              ยังไม่ได้วางหมุด — แตะบนแผนที่เพื่อเลือกตำแหน่ง
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={useCurrentGps} disabled={gpsLoading}
              className="flex-1 bg-gray-100 hover:bg-blue-100 disabled:opacity-50 text-gray-700 hover:text-gray-900 text-xs py-2.5 rounded-xl transition-colors flex items-center justify-center gap-1.5 border border-gray-300">
              {gpsLoading
                ? <><span className="animate-spin inline-block">⏳</span> กำลังดึง GPS...</>
                : <><span>🎯</span> ตำแหน่งปัจจุบัน</>}
            </button>
            <button onClick={() => pickedCoords && onConfirm(pickedCoords.lat, pickedCoords.lng)}
              disabled={!pickedCoords}
              className="flex-1 bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-sm py-2.5 rounded-xl transition-colors">
              ยืนยัน
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PosStaffPage() {
  const router = useRouter();
  const {
    shopId, order_no: deepLinkOrderNo, collection_no: deepLinkCollectionNo,
    staff_id: setupStaffId, setpin: setupMode, token: setupToken,
  } = router.query;

  // 'loading' | 'name' | 'pin' | 'setpin' | 'menu' | 'bills' | 'confirm' | 'deliveries' |
  // 'deliver-confirm' | 'collections' | 'collect-confirm' | 'manage'
  const [step, setStep] = useState('loading');
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [pinLoading, setPinLoading] = useState(false);
  const [shopName, setShopName] = useState('');
  const [staffName, setStaffName] = useState('');
  const [staffBranch, setStaffBranch] = useState(''); // สาขาที่พนักงานคนนี้ผูกอยู่ (ตั้งค่าจากตอนอนุมัติ/เพิ่มพนักงาน)
  const [staffId, setStaffId] = useState(''); // staff_id ของคนที่ login สำเร็จ (ใช้ผูกกับ PIN)
  // เลือกชื่อตัวเองก่อนใส่ PIN (fallback เมื่อไม่ได้เปิดจากแอปไลน์) — ระบุตัวตนก่อนแล้วค่อยเช็ค
  // PIN เฉพาะคนนั้น แทนการค้นหา PIN ข้ามพนักงานทั้งร้านแบบเดิม (ดู verify-pin.js สำหรับเหตุผลเต็ม)
  const [pickerList, setPickerList] = useState([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [selectedPicker, setSelectedPicker] = useState(null); // { staff_id, name, branch_name }
  // ถ้าเปิดจากในแอปไลน์ (LIFF) จะรู้ไลไอดีอัตโนมัติทันที ข้ามหน้าเลือกชื่อไปเข้าหน้า PIN ตรงเลย
  const [liffLineId, setLiffLineId] = useState('');
  const authResolvedRef = useRef(false); // กันหลายเส้นทาง (setup-mode/กู้ session/LIFF) ตัดสินใจ step ซ้อนกัน
  const [staffPerms, setStaffPerms] = useState({ perm_view_revenue: false, perm_view_pl: false, perm_manage_stock: false, perm_export_vat: false });
  const [isWhiteLabel, setIsWhiteLabel] = useState(false);
  // session ที่เซ็นชื่อ (HMAC) จาก verify-pin — ใช้ ref เพราะต้องอ่านค่าล่าสุดได้ทันทีหลัง
  // setState (React state ไม่อัปเดตแบบ sync ในฟังก์ชันเดียวกัน) แนบเป็น header ทุกคำขอที่ apiFetch
  // ยิงออกไป (เดิมไม่มี session ที่พิสูจน์ได้เลย ส่งแค่ staffId เปล่าๆ ที่ปลอมได้ตรงๆ)
  const sessionRef = useRef('');
  const sessionStorageKey = shopId ? `pos_staff_session_${shopId}` : null;

  // ── จัดการร้าน (สิทธิ์พิเศษที่แอดมินเปิดให้เป็นรายคน) ────────────────────
  const [manageView, setManageView] = useState(''); // 'revenue' | 'pl' | 'stock' | 'vat'
  const [manageLoading, setManageLoading] = useState(false);
  const [manageSalesReport, setManageSalesReport] = useState(null);
  const [managePlReport, setManagePlReport] = useState(null);
  const [manageStockList, setManageStockList] = useState([]);
  const [manageStockSaving, setManageStockSaving] = useState('');

  // ── บันทึกประจำวัน (ปัญหา/คำชม/สต็อกใกล้หมด) — Enterprise เท่านั้น (backend เช็คซ้ำอยู่แล้ว) ──
  const [dailyLogProblem, setDailyLogProblem] = useState('');
  const [dailyLogUrgency, setDailyLogUrgency] = useState('normal'); // 'normal' | 'warning' | 'urgent'
  const [dailyLogPraise, setDailyLogPraise] = useState('');
  const [dailyLogLowStock, setDailyLogLowStock] = useState('');
  const [dailyLogPhotoUrl, setDailyLogPhotoUrl] = useState('');
  const [dailyLogPhotoUploading, setDailyLogPhotoUploading] = useState(false);
  const [dailyLogSubmitting, setDailyLogSubmitting] = useState(false);
  const [dailyLogResult, setDailyLogResult] = useState(null); // ผลลัพธ์หลังบันทึกสำเร็จ (โชว์ยอดขายกะที่ auto-pull มา)
  const dailyLogPhotoRef = useRef(null);

  // ── ตั้งรหัส PIN ครั้งแรก (มาจากลิงก์ที่ส่งทาง LINE หลังได้รับอนุมัติ/แอดมินเพิ่ม) ──────
  const [newPin, setNewPin] = useState('');
  const [newPinConfirm, setNewPinConfirm] = useState('');
  const [newPinError, setNewPinError] = useState('');
  const [setPinSaving, setSetPinSaving] = useState(false);

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
  const [deliverPartialPaid, setDeliverPartialPaid] = useState(''); // ค้างจ่าย: จ่ายมาบางส่วนแล้วเท่าไหร่ (ว่าง = ค้างเต็มจำนวน)
  const [deliverSlipUrl, setDeliverSlipUrl] = useState('');
  const [deliverSlipUploading, setDeliverSlipUploading] = useState(false);
  const [deliverQr, setDeliverQr] = useState('');
  const [deliverQrLoading, setDeliverQrLoading] = useState(false);
  // ค่าเริ่มต้น = ลูกค้านำของเก่ามาแลกครบทุกชิ้น (exchange) — ถ้ายืมไม่คืนของเก่า ต้องกดปุ่ม "ยืม" แล้วใส่จำนวนที่ยืมแยกต่างหาก
  const [borrowingSku, setBorrowingSku] = useState({}); // { sku: true } — เปิดโหมดยืมสำหรับ SKU นั้น
  const [borrowedQty, setBorrowedQty] = useState({}); // { sku: จำนวนที่ยืม (ไม่คืนของเก่า) }
  const [deliverConfirming, setDeliverConfirming] = useState(false);
  // ส่วนลดออเดอร์จัดส่ง — พนักงานปรับราคาต่อชิ้นไม่ได้ แต่กดส่วนลดรวมทั้งบิลได้ (แอดมินตรวจสอบได้ทีหลังถ้าผิดพลาด)
  const [deliverDiscountType, setDeliverDiscountType] = useState('amount'); // 'amount' | 'percent'
  const [deliverDiscountValue, setDeliverDiscountValue] = useState('');
  const [deliverDone, setDeliverDone] = useState(null); // ผลลัพธ์หลังยืนยันจัดส่งสำเร็จ — ใช้แสดงปุ่มพิมพ์สลิป
  const deliverSlipRef = useRef(null);

  // แก้ที่อยู่/ปักหมุดใหม่จากหน้าคนขับ — ลูกค้าบางรายมีทั้งบ้าน+ร้าน หรือหลายบ้าน หมุดที่ตั้งไว้ตอน
  // สร้างออเดอร์อาจผิด/ไม่ตรงจุดที่ต้องส่งจริง คนขับควรแก้ไขได้เองตอนไปถึงหน้างานโดยไม่ต้องรอแอดมิน
  const [editingDeliveryAddress, setEditingDeliveryAddress] = useState(false);
  const [editAddressText, setEditAddressText] = useState('');
  const [editMapsLink, setEditMapsLink] = useState('');
  const [savingDeliveryAddress, setSavingDeliveryAddress] = useState(false);
  const [showStaffMapPicker, setShowStaffMapPicker] = useState(false);

  // ── งานเก็บเงิน/ของ (collections) ────────────────────────────────────────
  const [collectionTasks, setCollectionTasks] = useState([]);
  const [collectionTasksLoading, setCollectionTasksLoading] = useState(false);
  const [selectedCollection, setSelectedCollection] = useState(null);
  const [collectedAmount, setCollectedAmount] = useState('');
  const [collectedItemsQty, setCollectedItemsQty] = useState({}); // { sku: qty }
  const [collectSlipUrl, setCollectSlipUrl] = useState('');
  const [collectSlipUploading, setCollectSlipUploading] = useState(false);
  const [collectFailNote, setCollectFailNote] = useState('');
  const [collectSubmitting, setCollectSubmitting] = useState(false);
  const collectSlipRef = useRef(null);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  }

  // fetch wrapper แนบ session ที่เซ็นชื่อ (ถ้ามี) เป็น header เสมอ — ใช้แทน fetch() ตรงๆ ทุกจุด
  // ที่เคยส่ง staffId เปล่าๆ ไปกับ body/query (ปลอมได้ตรงๆ) — ถ้า session หมดอายุ/ไม่ถูกต้อง
  // (401 จาก server) จะเคลียร์ session ทิ้งแล้วเด้งกลับหน้าใส่ PIN ทันที
  async function apiFetch(url, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (sessionRef.current) headers['x-staff-session'] = sessionRef.current;
    const r = await fetch(url, { ...options, headers });
    if (r.status === 401) {
      clearSession();
      setStep('pin');
      setPinError('session หมดอายุ กรุณาใส่ PIN ใหม่อีกครั้ง');
    }
    return r;
  }

  function saveSession(payload) {
    sessionRef.current = payload.sessionToken || '';
    if (sessionStorageKey) {
      try { sessionStorage.setItem(sessionStorageKey, JSON.stringify(payload)); } catch {}
    }
  }
  function clearSession() {
    sessionRef.current = '';
    if (sessionStorageKey) {
      try { sessionStorage.removeItem(sessionStorageKey); } catch {}
    }
  }

  // มาจากลิงก์ตั้งรหัส PIN ที่ส่งทาง LINE (staff_id + setpin=1) → ข้ามหน้ากรอก PIN ไปตั้งรหัสใหม่เลย
  useEffect(() => {
    if (setupMode && setupStaffId) { authResolvedRef.current = true; setStep('setpin'); }
  }, [setupMode, setupStaffId]);

  // ดึงรายชื่อพนักงานให้เลือกก่อนใส่ PIN (ใช้ตอน fallback — ไม่ได้เปิดจากในแอปไลน์)
  async function fetchPickerList() {
    if (!shopId) return;
    setPickerLoading(true);
    try {
      const r = await fetch(`/api/pos/staff-picker?shopId=${shopId}`);
      const d = await r.json();
      if (d.staff) setPickerList(d.staff);
    } catch {}
    setPickerLoading(false);
  }

  // ทางเลือกสุดท้ายถ้า LIFF ใช้ไม่ได้ (ไม่ได้เปิดจากแอปไลน์/โหลด SDK ไม่สำเร็จ/หมดเวลารอ) —
  // กลับไปให้เลือกชื่อจากรายชื่อ + ใส่ PIN แบบเดิม
  function resolveAuthFallback() {
    if (authResolvedRef.current) return;
    authResolvedRef.current = true;
    setStep('name');
    fetchPickerList();
  }

  // เผื่อเน็ตพนักงานหลุด/ช้าจนแท็ก <Script> ไม่เรียก onLoad/onError กลับมาเลยสักครั้ง (เดต็ตกต่างจาก
  // fallbackTimer ใน initLiff() ที่เริ่มนับ "หลัง" init เริ่มทำงานแล้วเท่านั้น) — กันหน้าค้างที่
  // "กำลังโหลด..." ตลอดไปถ้า CDN ไม่ตอบสนองอะไรเลยแม้แต่ error
  useEffect(() => {
    const t = setTimeout(resolveAuthFallback, 10000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // เรียกหลัง LIFF SDK โหลดจาก CDN สำเร็จ — ถ้าเปิดจากในแอปไลน์เอง รู้ไลไอดีได้อัตโนมัติทันที
  // ข้ามหน้าเลือกชื่อไปเข้าหน้าใส่ PIN ตรงเลย (ยังต้องใส่ PIN อยู่ดี แค่ไม่ต้องเลือกชื่อเอง)
  async function initLiff() {
    const fallbackTimer = setTimeout(resolveAuthFallback, 8000);
    try {
      await window.liff.init({ liffId: process.env.NEXT_PUBLIC_LIFF_ID });
      clearTimeout(fallbackTimer);
      if (authResolvedRef.current) return; // setup-mode/กู้ session ตัดสินใจไปก่อนแล้ว
      if (!window.liff.isInClient()) { resolveAuthFallback(); return; }
      const profile = await window.liff.getProfile();
      authResolvedRef.current = true;
      setLiffLineId(profile.userId);
      setStep('pin');
    } catch {
      clearTimeout(fallbackTimer);
      resolveAuthFallback();
    }
  }

  // กู้คืน session ที่ค้างไว้จาก sessionStorage ตอนโหลดหน้า (เดิมพนักงานรีเฟรชหน้าแล้วต้องใส่ PIN
  // ใหม่ทุกครั้งเพราะ staffId เก็บใน React state อย่างเดียว) — sessionStorage อยู่ได้แค่ในแท็บ/
  // เครื่องเดิมจนกว่าจะปิดแท็บ พอดีกับเครื่องคิดเงินที่ใช้เครื่องเดียวกันหลายคนหมุนเวียน (ปิดแท็บ
  // = ล้าง session อัตโนมัติ) — ไม่ auto-login ถ้ามาจากลิงก์ตั้ง PIN/deep-link งานเฉพาะ (ให้ล็อกอิน
  // สดเสมอเพื่อยืนยันตัวตนก่อนทำงานที่ผูกกับ order/collection นั้นจริง)
  useEffect(() => {
    if (!shopId || (setupMode && setupStaffId) || deepLinkOrderNo || deepLinkCollectionNo) return;
    if (!sessionStorageKey) return;
    try {
      const raw = sessionStorage.getItem(sessionStorageKey);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (!saved?.sessionToken || !saved?.staff_id) return;
      authResolvedRef.current = true;
      sessionRef.current = saved.sessionToken;
      setStaffName(saved.staffName || '');
      setStaffBranch(saved.staffBranch || '');
      setStaffId(saved.staff_id || '');
      setIsWhiteLabel(!!saved.isWhiteLabel);
      setStaffPerms(saved.staffPerms || {});
      setStep('menu');
      fetchBills();
      fetchProducts();
      fetchOrders();
      fetchCollectionTasks();
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId]);

  async function submitSetPin() {
    if (!shopId || !setupStaffId) return;
    if (!/^\d{4}$/.test(newPin)) { setNewPinError('PIN ต้องเป็นตัวเลข 4 หลัก'); return; }
    if (newPin !== newPinConfirm) { setNewPinError('รหัสยืนยันไม่ตรงกัน'); return; }
    setSetPinSaving(true);
    setNewPinError('');
    try {
      const r = await fetch('/api/pos/staff-setpin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId, staff_id: setupStaffId, pin: newPin, token: setupToken }),
      });
      const d = await r.json();
      if (d.ok) {
        showToast(`✅ ตั้งรหัส PIN สำเร็จ${d.name ? ` — ${d.name}` : ''}`);
        setNewPin(''); setNewPinConfirm('');
        // ตั้ง PIN เสร็จแล้ว → ไปหน้าใส่ PIN ต่อเลย ผูกกับ staff_id ที่รู้อยู่แล้วจากลิงก์
        // (ไม่ต้องให้เลือกชื่อใหม่ซ้ำ — เว้นแต่เปิดจากในแอปไลน์ ให้ liffLineId ทำงานแทน)
        authResolvedRef.current = true; // กัน LIFF ที่อาจโหลดช้ามาทับ step ทีหลัง
        if (!liffLineId) setSelectedPicker({ staff_id: setupStaffId, name: d.name || '' });
        setPin('');
        setStep('pin');
      } else {
        setNewPinError(d.error || 'เกิดข้อผิดพลาด');
      }
    } catch (err) {
      setNewPinError(err.message);
    }
    setSetPinSaving(false);
  }

  // ── PIN numpad ────────────────────────────────────────────────────────────
  function pressDigit(d) {
    if (pin.length < 4) setPin(p => p + d);
  }
  function backspace() { setPin(p => p.slice(0, -1)); }

  async function verifyPin() {
    // ต้องรู้ว่า "ใคร" ก่อนเสมอ (จาก LIFF หรือจากที่เลือกไว้ในหน้าเลือกชื่อ) — verify-pin.js
    // เช็ค PIN เฉพาะคนคนนั้น ไม่ได้ค้นหาข้ามพนักงานทั้งร้านอีกต่อไป
    const identifier = liffLineId ? { line_id: liffLineId } : (selectedPicker ? { staff_id: selectedPicker.staff_id } : null);
    if (pin.length !== 4 || !shopId || !identifier) return;
    setPinLoading(true);
    setPinError('');
    try {
      const r = await fetch('/api/pos/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId, pin, ...identifier }),
      });
      const d = await r.json();
      if (d.ok) {
        const perms = {
          perm_view_revenue: !!d.staff?.perm_view_revenue,
          perm_view_pl: !!d.staff?.perm_view_pl,
          perm_manage_stock: !!d.staff?.perm_manage_stock,
          perm_export_vat: !!d.staff?.perm_export_vat,
          perm_process_sales: !!d.staff?.perm_process_sales,
          perm_void_sales: !!d.staff?.perm_void_sales,
          perm_manage_customers: !!d.staff?.perm_manage_customers,
          perm_manage_expenses: !!d.staff?.perm_manage_expenses,
          perm_manage_delivery: !!d.staff?.perm_manage_delivery,
          perm_manage_receiving: !!d.staff?.perm_manage_receiving,
          perm_issue_tax_invoice: !!d.staff?.perm_issue_tax_invoice,
          perm_manage_staff: !!d.staff?.perm_manage_staff,
        };
        setStaffName(d.staff?.name || '');
        setStaffBranch(d.staff?.branch_name || '');
        setStaffId(d.staff?.staff_id || '');
        setIsWhiteLabel(!!d.isWhiteLabel);
        setStaffPerms(perms);
        saveSession({
          sessionToken: d.sessionToken || '',
          staff_id: d.staff?.staff_id || '',
          staffName: d.staff?.name || '',
          staffBranch: d.staff?.branch_name || '',
          isWhiteLabel: !!d.isWhiteLabel,
          staffPerms: perms,
        });
        fetchBills();
        fetchProducts();
        const fetchedOrders = await fetchOrders();
        const fetchedTasks = await fetchCollectionTasks();
        // มาจากลิงก์ใน LINE push (มี order_no/collection_no แนบมา) → พาไปหน้ายืนยันงานนั้นเลย
        const orderTarget = deepLinkOrderNo ? fetchedOrders.find(o => o.order_no === deepLinkOrderNo) : null;
        const taskTarget = deepLinkCollectionNo ? fetchedTasks.find(t => t.collection_no === deepLinkCollectionNo) : null;
        if (orderTarget) {
          openDeliverConfirm(orderTarget);
        } else if (taskTarget) {
          openCollectConfirm(taskTarget);
        } else {
          setStep((deepLinkOrderNo || deepLinkCollectionNo) ? (deepLinkOrderNo ? 'deliveries' : 'collections') : 'menu');
        }
      } else {
        setPinError(d.featureLocked ? (d.error || 'แพ็กเกจนี้ไม่รองรับแอปพนักงานส่งของ') : 'PIN ไม่ถูกต้อง');
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
      const r = await apiFetch(`/api/pos/pending-bills?shopId=${shopId}`);
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
      const r = await apiFetch(`/api/pos/delivery?shopId=${shopId}`);
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
      const r = await apiFetch(`/api/pos/products?shopId=${shopId}`);
      const d = await r.json();
      if (d.products) setProducts(d.products);
    } catch {}
  }

  // ── จัดการร้าน (สิทธิ์พิเศษ) ────────────────────────────────────────────
  async function openManage(view) {
    setManageView(view);
    setManageLoading(true);
    try {
      if (view === 'revenue') {
        const r = await apiFetch(`/api/pos/reports?shopId=${shopId}&type=sales`);
        const d = await r.json();
        setManageSalesReport(r.ok ? d : { error: d.error || 'เกิดข้อผิดพลาด' });
      } else if (view === 'pl') {
        const r = await apiFetch(`/api/pos/reports?shopId=${shopId}&type=pl`);
        const d = await r.json();
        setManagePlReport(r.ok ? d : { error: d.error || 'เกิดข้อผิดพลาด' });
      } else if (view === 'stock') {
        // โอนย้ายสต็อกข้ามสาขา Phase 3 — ส่ง branchStock=staffBranch เสมอ (แม้ว่างก็ส่ง เพื่อให้
        // ตรงกับ sentinel '' ของกองกลาง/ไม่ระบุสาขา) ให้ได้ตัวเลขสต็อกเฉพาะสาขาที่พนักงานคนนี้
        // ผูกอยู่ ไม่ใช่ยอดรวมทั้งร้าน — กัน edit แล้ว delta คำนวณผิดสาขา (ตัวเลขที่เห็นไม่ตรงกับที่
        // แก้จริง) เหมือนที่เคยเป็นปัญหาแฝงในฟอร์มแก้ไขสินค้าของ pos.js ก่อนแก้คู่กันในงานนี้
        const r = await apiFetch(`/api/pos/products?shopId=${shopId}&branchStock=${encodeURIComponent(staffBranch)}`);
        const d = await r.json();
        if (d.products) setManageStockList(d.products);
      }
    } catch {}
    setManageLoading(false);
  }

  async function saveManageStock(sku, stock) {
    setManageStockSaving(sku);
    try {
      const r = await apiFetch('/api/pos/products', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId, sku, stock: parseFloat(stock) || 0, branch: staffBranch }),
      });
      const d = await r.json();
      if (d.ok) {
        showToast('บันทึกสต็อกแล้ว');
        // d.stock ที่ API คืนมาเป็นยอดรวมทั้งร้าน (shopTotals.stock) ไม่ใช่ยอดของสาขานี้ —
        // ใช้ค่าที่พิมพ์เข้าไปเอง (branch-specific) แทน กันตัวเลขที่โชว์กระโดดไปเป็นยอดรวมทันที
        // หลังบันทึกสำเร็จ (สับสนกับสาขาอื่นที่มีสต็อกอยู่ด้วย)
        const savedQty = parseFloat(stock) || 0;
        setManageStockList(list => list.map(p => p.sku === sku ? { ...p, stock: savedQty } : p));
      } else { alert(d.error); }
    } catch (err) { alert(err.message); }
    setManageStockSaving('');
  }

  function exportManageVat() {
    // window.open ไม่แนบ custom header ได้ — ส่ง session ผ่าน query param แทน (ยังเซ็นชื่อ/
    // ตรวจสอบแบบเดียวกันทุกประการ ปลอมไม่ได้เหมือนกับ header)
    const sessionQs = sessionRef.current ? `&session=${encodeURIComponent(sessionRef.current)}` : '';
    window.open(`/api/pos/export?shopId=${shopId}&types=vat${sessionQs}`, '_blank');
  }

  function openDeliverConfirm(order) {
    setSelectedOrder(order);
    setDeliverPayMethod(order.payment_method || 'เก็บปลายทาง');
    setDeliverSlipUrl('');
    setDeliverQr('');
    setBorrowingSku({});
    setBorrowedQty({});
    setDeliverDiscountType('amount');
    setDeliverDiscountValue('');
    setDeliverDone(null);
    setStep('deliver-confirm');
  }

  function printDeliveryReceipt(info) {
    const w = window.open('', '_blank', 'width=400,height=600');
    if (!w) { alert('เบราว์เซอร์บล็อกหน้าต่างพิมพ์ — กรุณาอนุญาต popup สำหรับเว็บนี้'); return; }
    const esc = s => String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const itemRows = (info.order.items || []).map(i => `
      <tr><td colspan="2" style="padding-top:4px">${esc(i.name)}</td></tr>
      <tr><td style="color:#555">${i.qty} × ${Number(i.price).toLocaleString()}</td>
        <td style="text-align:right;font-weight:bold">${(i.qty * i.price).toLocaleString(undefined,{minimumFractionDigits:2})}</td></tr>
    `).join('');
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>ใบเสร็จจัดส่ง ${esc(info.order.order_no)}</title>
    <style>
      @page { size: 80mm auto; margin: 2mm; }
      * { box-sizing: border-box; }
      body { font-family: 'Sarabun','TH Sarabun New',sans-serif; width: 80mm; margin: 0; padding: 0; font-size: 12px; color: #111; }
      .center { text-align: center; } .bold { font-weight: bold; }
      .line { border-top: 1px dashed #000; margin: 6px 0; }
      table { width: 100%; border-collapse: collapse; } td { padding: 1px 0; vertical-align: top; }
      .grand { font-size: 15px; font-weight: bold; }
    </style></head>
    <body onload="window.print()">
      <div class="center bold">ใบเสร็จรับเงิน (จัดส่ง)</div>
      <div>เลขที่: ${esc(info.order.order_no)}</div>
      <div>วันที่: ${esc(new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }))}</div>
      <div class="line"></div>
      <div class="bold">ลูกค้า: ${esc(info.order.customer_name)}</div>
      ${info.order.phone ? `<div>โทร ${esc(info.order.phone)}</div>` : ''}
      <div class="line"></div>
      <table>${itemRows}</table>
      <div class="line"></div>
      <table>
        ${info.discountAmount > 0 ? `<tr><td>ส่วนลด</td><td style="text-align:right">-${info.discountAmount.toLocaleString(undefined,{minimumFractionDigits:2})}</td></tr>` : ''}
        <tr class="grand"><td>ยอดรวมสุทธิ</td><td style="text-align:right">${info.finalTotal.toLocaleString(undefined,{minimumFractionDigits:2})}</td></tr>
        <tr><td colspan="2">วิธีชำระ: ${esc(info.payMethod === 'เก็บปลายทาง' ? 'เงินสด' : info.payMethod === 'โอนแล้ว' ? 'โอน' : 'ค้างจ่าย')}</td></tr>
        ${info.payMethod === 'ค้างจ่าย' && info.remainingDebt > 0 ? `
        <tr><td>จ่ายแล้ว</td><td style="text-align:right">${(info.finalTotal - info.remainingDebt).toLocaleString(undefined,{minimumFractionDigits:2})}</td></tr>
        <tr class="bold"><td>ค้างชำระ</td><td style="text-align:right">${info.remainingDebt.toLocaleString(undefined,{minimumFractionDigits:2})}</td></tr>` : ''}
      </table>
      <div class="line"></div>
      <div class="center">${withBrandFooter('ขอบคุณที่ใช้บริการ', isWhiteLabel).split('\n').map(esc).join('<br>')}</div>
    </body></html>`;
    w.document.open(); w.document.write(html); w.document.close();
  }

  // ── งานเก็บเงิน/ของ (collections) ────────────────────────────────────────
  async function fetchCollectionTasks() {
    if (!shopId) return [];
    setCollectionTasksLoading(true);
    let filtered = [];
    try {
      const r = await apiFetch(`/api/pos/collections?shopId=${shopId}`);
      const d = await r.json();
      if (d.tasks) {
        filtered = d.tasks.filter(t => t.status === 'รอดำเนินการ');
        setCollectionTasks(filtered);
      }
    } catch {}
    setCollectionTasksLoading(false);
    return filtered;
  }

  function openCollectConfirm(task) {
    setSelectedCollection(task);
    // ค่าเริ่มต้น = เก็บได้ครบตามที่คาดไว้ (ปกติที่สุด) พนักงานแก้เป็นยอด/จำนวนจริงได้ถ้าเก็บได้บางส่วน
    setCollectedAmount(task.debt_amount > 0 ? String(task.debt_amount) : '');
    const initQty = {};
    (task.items || []).forEach(item => { initQty[item.sku] = String(item.qty); });
    setCollectedItemsQty(initQty);
    setCollectSlipUrl('');
    setCollectFailNote('');
    setStep('collect-confirm');
  }

  async function handleCollectSlipCapture(e) {
    const file = e.target.files?.[0];
    if (!file || !shopId) return;
    setCollectSlipUploading(true);
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const r = await apiFetch('/api/pos/process-slip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId, imageBase64: base64, mimeType: file.type }),
      });
      const d = await r.json();
      if (d.ok) setCollectSlipUrl(d.url || '');
      else alert('อัปโหลดสลิปไม่สำเร็จ: ' + (d.error || ''));
    } catch (err) { alert(err.message); }
    setCollectSlipUploading(false);
    if (collectSlipRef.current) collectSlipRef.current.value = '';
  }

  async function submitCollectionResult(success) {
    if (!selectedCollection || collectSubmitting) return;
    if (!success && !collectFailNote.trim()) {
      if (!confirm('ยังไม่ได้ใส่เหตุผลที่เก็บไม่ได้ ยืนยันต่อโดยไม่ใส่เหตุผลเลยไหม?')) return;
    }
    setCollectSubmitting(true);
    try {
      const collectedItems = (selectedCollection.items || [])
        .map(item => ({ sku: item.sku, name: item.name, qty: parseInt(collectedItemsQty[item.sku]) || 0 }))
        .filter(item => item.qty > 0);
      const r = await apiFetch('/api/pos/collections', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopId,
          collection_no: selectedCollection.collection_no,
          result: success ? 'success' : 'failed',
          collected_amount: success ? (parseFloat(collectedAmount) || 0) : 0,
          collected_items: success ? collectedItems : [],
          slip_url: collectSlipUrl,
          confirmed_by: staffName.trim() || undefined,
          staff_note: collectFailNote.trim(),
        }),
      });
      const d = await r.json();
      if (d.ok) {
        showToast(success ? '✅ บันทึกผลเก็บสำเร็จแล้ว' : '📝 บันทึกว่าเก็บไม่ได้แล้ว');
        setCollectionTasks(prev => prev.filter(t => t.collection_no !== selectedCollection.collection_no));
        setSelectedCollection(null);
        setStep('collections');
      } else {
        alert(d.error || 'เกิดข้อผิดพลาด');
      }
    } catch (err) { alert(err.message); }
    setCollectSubmitting(false);
  }

  async function handleDailyLogPhoto(e) {
    const file = e.target.files?.[0];
    if (!file || !shopId) return;
    setDailyLogPhotoUploading(true);
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const r = await apiFetch('/api/pos/upload-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId, imageBase64: base64, mimeType: file.type, folderLabel: 'staff_log' }),
      });
      const d = await r.json();
      if (d.ok) setDailyLogPhotoUrl(d.url || '');
      else alert('อัปโหลดรูปไม่สำเร็จ: ' + (d.error || ''));
    } catch (err) { alert(err.message); }
    setDailyLogPhotoUploading(false);
    if (dailyLogPhotoRef.current) dailyLogPhotoRef.current.value = '';
  }

  async function submitDailyLog() {
    if (dailyLogSubmitting) return;
    if (!dailyLogProblem.trim() && !dailyLogPraise.trim() && !dailyLogLowStock.trim()) {
      alert('กรุณากรอกอย่างน้อย 1 ช่อง (ปัญหา/คำชม/สต็อกใกล้หมด)');
      return;
    }
    setDailyLogSubmitting(true);
    try {
      const r = await apiFetch('/api/pos/staff-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopId, problem_text: dailyLogProblem.trim(), urgency: dailyLogUrgency,
          praise_text: dailyLogPraise.trim(), low_stock_note: dailyLogLowStock.trim(),
          photo_url: dailyLogPhotoUrl, branch: staffBranch || '',
        }),
      });
      const d = await r.json();
      if (d.ok) {
        setDailyLogResult(d.log);
        setDailyLogProblem(''); setDailyLogUrgency('normal'); setDailyLogPraise('');
        setDailyLogLowStock(''); setDailyLogPhotoUrl('');
        showToast('✅ บันทึกประจำวันสำเร็จแล้ว');
      } else {
        alert(d.error || 'เกิดข้อผิดพลาด');
      }
    } catch (err) { alert(err.message); }
    setDailyLogSubmitting(false);
  }

  async function loadDeliverQr() {
    if (!selectedOrder || !shopId) return;
    setDeliverQrLoading(true);
    try {
      const r = await apiFetch(`/api/pos/promptpay-qr?shopId=${shopId}&amount=${deliverFinalTotal}`);
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
      const r = await apiFetch('/api/pos/process-slip', {
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

  // สินค้าหมุนเวียน (เช่น ถังแก๊ส/ขวดน้ำ/ถังออกซิเจน) ในออเดอร์นี้ — ค่าเริ่มต้นถือว่าลูกค้านำของเก่ามาแลกครบทุกชิ้น
  // ต้องกดปุ่ม "ยืม" ต่อรายการเท่านั้นถ้าลูกค้าไม่ได้เอาของเก่ามาคืน (ยืมไปก่อน)
  const cyclicalItemsInOrder = (selectedOrder?.items || []).filter(item => {
    const prod = products.find(p => p.sku === item.sku);
    return prod?.type === 'หมุนเวียน';
  });

  // ส่วนลดรวมทั้งบิล — แก้ราคาต่อชิ้นไม่ได้ แต่ลดยอดรวมได้ (จำนวนเงินหรือเปอร์เซ็นต์)
  const deliverOrderTotal = selectedOrder?.total || 0;
  const deliverDiscountAmount = deliverDiscountType === 'percent'
    ? Math.round(deliverOrderTotal * (parseFloat(deliverDiscountValue) || 0) / 100 * 100) / 100
    : (parseFloat(deliverDiscountValue) || 0);
  const deliverFinalTotal = Math.max(0, Math.round((deliverOrderTotal - deliverDiscountAmount) * 100) / 100);

  function openEditDeliveryAddress() {
    setEditAddressText(selectedOrder?.address || '');
    setEditMapsLink(selectedOrder?.maps_link || '');
    setEditingDeliveryAddress(true);
  }

  async function saveDeliveryAddress() {
    if (!selectedOrder || savingDeliveryAddress) return;
    setSavingDeliveryAddress(true);
    try {
      const r = await apiFetch('/api/pos/delivery', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopId, order_no: selectedOrder.order_no,
          address: editAddressText.trim(), maps_link: editMapsLink.trim(),
        }),
      });
      const d = await r.json();
      if (d.ok) {
        const patch = { address: editAddressText.trim(), maps_link: editMapsLink.trim() };
        setSelectedOrder(o => ({ ...o, ...patch }));
        setOrders(prev => prev.map(o => o.order_no === selectedOrder.order_no ? { ...o, ...patch } : o));
        setEditingDeliveryAddress(false);
        showToast('✅ บันทึกที่อยู่/หมุดแล้ว');
      } else {
        alert(d.error || 'บันทึกไม่สำเร็จ');
      }
    } catch (err) { alert(err.message); }
    setSavingDeliveryAddress(false);
  }

  async function confirmDeliverySubmit() {
    if (!selectedOrder || deliverConfirming) return;
    if (deliverPayMethod === 'โอนแล้ว' && !deliverSlipUrl) {
      if (!confirm('ยังไม่ได้แนบสลิปโอนเงิน ยืนยันต่อโดยไม่แนบสลิปเลยไหม?')) return;
    }
    setDeliverConfirming(true);
    try {
      const items = (selectedOrder.items || []).map(item => {
        const prod = products.find(p => p.sku === item.sku);
        if (prod?.type !== 'หมุนเวียน') return item;
        const borrowed = borrowingSku[item.sku] ? Math.min(item.qty, parseInt(borrowedQty[item.sku]) || 0) : 0;
        const returnedQty = item.qty - borrowed;
        return returnedQty > 0 ? { ...item, returned_qty: returnedQty } : item;
      });
      const r = await apiFetch('/api/pos/delivery', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopId,
          order_no: selectedOrder.order_no,
          confirm_delivery: true,
          total: deliverFinalTotal,
          payment_method: deliverPayMethod,
          partial_paid_amount: deliverPayMethod === 'ค้างจ่าย' ? (parseFloat(deliverPartialPaid) || 0) : 0,
          slip_url: deliverSlipUrl,
          confirmed_by: staffName.trim() || undefined,
          items,
        }),
      });
      const d = await r.json();
      if (d.ok) {
        showToast('✅ ยืนยันจัดส่งสำเร็จแล้ว');
        setOrders(prev => prev.filter(o => o.order_no !== selectedOrder.order_no));
        // ไม่เคลียร์ selectedOrder ทันที — เก็บไว้แสดงหน้า "เสร็จสิ้น" พร้อมปุ่มพิมพ์สลิปก่อน
        setDeliverDone({ order: selectedOrder, finalTotal: deliverFinalTotal, discountAmount: deliverDiscountAmount, payMethod: deliverPayMethod, remainingDebt: d.debtAdded });
        setDeliverPartialPaid('');
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
      const r = await apiFetch('/api/pos/process-slip', {
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
      const r = await apiFetch('/api/pos/confirm-payment', {
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
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="text-gray-500 text-sm text-center">
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

      {/* โหลด LIFF SDK จาก CDN — ถ้าเปิดจากในแอปไลน์ จะรู้ไลไอดีอัตโนมัติ ข้ามหน้าเลือกชื่อไปได้เลย
          (ไม่ต้องติดตั้งเป็น npm package — ดู pages/login.js สำหรับ pattern เดียวกัน) */}
      <Script
        src="https://static.line-scdn.net/liff/edge/2/sdk.js"
        strategy="afterInteractive"
        onLoad={initLiff}
        onError={resolveAuthFallback}
      />

      <div className="min-h-screen bg-gray-50 text-gray-900 flex flex-col max-w-sm mx-auto">
        {/* Header */}
        <header className="bg-white border-b border-gray-100 px-5 py-4 flex items-center justify-between shrink-0">
          <div>
            <div className="text-gray-900 font-bold text-sm">🛒 Staff POS</div>
            {shopName && (
              <div className="text-gray-500 text-xs">
                {shopName}{staffBranch ? ` · ${staffBranch}` : ''}
              </div>
            )}
          </div>
          {step !== 'loading' && step !== 'name' && step !== 'pin' && step !== 'setpin' && (
            <button onClick={() => {
              clearSession();
              setPin('');
              setBills([]);
              setStaffPerms({});
              setManageView(''); setManageSalesReport(null); setManagePlReport(null); setManageStockList([]);
              // LIFF รู้ตัวตนแล้ว → กลับไปหน้าใส่ PIN ตรง, fallback ด้วยรายชื่อ → กลับไปเลือกชื่อใหม่
              if (liffLineId) { setStep('pin'); } else { setSelectedPicker(null); setStep('name'); }
            }}
              className="text-gray-500 hover:text-gray-900 text-xs border border-gray-200 px-3 py-1.5 rounded-lg">
              ออกจากระบบ
            </button>
          )}
        </header>

        <div className="flex-1 overflow-y-auto p-5">

          {/* ══ กำลังตรวจสอบ (เช็ค LIFF/session ค้าง) ══════════════════════════ */}
          {step === 'loading' && (
            <div className="flex flex-col items-center pt-16">
              <div className="text-4xl mb-4 animate-pulse">😊</div>
              <div className="text-gray-500 text-sm">กำลังโหลด...</div>
            </div>
          )}

          {/* ══ เลือกชื่อตัวเอง (fallback เมื่อไม่ได้เปิดจากแอปไลน์) ═══════════════ */}
          {step === 'name' && (
            <div className="flex flex-col items-center pt-8">
              <div className="text-4xl mb-4">👤</div>
              <h2 className="text-gray-900 font-bold text-xl mb-2">คุณคือใคร?</h2>
              <p className="text-gray-500 text-sm mb-6">แตะชื่อของคุณเพื่อเข้าสู่ระบบ</p>

              <div className="w-full max-w-xs space-y-2">
                {pickerLoading ? (
                  <div className="text-center text-gray-400 text-sm py-8 animate-pulse">กำลังโหลดรายชื่อ...</div>
                ) : pickerList.length === 0 ? (
                  <div className="text-center text-gray-400 text-sm py-8">
                    ยังไม่มีพนักงานที่ตั้ง PIN ไว้ — ให้เจ้าของร้าน/แอดมินส่งลิงก์ตั้ง PIN ให้ก่อน
                  </div>
                ) : (
                  pickerList.map(s => (
                    <button key={s.staff_id}
                      onClick={() => { setSelectedPicker(s); setPin(''); setPinError(''); setStep('pin'); }}
                      className="w-full flex items-center gap-3 bg-white hover:bg-white border border-gray-200 rounded-2xl px-4 py-3.5 text-left transition-colors">
                      <span className="w-10 h-10 rounded-full bg-green-50 text-green-700 flex items-center justify-center font-bold text-lg shrink-0">
                        {s.name.trim().charAt(0)}
                      </span>
                      <div className="min-w-0">
                        <div className="text-gray-900 font-medium truncate">{s.name}</div>
                        {s.branch_name && <div className="text-gray-400 text-xs truncate">{s.branch_name}</div>}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {/* ══ PIN entry ══════════════════════════════════════════════════ */}
          {step === 'pin' && (
            <div className="flex flex-col items-center pt-8">
              <div className="text-4xl mb-4">🔐</div>
              <h2 className="text-gray-900 font-bold text-xl mb-2">
                {selectedPicker ? `สวัสดีคุณ ${selectedPicker.name}` : 'ใส่ PIN พนักงาน'}
              </h2>
              <p className="text-gray-500 text-sm mb-8">กรอก PIN 4 หลักเพื่อเข้าระบบ</p>

              {/* PIN dots */}
              <div className="flex gap-4 mb-6">
                {[0,1,2,3].map(i => (
                  <div key={i} className={`w-4 h-4 rounded-full border-2 transition-colors ${
                    i < pin.length ? 'bg-green-500 border-green-500' : 'border-gray-300'
                  }`} />
                ))}
              </div>

              {pinError && (
                <div className="text-red-600 text-sm mb-4">{pinError}</div>
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
                      k === '⌫' ? 'bg-white hover:bg-gray-100 text-gray-700' :
                      'bg-white hover:bg-gray-100 active:bg-gray-200 text-gray-900'
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

              {!liffLineId && selectedPicker && (
                <button onClick={() => { setSelectedPicker(null); setPin(''); setPinError(''); setStep('name'); }}
                  className="mt-3 w-full max-w-xs text-gray-400 hover:text-gray-700 text-sm py-1 transition-colors">
                  ← ไม่ใช่ฉัน เลือกชื่อใหม่
                </button>
              )}
            </div>
          )}

          {/* ══ ตั้งรหัส PIN ครั้งแรก (มาจากลิงก์ที่ส่งทาง LINE) ═══════════════════ */}
          {step === 'setpin' && (
            <div className="flex flex-col items-center pt-8">
              <div className="text-4xl mb-4">🔐</div>
              <h2 className="text-gray-900 font-bold text-xl mb-2">ตั้งรหัส PIN ของคุณ</h2>
              <p className="text-gray-500 text-sm mb-8 text-center px-4">ตั้ง PIN 4 หลักส่วนตัว ใช้เข้าหน้าพนักงานครั้งต่อไปได้เลย</p>

              <div className="w-full max-w-xs space-y-4">
                <div>
                  <label className="text-gray-500 text-xs block mb-1.5">PIN ใหม่ (4 หลัก)</label>
                  <input type="password" inputMode="numeric" maxLength={4} value={newPin}
                    onChange={e => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    className="w-full bg-white text-gray-900 text-center text-2xl tracking-widest px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:border-green-500" />
                </div>
                <div>
                  <label className="text-gray-500 text-xs block mb-1.5">ยืนยัน PIN อีกครั้ง</label>
                  <input type="password" inputMode="numeric" maxLength={4} value={newPinConfirm}
                    onChange={e => setNewPinConfirm(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    className="w-full bg-white text-gray-900 text-center text-2xl tracking-widest px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:border-green-500" />
                </div>

                {newPinError && <div className="text-red-600 text-sm text-center">{newPinError}</div>}

                <button onClick={submitSetPin} disabled={setPinSaving || newPin.length !== 4 || newPinConfirm.length !== 4}
                  className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-bold py-4 rounded-2xl text-lg transition-colors">
                  {setPinSaving ? 'กำลังบันทึก...' : '✅ ตั้งรหัส PIN'}
                </button>
              </div>
            </div>
          )}

          {/* ══ Menu — เลือกงาน ══════════════════════════════════════════════ */}
          {step === 'menu' && (
            <div className="space-y-3">
              {staffName && (
                <div className="mb-2 text-gray-500 text-sm">
                  👋 สวัสดีคุณ <span className="text-gray-900 font-medium">{staffName}</span>
                </div>
              )}
              <button onClick={() => setStep('bills')}
                className="w-full bg-white border border-gray-100 rounded-2xl p-5 text-left hover:bg-white transition-colors flex items-center justify-between">
                <div>
                  <div className="text-gray-900 font-bold">📷 บิลรอยืนยันการโอน</div>
                  <div className="text-gray-400 text-xs mt-0.5">ยืนยันสลิปการชำระเงินหน้าร้าน</div>
                </div>
                <span className="bg-yellow-50 text-yellow-700 text-xs px-2.5 py-1 rounded-full font-bold">{bills.length}</span>
              </button>
              <button onClick={() => setStep('deliveries')}
                className="w-full bg-white border border-gray-100 rounded-2xl p-5 text-left hover:bg-white transition-colors flex items-center justify-between">
                <div>
                  <div className="text-gray-900 font-bold">🚚 งานจัดส่ง</div>
                  <div className="text-gray-400 text-xs mt-0.5">ยืนยันจัดส่งสำเร็จ + รับเงิน</div>
                </div>
                <span className="bg-orange-50 text-orange-700 text-xs px-2.5 py-1 rounded-full font-bold">{orders.length}</span>
              </button>
              <button onClick={() => setStep('collections')}
                className="w-full bg-white border border-gray-100 rounded-2xl p-5 text-left hover:bg-white transition-colors flex items-center justify-between">
                <div>
                  <div className="text-gray-900 font-bold">🧾 งานเก็บเงิน/ของ</div>
                  <div className="text-gray-400 text-xs mt-0.5">ไปเก็บเงินเชื่อค้าง หรือของที่ลูกค้ายืมค้างอยู่</div>
                </div>
                <span className="bg-orange-50 text-orange-700 text-xs px-2.5 py-1 rounded-full font-bold">{collectionTasks.length}</span>
              </button>
              <button onClick={() => { setDailyLogResult(null); setStep('dailylog'); }}
                className="w-full bg-white border border-gray-100 rounded-2xl p-5 text-left hover:bg-white transition-colors flex items-center justify-between">
                <div>
                  <div className="text-gray-900 font-bold">📝 บันทึกประจำวัน</div>
                  <div className="text-gray-400 text-xs mt-0.5">แจ้งปัญหา/คำชมจากลูกค้า/สต็อกใกล้หมด</div>
                </div>
              </button>
              {(staffPerms.perm_view_revenue || staffPerms.perm_view_pl || staffPerms.perm_manage_stock || staffPerms.perm_export_vat) && (
                <button onClick={() => { setManageView(''); setStep('manage'); }}
                  className="w-full bg-white border border-blue-200 rounded-2xl p-5 text-left hover:bg-white transition-colors flex items-center justify-between">
                  <div>
                    <div className="text-gray-900 font-bold">📊 จัดการร้าน</div>
                    <div className="text-gray-400 text-xs mt-0.5">สิทธิ์พิเศษที่แอดมินเปิดให้คุณ</div>
                  </div>
                </button>
              )}
            </div>
          )}

          {/* ══ บันทึกประจำวัน ══════════════════════════════════════════════ */}
          {step === 'dailylog' && (
            <div>
              <button onClick={() => setStep('menu')} className="text-gray-500 hover:text-gray-900 text-sm mb-4 flex items-center gap-1">← เมนู</button>

              {dailyLogResult ? (
                <div className="space-y-4">
                  <div className="bg-green-50/30 border border-green-200 rounded-2xl p-5 text-center">
                    <div className="text-3xl mb-2">✅</div>
                    <div className="text-gray-900 font-bold">บันทึกสำเร็จแล้ว</div>
                    {dailyLogResult.shift_sales_total !== null && dailyLogResult.shift_sales_total !== undefined && (
                      <div className="text-gray-500 text-xs mt-2">
                        ยอดขายกะนี้ (auto-pull): ฿{Number(dailyLogResult.shift_sales_total).toLocaleString(undefined,{minimumFractionDigits:2})} ({dailyLogResult.shift_sales_count || 0} บิล)
                      </div>
                    )}
                  </div>
                  <button onClick={() => setDailyLogResult(null)}
                    className="w-full bg-white hover:bg-gray-100 text-gray-900 font-bold py-3 rounded-xl transition-colors">
                    ＋ บันทึกเพิ่มอีก
                  </button>
                  <button onClick={() => setStep('menu')}
                    className="w-full bg-white border border-gray-100 text-gray-700 font-bold py-3 rounded-xl transition-colors">
                    กลับเมนู
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="text-gray-500 text-xs font-bold mb-1.5 block">⚠️ ปัญหาที่พบวันนี้ (ถ้ามี)</label>
                    <textarea value={dailyLogProblem} onChange={e => setDailyLogProblem(e.target.value)} rows={3}
                      placeholder="เช่น ลูกค้าต่อว่าเรื่องส่งช้า, เครื่องพิมพ์ใบเสร็จเสีย..."
                      className="w-full bg-white border border-gray-100 rounded-xl px-3 py-2.5 text-gray-900 text-sm focus:outline-none focus:border-green-500" />
                    <div className="flex gap-2 mt-2">
                      {[['normal','🟢 ปกติ'],['warning','🟡 ควรระวัง'],['urgent','🔴 ด่วน']].map(([v,l]) => (
                        <button key={v} type="button" onClick={() => setDailyLogUrgency(v)}
                          className={`flex-1 text-xs font-bold py-2 rounded-xl transition-colors ${dailyLogUrgency === v ? 'bg-green-600 text-white' : 'bg-white text-gray-500 border border-gray-200'}`}>
                          {l}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="text-gray-500 text-xs font-bold mb-1.5 block">💚 คำชมจากลูกค้า (ถ้ามี)</label>
                    <textarea value={dailyLogPraise} onChange={e => setDailyLogPraise(e.target.value)} rows={2}
                      placeholder="เช่น ลูกค้าชมว่าส่งไว บริการดี..."
                      className="w-full bg-white border border-gray-100 rounded-xl px-3 py-2.5 text-gray-900 text-sm focus:outline-none focus:border-green-500" />
                  </div>

                  <div>
                    <label className="text-gray-500 text-xs font-bold mb-1.5 block">📦 สินค้าที่เห็นว่าใกล้หมด (ถ้ามี)</label>
                    <textarea value={dailyLogLowStock} onChange={e => setDailyLogLowStock(e.target.value)} rows={2}
                      placeholder="เช่น น้ำแก๊ส 15 กก. เหลือน้อยมาก..."
                      className="w-full bg-white border border-gray-100 rounded-xl px-3 py-2.5 text-gray-900 text-sm focus:outline-none focus:border-green-500" />
                  </div>

                  <div>
                    <label className="text-gray-500 text-xs font-bold mb-1.5 block">📷 แนบรูป (ถ้ามี)</label>
                    <input ref={dailyLogPhotoRef} type="file" accept="image/*" capture="environment"
                      onChange={handleDailyLogPhoto} className="hidden" id="dailylog-photo-input" />
                    <label htmlFor="dailylog-photo-input"
                      className="w-full flex items-center justify-center gap-2 bg-white hover:bg-gray-100 border border-gray-200 rounded-xl py-3 text-gray-700 text-sm font-bold cursor-pointer transition-colors">
                      {dailyLogPhotoUploading ? '⏳ กำลังอัปโหลด...' : dailyLogPhotoUrl ? '✅ แนบรูปแล้ว (แตะเพื่อเปลี่ยน)' : '📷 ถ่าย/เลือกรูป'}
                    </label>
                  </div>

                  <button onClick={submitDailyLog} disabled={dailyLogSubmitting}
                    className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-colors">
                    {dailyLogSubmitting ? 'กำลังบันทึก...' : '💾 บันทึก'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ══ จัดการร้าน (สิทธิ์พิเศษ) ═══════════════════════════════════════ */}
          {step === 'manage' && (
            <div>
              <button onClick={() => { if (manageView) { setManageView(''); } else { setStep('menu'); } }}
                className="text-gray-500 hover:text-gray-900 text-sm mb-4 flex items-center gap-1">
                ← {manageView ? 'จัดการร้าน' : 'เมนู'}
              </button>

              {!manageView && (
                <div className="space-y-3">
                  {staffPerms.perm_view_revenue && (
                    <button onClick={() => openManage('revenue')}
                      className="w-full bg-white border border-gray-100 rounded-2xl p-5 text-left hover:bg-white transition-colors">
                      <div className="text-gray-900 font-bold">📊 ดูยอดขายรวม</div>
                    </button>
                  )}
                  {staffPerms.perm_view_pl && (
                    <button onClick={() => openManage('pl')}
                      className="w-full bg-white border border-gray-100 rounded-2xl p-5 text-left hover:bg-white transition-colors">
                      <div className="text-gray-900 font-bold">💰 ดูกำไรขาดทุน</div>
                    </button>
                  )}
                  {staffPerms.perm_manage_stock && (
                    <button onClick={() => openManage('stock')}
                      className="w-full bg-white border border-gray-100 rounded-2xl p-5 text-left hover:bg-white transition-colors">
                      <div className="text-gray-900 font-bold">📦 จัดการสต็อกสินค้า</div>
                    </button>
                  )}
                  {staffPerms.perm_export_vat && (
                    <button onClick={exportManageVat}
                      className="w-full bg-white border border-gray-100 rounded-2xl p-5 text-left hover:bg-white transition-colors">
                      <div className="text-gray-900 font-bold">🧾 Export รายงาน VAT (Excel)</div>
                    </button>
                  )}
                </div>
              )}

              {manageView === 'revenue' && (
                manageLoading ? (
                  <div className="text-center text-gray-500 py-12">กำลังโหลด...</div>
                ) : manageSalesReport?.error ? (
                  <div className="text-center text-red-600 py-12 text-sm">{manageSalesReport.error}</div>
                ) : manageSalesReport ? (
                  <div className="space-y-3">
                    <div className="bg-white rounded-2xl p-4 border border-gray-100">
                      <div className="text-gray-500 text-xs mb-1">ยอดขายรวม (ชำระแล้ว)</div>
                      <div className="text-green-600 text-2xl font-bold">฿{Number(manageSalesReport.summary?.total_income || 0).toLocaleString(undefined,{minimumFractionDigits:2})}</div>
                      <div className="text-gray-400 text-xs mt-2">จำนวนบิล: {manageSalesReport.summary?.count || 0}</div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="bg-white rounded-xl p-3 border border-gray-100">
                        <div className="text-gray-400 text-[10px]">เงินสด</div>
                        <div className="text-gray-900 text-sm font-bold">฿{Number(manageSalesReport.summary?.cash || 0).toLocaleString()}</div>
                      </div>
                      <div className="bg-white rounded-xl p-3 border border-gray-100">
                        <div className="text-gray-400 text-[10px]">โอน</div>
                        <div className="text-gray-900 text-sm font-bold">฿{Number(manageSalesReport.summary?.transfer || 0).toLocaleString()}</div>
                      </div>
                      <div className="bg-white rounded-xl p-3 border border-gray-100">
                        <div className="text-gray-400 text-[10px]">เชื่อ</div>
                        <div className="text-gray-900 text-sm font-bold">฿{Number(manageSalesReport.summary?.credit || 0).toLocaleString()}</div>
                      </div>
                    </div>
                  </div>
                ) : null
              )}

              {manageView === 'pl' && (
                manageLoading ? (
                  <div className="text-center text-gray-500 py-12">กำลังโหลด...</div>
                ) : managePlReport?.error ? (
                  <div className="text-center text-red-600 py-12 text-sm">{managePlReport.error}</div>
                ) : managePlReport ? (
                  <div className="space-y-3">
                    <div className="bg-white rounded-2xl p-4 border border-gray-100">
                      <div className="text-gray-500 text-xs mb-1">รายรับรวม</div>
                      <div className="text-green-600 text-xl font-bold">฿{Number(managePlReport.summary?.total_revenue || 0).toLocaleString(undefined,{minimumFractionDigits:2})}</div>
                    </div>
                    <div className="bg-white rounded-2xl p-4 border border-gray-100">
                      <div className="text-gray-500 text-xs mb-1">ต้นทุนสินค้าขาย</div>
                      <div className="text-red-600 text-xl font-bold">฿{Number(managePlReport.summary?.total_cost || 0).toLocaleString(undefined,{minimumFractionDigits:2})}</div>
                    </div>
                    <div className="bg-white rounded-2xl p-4 border border-gray-100">
                      <div className="text-gray-500 text-xs mb-1">ค่าใช้จ่ายร้าน</div>
                      <div className="text-red-600 text-xl font-bold">฿{Number(managePlReport.summary?.total_expenses || 0).toLocaleString(undefined,{minimumFractionDigits:2})}</div>
                    </div>
                    <div className="bg-white rounded-2xl p-4 border border-blue-200">
                      <div className="text-gray-500 text-xs mb-1">กำไรสุทธิ</div>
                      <div className="text-blue-600 text-2xl font-bold">฿{Number(managePlReport.summary?.net_profit || 0).toLocaleString(undefined,{minimumFractionDigits:2})}</div>
                    </div>
                  </div>
                ) : null
              )}

              {manageView === 'stock' && (
                manageLoading ? (
                  <div className="text-center text-gray-500 py-12">กำลังโหลด...</div>
                ) : (
                  <div className="space-y-2">
                    <div className="text-blue-600 text-xs mb-1">
                      📍 แสดง/แก้ไขสต็อกที่สาขา: {staffBranch || 'ไม่ระบุสาขา'}
                    </div>
                    {manageStockList.map(p => (
                      <div key={p.sku} className="bg-white rounded-xl p-3 border border-gray-100 flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="text-gray-900 text-sm font-medium truncate">{p.name}</div>
                          <div className="text-gray-400 text-xs">{p.sku} · {p.unit}</div>
                        </div>
                        <input type="number" defaultValue={p.stock}
                          onBlur={e => { if (e.target.value !== String(p.stock)) saveManageStock(p.sku, e.target.value); }}
                          disabled={manageStockSaving === p.sku}
                          className="w-20 bg-white text-gray-900 text-sm px-2 py-1.5 rounded-lg border border-gray-200 text-right focus:outline-none focus:border-green-500" />
                      </div>
                    ))}
                  </div>
                )
              )}
            </div>
          )}

          {/* ══ Pending bills ══════════════════════════════════════════════ */}
          {step === 'bills' && (
            <div>
              <button onClick={() => setStep('menu')} className="text-gray-500 hover:text-gray-900 text-sm mb-4 flex items-center gap-1">← เมนู</button>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-gray-900 font-bold text-lg">บิลรอยืนยัน</h2>
                <button onClick={fetchBills} disabled={billsLoading}
                  className="text-green-600 text-xs border border-green-200 px-3 py-1.5 rounded-lg hover:bg-green-50/30 transition-colors">
                  {billsLoading ? '...' : '🔄 รีเฟรช'}
                </button>
              </div>

              {billsLoading ? (
                <div className="text-center text-gray-500 py-12">กำลังโหลด...</div>
              ) : bills.length === 0 ? (
                <div className="text-center py-16">
                  <div className="text-5xl mb-4">✅</div>
                  <div className="text-gray-700 font-medium">ไม่มีบิลรอยืนยัน</div>
                  <div className="text-gray-400 text-sm mt-1">บิลโอนทั้งหมดยืนยันแล้ว</div>
                </div>
              ) : (
                <div className="space-y-3">
                  {bills.map(bill => (
                    <div key={bill.bill_no} className="bg-white rounded-2xl p-4 border border-gray-100">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <div className="text-gray-900 font-bold text-lg">฿{bill.total.toLocaleString()}</div>
                          <div className="text-gray-400 text-xs font-mono mt-0.5">{bill.bill_no}</div>
                        </div>
                        <span className="bg-yellow-50 text-yellow-700 text-xs px-2 py-1 rounded-full shrink-0">รอยืนยัน</span>
                      </div>

                      {bill.notes && (
                        <div className="text-gray-500 text-xs mb-2 truncate">📝 {bill.notes}</div>
                      )}

                      <div className="space-y-0.5 mb-3">
                        {Array.isArray(bill.items) && bill.items.map((item, j) => (
                          <div key={j} className="flex justify-between text-xs">
                            <span className="text-gray-500">{item.name} ×{item.qty}</span>
                            <span className="text-gray-700">฿{(item.price * item.qty).toLocaleString()}</span>
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
              <button onClick={() => setStep('bills')} className="text-gray-500 hover:text-gray-900 text-sm mb-5 flex items-center gap-1">
                ← กลับ
              </button>

              <div className="bg-white rounded-2xl p-4 border border-gray-100 mb-5">
                <div className="text-gray-500 text-xs mb-1">บิล {selectedBill.bill_no}</div>
                <div className="text-gray-900 font-bold text-2xl mb-3">฿{selectedBill.total.toLocaleString()}</div>
                {Array.isArray(selectedBill.items) && selectedBill.items.map((item, j) => (
                  <div key={j} className="flex justify-between text-xs text-gray-500">
                    <span>{item.name} ×{item.qty}</span>
                    <span>฿{(item.price * item.qty).toLocaleString()}</span>
                  </div>
                ))}
              </div>

              <h3 className="text-gray-900 font-bold mb-3">📷 แนบสลิปการโอน</h3>

              {slipUrl ? (
                <div className="bg-green-50/30 border border-green-200 rounded-2xl p-4 flex items-center gap-3 mb-4">
                  <div className="text-green-600 text-2xl shrink-0">✅</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-green-700 text-sm font-bold">อัปโหลดสลิปแล้ว</div>
                    {slipSender && <div className="text-green-800 text-xs mt-0.5">ผู้โอน: {slipSender}</div>}
                    {slipRefNo && <div className="text-gray-400 text-xs">อ้างอิง: {slipRefNo}</div>}
                  </div>
                  <button onClick={() => { setSlipUrl(''); setSlipSender(''); setSlipRefNo(''); }}
                    className="text-gray-400 hover:text-gray-700 shrink-0">✕</button>
                </div>
              ) : (
                <div className="mb-4">
                  <button
                    type="button"
                    onClick={() => slipRef.current?.click()}
                    disabled={slipUploading}
                    className="w-full bg-white hover:bg-gray-100 border-2 border-dashed border-gray-300 text-gray-700 font-medium py-6 rounded-2xl transition-colors flex flex-col items-center gap-2 disabled:opacity-60"
                  >
                    {slipUploading ? (
                      <><span className="text-3xl animate-spin">⏳</span><span className="text-sm">กำลังอ่านสลิป...</span></>
                    ) : (
                      <><span className="text-4xl">📷</span><span className="text-sm">ถ่ายรูป / เลือกสลิปโอน</span></>
                    )}
                  </button>
                  <input ref={slipRef} type="file" accept="image/*" capture="environment"
                    className="hidden" onChange={handleSlipCapture} />
                  <p className="text-gray-400 text-xs text-center mt-2">
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
              <button onClick={() => setStep('menu')} className="text-gray-500 hover:text-gray-900 text-sm mb-4 flex items-center gap-1">← เมนู</button>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-gray-900 font-bold text-lg">งานจัดส่ง</h2>
                <button onClick={fetchOrders} disabled={ordersLoading}
                  className="text-green-600 text-xs border border-green-200 px-3 py-1.5 rounded-lg hover:bg-green-50/30 transition-colors">
                  {ordersLoading ? '...' : '🔄 รีเฟรช'}
                </button>
              </div>

              {ordersLoading ? (
                <div className="text-center text-gray-500 py-12">กำลังโหลด...</div>
              ) : orders.length === 0 ? (
                <div className="text-center py-16">
                  <div className="text-5xl mb-4">✅</div>
                  <div className="text-gray-700 font-medium">ไม่มีงานจัดส่งค้าง</div>
                </div>
              ) : (
                <div className="space-y-3">
                  {orders.map(order => (
                    <div key={order.order_no} className="bg-white rounded-2xl p-4 border border-gray-100">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <div className="text-gray-900 font-bold">{order.customer_name}</div>
                          {order.phone && (
                            <a href={`tel:${order.phone.replace(/[^\d+]/g, '')}`} onClick={e => e.stopPropagation()}
                              className="text-blue-600 hover:text-blue-700 text-xs underline decoration-dotted underline-offset-2 inline-block">
                              📞 {order.phone}
                            </a>
                          )}
                        </div>
                        <span className="bg-orange-50 text-orange-700 text-xs px-2 py-1 rounded-full shrink-0">{order.status}</span>
                      </div>
                      {order.address && <div className="text-gray-400 text-xs mb-2 truncate">📍 {order.address}</div>}
                      <div className="space-y-0.5 mb-3">
                        {Array.isArray(order.items) && order.items.map((item, j) => (
                          <div key={j} className="flex justify-between text-xs">
                            <span className="text-gray-500">{item.name} ×{item.qty}</span>
                            <span className="text-gray-700">฿{(item.price * item.qty).toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        {order.maps_link && (
                          <a href={order.maps_link} target="_blank" rel="noreferrer"
                            className="flex-1 text-center bg-white hover:bg-gray-100 text-gray-800 text-sm font-medium py-2.5 rounded-xl transition-colors">
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
          {step === 'deliver-confirm' && selectedOrder && deliverDone && (
            <div>
              <div className="bg-green-50/20 border border-green-200 rounded-2xl p-6 text-center mb-5">
                <div className="text-4xl mb-2">✅</div>
                <div className="text-gray-900 font-bold text-lg">ยืนยันจัดส่งสำเร็จแล้ว</div>
                <div className="text-gray-500 text-sm mt-1">{deliverDone.order.customer_name}</div>
                <div className="text-green-600 font-black text-2xl mt-3">฿{deliverDone.finalTotal.toLocaleString(undefined,{minimumFractionDigits:2})}</div>
                {deliverDone.discountAmount > 0 && (
                  <div className="text-gray-400 text-xs mt-1">(ลดแล้ว ฿{deliverDone.discountAmount.toLocaleString(undefined,{minimumFractionDigits:2})})</div>
                )}
                {deliverDone.payMethod === 'ค้างจ่าย' && deliverDone.remainingDebt > 0 && (
                  <div className="text-amber-600 text-sm font-bold mt-2">📒 ค้างชำระ ฿{deliverDone.remainingDebt.toLocaleString(undefined,{minimumFractionDigits:2})}</div>
                )}
              </div>
              <button onClick={() => printDeliveryReceipt(deliverDone)}
                className="w-full bg-blue-700 hover:bg-blue-600 text-white font-bold py-3.5 rounded-2xl mb-3 transition-colors">
                🖨️ พิมพ์ใบเสร็จ
              </button>
              <button onClick={() => { setDeliverDone(null); setSelectedOrder(null); setStep('deliveries'); }}
                className="w-full bg-white hover:bg-gray-100 text-gray-800 font-bold py-3.5 rounded-2xl transition-colors">
                เสร็จสิ้น
              </button>
            </div>
          )}

          {step === 'deliver-confirm' && selectedOrder && !deliverDone && (
            <div>
              <button onClick={() => setStep('deliveries')} className="text-gray-500 hover:text-gray-900 text-sm mb-5 flex items-center gap-1">
                ← กลับ
              </button>

              <div className="bg-white rounded-2xl p-4 border border-gray-100 mb-5">
                <div className="text-gray-900 font-bold text-lg">{selectedOrder.customer_name}</div>
                {selectedOrder.phone && (
                  <a href={`tel:${selectedOrder.phone.replace(/[^\d+]/g, '')}`}
                    className="text-blue-600 hover:text-blue-700 text-xs mt-0.5 underline decoration-dotted underline-offset-2 inline-block">
                    📞 {selectedOrder.phone}
                  </a>
                )}
                {!editingDeliveryAddress ? (
                  <>
                    {selectedOrder.address && <div className="text-gray-400 text-xs mt-1">📍 {selectedOrder.address}</div>}
                    <div className="flex gap-2 mt-2">
                      {selectedOrder.maps_link && (
                        <a href={selectedOrder.maps_link} target="_blank" rel="noreferrer"
                          className="inline-block bg-white hover:bg-gray-100 text-gray-800 text-xs font-medium px-3 py-2 rounded-xl transition-colors">
                          🗺️ เปิดแผนที่
                        </a>
                      )}
                      <button type="button" onClick={openEditDeliveryAddress}
                        className="inline-block bg-white hover:bg-gray-100 text-gray-800 text-xs font-medium px-3 py-2 rounded-xl transition-colors">
                        ✏️ แก้ที่อยู่/หมุด
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="mt-2 bg-white border border-blue-300/50 rounded-xl p-3 space-y-2">
                    <div className="text-blue-600 text-xs font-bold">
                      ✏️ แก้ที่อยู่/ปักหมุดใหม่ — ลูกค้ามีหลายที่ (บ้าน/ร้าน) หรือหมุดเดิมผิดจุด แก้ได้เลย
                    </div>
                    <textarea value={editAddressText} onChange={e => setEditAddressText(e.target.value)}
                      placeholder="ที่อยู่จัดส่ง" rows={2}
                      className="w-full bg-white text-gray-900 text-sm px-3 py-2 rounded-lg border border-gray-200 focus:outline-none focus:border-blue-500 resize-none" />
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => setShowStaffMapPicker(true)}
                        className={`flex-1 text-xs font-medium py-2 rounded-lg transition-colors ${editMapsLink ? 'bg-green-50/40 text-green-700 border border-green-300/50' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                        {editMapsLink ? '✅ ปักหมุดแล้ว — แก้ไข' : '🗺️ ปักหมุดตำแหน่ง'}
                      </button>
                      {editMapsLink && (
                        <button type="button" onClick={() => setEditMapsLink('')}
                          className="text-gray-400 hover:text-red-600 text-xs px-2">ลบหมุด</button>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={saveDeliveryAddress} disabled={savingDeliveryAddress}
                        className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-bold py-2.5 rounded-lg transition-colors">
                        {savingDeliveryAddress ? 'กำลังบันทึก...' : '💾 บันทึก'}
                      </button>
                      <button type="button" onClick={() => setEditingDeliveryAddress(false)}
                        className="px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold py-2.5 rounded-lg transition-colors">
                        ยกเลิก
                      </button>
                    </div>
                  </div>
                )}
                <div className="border-t border-gray-100 mt-3 pt-3 space-y-0.5">
                  {Array.isArray(selectedOrder.items) && selectedOrder.items.map((item, j) => (
                    <div key={j} className="flex justify-between text-xs text-gray-500">
                      <span>{item.name} ×{item.qty}</span>
                      <span>฿{(item.price * item.qty).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
                <div className="flex justify-between text-xs text-gray-400 mt-2 pt-2 border-t border-gray-100">
                  <span>ยอดก่อนส่วนลด</span>
                  <span>฿{deliverOrderTotal.toLocaleString(undefined,{minimumFractionDigits:2})}</span>
                </div>
              </div>

              {/* ส่วนลดรวมทั้งบิล — แก้ราคาต่อชิ้นไม่ได้ แต่ลดยอดรวมได้ */}
              <h3 className="text-gray-900 font-bold mb-2">🏷️ ส่วนลด (ถ้ามี)</h3>
              <div className="flex gap-2 mb-2">
                {[['amount', '฿ จำนวนเงิน'], ['percent', '% เปอร์เซ็นต์']].map(([v, label]) => (
                  <button key={v} onClick={() => { setDeliverDiscountType(v); setDeliverQr(''); }}
                    className={`flex-1 py-2 rounded-xl text-xs font-bold transition-colors ${deliverDiscountType === v ? 'bg-blue-700 text-white' : 'bg-white text-gray-700 hover:bg-gray-100'}`}>
                    {label}
                  </button>
                ))}
              </div>
              <input type="number" min="0" value={deliverDiscountValue}
                onChange={e => { setDeliverDiscountValue(e.target.value); setDeliverQr(''); }}
                placeholder={deliverDiscountType === 'percent' ? '0-100' : '0.00'}
                className="w-full bg-white text-gray-900 text-sm px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:border-blue-500 mb-4" />

              <div className="bg-white rounded-2xl p-4 border border-gray-100 mb-5">
                {deliverDiscountAmount > 0 && (
                  <div className="flex justify-between text-xs text-orange-600 mb-1">
                    <span>ส่วนลด</span>
                    <span>-฿{deliverDiscountAmount.toLocaleString(undefined,{minimumFractionDigits:2})}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold">
                  <span className="text-gray-700 text-sm">ยอดที่ต้องเก็บจริง</span>
                  <span className="text-gray-900 text-lg">฿{deliverFinalTotal.toLocaleString(undefined,{minimumFractionDigits:2})}</span>
                </div>
              </div>

              {/* วิธีชำระเงินจริง */}
              <h3 className="text-gray-900 font-bold mb-2">💳 รับเงินแบบไหน</h3>
              <div className="grid grid-cols-3 gap-2 mb-4">
                {['เก็บปลายทาง', 'โอนแล้ว', 'ค้างจ่าย'].map(m => (
                  <button key={m} onClick={() => { setDeliverPayMethod(m); setDeliverQr(''); }}
                    className={`py-2.5 rounded-xl text-xs font-bold transition-colors ${deliverPayMethod === m ? 'bg-orange-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-100'}`}>
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
                      <div className="text-gray-700 text-sm font-bold mt-2">฿{deliverFinalTotal.toLocaleString(undefined,{minimumFractionDigits:2})}</div>
                    </div>
                  ) : (
                    <button onClick={loadDeliverQr} disabled={deliverQrLoading}
                      className="w-full bg-white hover:bg-gray-100 text-gray-800 text-sm font-bold py-3 rounded-xl transition-colors disabled:opacity-50">
                      {deliverQrLoading ? 'กำลังสร้าง QR...' : '📱 แสดง QR ให้ลูกค้าสแกน'}
                    </button>
                  )}

                  <h4 className="text-gray-900 font-bold mt-4 mb-2 text-sm">📷 แนบสลิปการโอน</h4>
                  {deliverSlipUrl ? (
                    <div className="bg-green-50/30 border border-green-200 rounded-2xl p-4 flex items-center gap-3">
                      <div className="text-green-600 text-2xl shrink-0">✅</div>
                      <div className="flex-1 text-green-700 text-sm font-bold">อัปโหลดสลิปแล้ว</div>
                      <button onClick={() => setDeliverSlipUrl('')} className="text-gray-400 hover:text-gray-700 shrink-0">✕</button>
                    </div>
                  ) : (
                    <div>
                      <button type="button" onClick={() => deliverSlipRef.current?.click()} disabled={deliverSlipUploading}
                        className="w-full bg-white hover:bg-gray-100 border-2 border-dashed border-gray-300 text-gray-700 font-medium py-5 rounded-2xl transition-colors flex flex-col items-center gap-2 disabled:opacity-60">
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

              {/* ค้างจ่าย — เลือกได้ว่าลูกค้าจ่ายมาบางส่วนก่อนไหม ส่วนที่เหลือถึงจะเข้ายอดค้างชำระจริง */}
              {deliverPayMethod === 'ค้างจ่าย' && (
                <div className="mb-4">
                  <h3 className="text-gray-900 font-bold mb-2 text-sm">💰 จ่ายมาก่อนบางส่วนไหม?</h3>
                  <label className="block text-gray-500 text-xs mb-1.5">จ่ายแล้วตอนนี้ (บาท) — เว้นว่างถ้าไม่ได้จ่ายเลย</label>
                  <input type="number" min="0" max={deliverFinalTotal} value={deliverPartialPaid}
                    onChange={e => setDeliverPartialPaid(e.target.value)}
                    placeholder="0"
                    className="w-full bg-white text-gray-900 text-sm px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:border-orange-500" />
                  <div className="text-amber-600 text-xs mt-1.5">
                    ค้างชำระ ฿{Math.max(0, deliverFinalTotal - (parseFloat(deliverPartialPaid) || 0)).toLocaleString(undefined,{minimumFractionDigits:2})}
                  </div>
                </div>
              )}

              {/* สินค้าหมุนเวียน — ค่าเริ่มต้นถือว่าลูกค้านำของเก่ามาแลกครบทุกชิ้น กดปุ่ม "ยืม" เฉพาะรายการที่ลูกค้าไม่ได้เอาของเก่ามาคืน */}
              {cyclicalItemsInOrder.length > 0 && (
                <div className="mb-4">
                  <h3 className="text-gray-900 font-bold mb-2 text-sm">🔄 สินค้าหมุนเวียน — ค่าเริ่มต้นคือลูกค้านำของเก่ามาแลกครบ</h3>
                  <div className="space-y-2">
                    {cyclicalItemsInOrder.map(item => {
                      const unit = item.unit || 'ชิ้น';
                      const isBorrowing = !!borrowingSku[item.sku];
                      return (
                        <div key={item.sku} className="bg-white rounded-xl p-3 border border-gray-100">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-gray-700 text-sm flex-1">{item.name} <span className="text-gray-400">×{item.qty}</span></div>
                            <button type="button"
                              onClick={() => setBorrowingSku(s => ({ ...s, [item.sku]: !s[item.sku] }))}
                              className={`text-xs px-3 py-1.5 rounded-lg shrink-0 transition-colors ${isBorrowing ? 'bg-orange-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-100'}`}>
                              {isBorrowing ? '🤝 ยืม' : 'แลกครบ'}
                            </button>
                          </div>
                          {isBorrowing && (
                            <div className="flex items-center justify-end gap-2 mt-2 text-xs text-gray-500">
                              <span>จำนวนที่ยืม (ไม่เอา{unit}เก่ามาแลก)</span>
                              <input type="number" min="0" max={item.qty}
                                value={borrowedQty[item.sku] || ''}
                                onChange={e => setBorrowedQty(q => ({ ...q, [item.sku]: e.target.value }))}
                                placeholder="0"
                                className="w-16 bg-white text-gray-900 text-sm text-center px-2 py-1.5 rounded-lg border border-orange-300/50 focus:outline-none focus:border-orange-500" />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
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

          {/* ══ รายการงานเก็บเงิน/ของ ══════════════════════════════════════════ */}
          {step === 'collections' && (
            <div>
              <button onClick={() => setStep('menu')} className="text-gray-500 hover:text-gray-900 text-sm mb-4 flex items-center gap-1">← เมนู</button>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-gray-900 font-bold text-lg">งานเก็บเงิน/ของ</h2>
                <button onClick={fetchCollectionTasks} disabled={collectionTasksLoading}
                  className="text-green-600 text-xs border border-green-200 px-3 py-1.5 rounded-lg hover:bg-green-50/30 transition-colors">
                  {collectionTasksLoading ? '...' : '🔄 รีเฟรช'}
                </button>
              </div>

              {collectionTasksLoading ? (
                <div className="text-center text-gray-500 py-12">กำลังโหลด...</div>
              ) : collectionTasks.length === 0 ? (
                <div className="text-center py-16">
                  <div className="text-5xl mb-4">✅</div>
                  <div className="text-gray-700 font-medium">ไม่มีงานเก็บเงิน/ของค้าง</div>
                </div>
              ) : (
                <div className="space-y-3">
                  {collectionTasks.map(task => (
                    <div key={task.collection_no} className="bg-white rounded-2xl p-4 border border-gray-100">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <div className="text-gray-900 font-bold">{task.customer_name}</div>
                          {task.phone && (
                            <a href={`tel:${task.phone.replace(/[^\d+]/g, '')}`} onClick={e => e.stopPropagation()}
                              className="text-blue-600 hover:text-blue-700 text-xs underline decoration-dotted underline-offset-2 inline-block">
                              📞 {task.phone}
                            </a>
                          )}
                        </div>
                        <span className="bg-orange-50 text-orange-700 text-xs px-2 py-1 rounded-full shrink-0">{task.task_type}</span>
                      </div>
                      {task.debt_amount > 0 && (
                        <div className="text-orange-600 text-sm font-bold mb-1">💳 เงินเชื่อค้าง ฿{task.debt_amount.toLocaleString()}</div>
                      )}
                      {Array.isArray(task.items) && task.items.length > 0 && (
                        <div className="space-y-0.5 mb-2">
                          {task.items.map((item, j) => (
                            <div key={j} className="text-xs text-gray-500">🔄 {item.name} ×{item.qty}</div>
                          ))}
                        </div>
                      )}
                      {task.notes && <div className="text-gray-400 text-xs mb-2 truncate">📝 {task.notes}</div>}
                      <button onClick={() => openCollectConfirm(task)}
                        className="w-full bg-orange-600 hover:bg-orange-500 text-white text-sm font-bold py-2.5 rounded-xl transition-colors">
                        🧾 บันทึกผลการเก็บ
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ══ บันทึกผลการเก็บเงิน/ของ ══════════════════════════════════════════ */}
          {step === 'collect-confirm' && selectedCollection && (
            <div>
              <button onClick={() => setStep('collections')} className="text-gray-500 hover:text-gray-900 text-sm mb-5 flex items-center gap-1">
                ← กลับ
              </button>

              <div className="bg-white rounded-2xl p-4 border border-gray-100 mb-5">
                <div className="text-gray-900 font-bold text-lg">{selectedCollection.customer_name}</div>
                {selectedCollection.phone && (
                  <a href={`tel:${selectedCollection.phone.replace(/[^\d+]/g, '')}`}
                    className="text-blue-600 hover:text-blue-700 text-xs mt-0.5 underline decoration-dotted underline-offset-2 inline-block">
                    📞 {selectedCollection.phone}
                  </a>
                )}
                {selectedCollection.notes && <div className="text-gray-400 text-xs mt-1">📝 {selectedCollection.notes}</div>}
              </div>

              {selectedCollection.debt_amount > 0 && (
                <div className="mb-4">
                  <label className="text-gray-900 font-bold mb-2 block text-sm">💳 ยอดที่เก็บได้จริง (บาท)</label>
                  <div className="text-gray-400 text-xs mb-1.5">ยอดที่ต้องเก็บ ฿{selectedCollection.debt_amount.toLocaleString()} — ค่าเริ่มต้นคือเก็บได้ครบ แก้ได้ถ้าเก็บได้บางส่วน</div>
                  <input type="number" min="0" value={collectedAmount}
                    onChange={e => setCollectedAmount(e.target.value)}
                    className="w-full bg-white text-gray-900 text-lg font-bold px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:border-green-500" />

                  <h4 className="text-gray-900 font-bold mt-4 mb-2 text-sm">📷 แนบสลิปการโอน (ถ้ารับโอน)</h4>
                  {collectSlipUrl ? (
                    <div className="bg-green-50/30 border border-green-200 rounded-2xl p-4 flex items-center gap-3">
                      <div className="text-green-600 text-2xl shrink-0">✅</div>
                      <div className="flex-1 text-green-700 text-sm font-bold">อัปโหลดสลิปแล้ว</div>
                      <button onClick={() => setCollectSlipUrl('')} className="text-gray-400 hover:text-gray-700 shrink-0">✕</button>
                    </div>
                  ) : (
                    <div>
                      <button type="button" onClick={() => collectSlipRef.current?.click()} disabled={collectSlipUploading}
                        className="w-full bg-white hover:bg-gray-100 border-2 border-dashed border-gray-300 text-gray-700 font-medium py-4 rounded-2xl transition-colors flex flex-col items-center gap-2 disabled:opacity-60">
                        {collectSlipUploading ? (
                          <><span className="text-2xl animate-spin">⏳</span><span className="text-sm">กำลังอ่านสลิป...</span></>
                        ) : (
                          <><span className="text-2xl">📷</span><span className="text-sm">ถ่ายรูป / เลือกสลิปโอน</span></>
                        )}
                      </button>
                      <input ref={collectSlipRef} type="file" accept="image/*" capture="environment"
                        className="hidden" onChange={handleCollectSlipCapture} />
                    </div>
                  )}
                </div>
              )}

              {Array.isArray(selectedCollection.items) && selectedCollection.items.length > 0 && (
                <div className="mb-4">
                  <h3 className="text-gray-900 font-bold mb-2 text-sm">🔄 สินค้าที่เก็บคืนได้จริง — ค่าเริ่มต้นคือเก็บได้ครบ</h3>
                  <div className="space-y-2">
                    {selectedCollection.items.map(item => (
                      <div key={item.sku} className="bg-white rounded-xl p-3 border border-gray-100 flex items-center justify-between gap-3">
                        <div className="text-gray-700 text-sm flex-1">{item.name} <span className="text-gray-400">(ต้องเก็บ {item.qty})</span></div>
                        <input type="number" min="0" max={item.qty}
                          value={collectedItemsQty[item.sku] ?? ''}
                          onChange={e => setCollectedItemsQty(q => ({ ...q, [item.sku]: e.target.value }))}
                          className="w-16 bg-white text-gray-900 text-sm text-center px-2 py-2 rounded-lg border border-gray-200 focus:outline-none focus:border-green-500" />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="mb-4">
                <label className="text-gray-500 text-xs block mb-1.5">หมายเหตุ (ใส่เหตุผลถ้าเก็บไม่ได้)</label>
                <input value={collectFailNote} onChange={e => setCollectFailNote(e.target.value)}
                  placeholder="เช่น ลูกค้าไม่อยู่ นัดใหม่พรุ่งนี้"
                  className="w-full bg-white text-gray-900 text-sm px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:border-green-500" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => submitCollectionResult(false)} disabled={collectSubmitting}
                  className="bg-white hover:bg-red-50/60 border border-gray-200 disabled:opacity-50 text-gray-700 hover:text-red-700 font-bold py-4 rounded-2xl transition-colors">
                  ❌ เก็บไม่ได้
                </button>
                <button onClick={() => submitCollectionResult(true)} disabled={collectSubmitting}
                  className="bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-bold py-4 rounded-2xl transition-colors">
                  {collectSubmitting ? '...' : '✅ เก็บได้'}
                </button>
              </div>
            </div>
          )}

        </div>

        {/* Toast */}
        {toast && (
          <div className="fixed bottom-6 left-4 right-4 bg-green-700 text-white text-sm font-medium px-4 py-3 rounded-2xl text-center z-50 shadow-xl max-w-sm mx-auto">
            {toast}
          </div>
        )}

        {showStaffMapPicker && (() => {
          let initCoords = null;
          if (editMapsLink) {
            const m = editMapsLink.match(/q=([+-]?\d+\.?\d*),([+-]?\d+\.?\d*)/);
            if (m) initCoords = { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
          }
          return (
            <MapPickerModal
              initCoords={initCoords}
              onConfirm={(lat, lng) => {
                setEditMapsLink(`https://www.google.com/maps?q=${lat},${lng}`);
                setShowStaffMapPicker(false);
              }}
              onClose={() => setShowStaffMapPicker(false)}
            />
          );
        })()}
      </div>
    </>
  );
}
