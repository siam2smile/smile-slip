/**
 * หน้าพนักงาน: ยืนยันการโอนเงิน (Staff PIN page)
 * เข้าด้วย PIN 4 หลัก → เห็นบิลที่ "รอยืนยัน" → ถ่ายสลิปยืนยัน
 * mobile-first, บุ๊กมาร์กได้ ไม่ต้อง login LINE
 */
import { useState, useRef, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';

export default function PosStaffPage() {
  const router = useRouter();
  const {
    shopId, order_no: deepLinkOrderNo, collection_no: deepLinkCollectionNo,
    staff_id: setupStaffId, setpin: setupMode,
  } = router.query;

  const [step, setStep] = useState('pin'); // 'pin' | 'setpin' | 'menu' | 'bills' | 'confirm' | 'deliveries' | 'deliver-confirm' | 'collections' | 'collect-confirm'
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [pinLoading, setPinLoading] = useState(false);
  const [shopName, setShopName] = useState('');
  const [staffName, setStaffName] = useState('');
  const [staffBranch, setStaffBranch] = useState(''); // สาขาที่พนักงานคนนี้ผูกอยู่ (ตั้งค่าจากตอนอนุมัติ/เพิ่มพนักงาน)
  const [staffId, setStaffId] = useState(''); // staff_id ของคนที่ login สำเร็จ (ใช้ผูกกับ PIN)

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

  // มาจากลิงก์ตั้งรหัส PIN ที่ส่งทาง LINE (staff_id + setpin=1) → ข้ามหน้ากรอก PIN ไปตั้งรหัสใหม่เลย
  useEffect(() => {
    if (setupMode && setupStaffId) setStep('setpin');
  }, [setupMode, setupStaffId]);

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
        body: JSON.stringify({ shopId, staff_id: setupStaffId, pin: newPin }),
      });
      const d = await r.json();
      if (d.ok) {
        showToast(`✅ ตั้งรหัส PIN สำเร็จ${d.name ? ` — ${d.name}` : ''}`);
        setNewPin(''); setNewPinConfirm('');
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
        setStaffName(d.staff?.name || '');
        setStaffBranch(d.staff?.branch_name || '');
        setStaffId(d.staff?.staff_id || '');
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
      </table>
      <div class="line"></div>
      <div class="center">ขอบคุณที่ใช้บริการ</div>
    </body></html>`;
    w.document.open(); w.document.write(html); w.document.close();
  }

  // ── งานเก็บเงิน/ของ (collections) ────────────────────────────────────────
  async function fetchCollectionTasks() {
    if (!shopId) return [];
    setCollectionTasksLoading(true);
    let filtered = [];
    try {
      const r = await fetch(`/api/pos/collections?shopId=${shopId}`);
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
      const r = await fetch('/api/pos/process-slip', {
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
      const r = await fetch('/api/pos/collections', {
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

  async function loadDeliverQr() {
    if (!selectedOrder || !shopId) return;
    setDeliverQrLoading(true);
    try {
      const r = await fetch(`/api/pos/promptpay-qr?shopId=${shopId}&amount=${deliverFinalTotal}`);
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
      const r = await fetch('/api/pos/delivery', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopId,
          order_no: selectedOrder.order_no,
          confirm_delivery: true,
          total: deliverFinalTotal,
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
        // ไม่เคลียร์ selectedOrder ทันที — เก็บไว้แสดงหน้า "เสร็จสิ้น" พร้อมปุ่มพิมพ์สลิปก่อน
        setDeliverDone({ order: selectedOrder, finalTotal: deliverFinalTotal, discountAmount: deliverDiscountAmount, payMethod: deliverPayMethod });
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
            {shopName && (
              <div className="text-gray-400 text-xs">
                {shopName}{staffBranch ? ` · ${staffBranch}` : ''}
              </div>
            )}
          </div>
          {step !== 'pin' && step !== 'setpin' && (
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

          {/* ══ ตั้งรหัส PIN ครั้งแรก (มาจากลิงก์ที่ส่งทาง LINE) ═══════════════════ */}
          {step === 'setpin' && (
            <div className="flex flex-col items-center pt-8">
              <div className="text-4xl mb-4">🔐</div>
              <h2 className="text-white font-bold text-xl mb-2">ตั้งรหัส PIN ของคุณ</h2>
              <p className="text-gray-400 text-sm mb-8 text-center px-4">ตั้ง PIN 4 หลักส่วนตัว ใช้เข้าหน้าพนักงานครั้งต่อไปได้เลย</p>

              <div className="w-full max-w-xs space-y-4">
                <div>
                  <label className="text-gray-400 text-xs block mb-1.5">PIN ใหม่ (4 หลัก)</label>
                  <input type="password" inputMode="numeric" maxLength={4} value={newPin}
                    onChange={e => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    className="w-full bg-gray-800 text-white text-center text-2xl tracking-widest px-4 py-3 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500" />
                </div>
                <div>
                  <label className="text-gray-400 text-xs block mb-1.5">ยืนยัน PIN อีกครั้ง</label>
                  <input type="password" inputMode="numeric" maxLength={4} value={newPinConfirm}
                    onChange={e => setNewPinConfirm(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    className="w-full bg-gray-800 text-white text-center text-2xl tracking-widest px-4 py-3 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500" />
                </div>

                {newPinError && <div className="text-red-400 text-sm text-center">{newPinError}</div>}

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
                <div className="mb-2 text-gray-400 text-sm">
                  👋 สวัสดีคุณ <span className="text-white font-medium">{staffName}</span>
                </div>
              )}
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
              <button onClick={() => setStep('collections')}
                className="w-full bg-gray-900 border border-gray-800 rounded-2xl p-5 text-left hover:bg-gray-800 transition-colors flex items-center justify-between">
                <div>
                  <div className="text-white font-bold">🧾 งานเก็บเงิน/ของ</div>
                  <div className="text-gray-500 text-xs mt-0.5">ไปเก็บเงินเชื่อค้าง หรือของที่ลูกค้ายืมค้างอยู่</div>
                </div>
                <span className="bg-orange-900 text-orange-300 text-xs px-2.5 py-1 rounded-full font-bold">{collectionTasks.length}</span>
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
          {step === 'deliver-confirm' && selectedOrder && deliverDone && (
            <div>
              <div className="bg-green-900/20 border border-green-800 rounded-2xl p-6 text-center mb-5">
                <div className="text-4xl mb-2">✅</div>
                <div className="text-white font-bold text-lg">ยืนยันจัดส่งสำเร็จแล้ว</div>
                <div className="text-gray-400 text-sm mt-1">{deliverDone.order.customer_name}</div>
                <div className="text-green-400 font-black text-2xl mt-3">฿{deliverDone.finalTotal.toLocaleString(undefined,{minimumFractionDigits:2})}</div>
                {deliverDone.discountAmount > 0 && (
                  <div className="text-gray-500 text-xs mt-1">(ลดแล้ว ฿{deliverDone.discountAmount.toLocaleString(undefined,{minimumFractionDigits:2})})</div>
                )}
              </div>
              <button onClick={() => printDeliveryReceipt(deliverDone)}
                className="w-full bg-blue-700 hover:bg-blue-600 text-white font-bold py-3.5 rounded-2xl mb-3 transition-colors">
                🖨️ พิมพ์ใบเสร็จ
              </button>
              <button onClick={() => { setDeliverDone(null); setSelectedOrder(null); setStep('deliveries'); }}
                className="w-full bg-gray-800 hover:bg-gray-700 text-gray-200 font-bold py-3.5 rounded-2xl transition-colors">
                เสร็จสิ้น
              </button>
            </div>
          )}

          {step === 'deliver-confirm' && selectedOrder && !deliverDone && (
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
                <div className="flex justify-between text-xs text-gray-500 mt-2 pt-2 border-t border-gray-800">
                  <span>ยอดก่อนส่วนลด</span>
                  <span>฿{deliverOrderTotal.toLocaleString(undefined,{minimumFractionDigits:2})}</span>
                </div>
              </div>

              {/* ส่วนลดรวมทั้งบิล — แก้ราคาต่อชิ้นไม่ได้ แต่ลดยอดรวมได้ */}
              <h3 className="text-white font-bold mb-2">🏷️ ส่วนลด (ถ้ามี)</h3>
              <div className="flex gap-2 mb-2">
                {[['amount', '฿ จำนวนเงิน'], ['percent', '% เปอร์เซ็นต์']].map(([v, label]) => (
                  <button key={v} onClick={() => { setDeliverDiscountType(v); setDeliverQr(''); }}
                    className={`flex-1 py-2 rounded-xl text-xs font-bold transition-colors ${deliverDiscountType === v ? 'bg-blue-700 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}>
                    {label}
                  </button>
                ))}
              </div>
              <input type="number" min="0" value={deliverDiscountValue}
                onChange={e => { setDeliverDiscountValue(e.target.value); setDeliverQr(''); }}
                placeholder={deliverDiscountType === 'percent' ? '0-100' : '0.00'}
                className="w-full bg-gray-800 text-white text-sm px-4 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-blue-500 mb-4" />

              <div className="bg-gray-900 rounded-2xl p-4 border border-gray-800 mb-5">
                {deliverDiscountAmount > 0 && (
                  <div className="flex justify-between text-xs text-orange-400 mb-1">
                    <span>ส่วนลด</span>
                    <span>-฿{deliverDiscountAmount.toLocaleString(undefined,{minimumFractionDigits:2})}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold">
                  <span className="text-gray-300 text-sm">ยอดที่ต้องเก็บจริง</span>
                  <span className="text-white text-lg">฿{deliverFinalTotal.toLocaleString(undefined,{minimumFractionDigits:2})}</span>
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
                      <div className="text-gray-700 text-sm font-bold mt-2">฿{deliverFinalTotal.toLocaleString(undefined,{minimumFractionDigits:2})}</div>
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

              {/* สินค้าหมุนเวียน — ค่าเริ่มต้นถือว่าลูกค้านำของเก่ามาแลกครบทุกชิ้น กดปุ่ม "ยืม" เฉพาะรายการที่ลูกค้าไม่ได้เอาของเก่ามาคืน */}
              {cyclicalItemsInOrder.length > 0 && (
                <div className="mb-4">
                  <h3 className="text-white font-bold mb-2 text-sm">🔄 สินค้าหมุนเวียน — ค่าเริ่มต้นคือลูกค้านำของเก่ามาแลกครบ</h3>
                  <div className="space-y-2">
                    {cyclicalItemsInOrder.map(item => {
                      const unit = item.unit || 'ชิ้น';
                      const isBorrowing = !!borrowingSku[item.sku];
                      return (
                        <div key={item.sku} className="bg-gray-900 rounded-xl p-3 border border-gray-800">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-gray-300 text-sm flex-1">{item.name} <span className="text-gray-600">×{item.qty}</span></div>
                            <button type="button"
                              onClick={() => setBorrowingSku(s => ({ ...s, [item.sku]: !s[item.sku] }))}
                              className={`text-xs px-3 py-1.5 rounded-lg shrink-0 transition-colors ${isBorrowing ? 'bg-orange-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
                              {isBorrowing ? '🤝 ยืม' : 'แลกครบ'}
                            </button>
                          </div>
                          {isBorrowing && (
                            <div className="flex items-center justify-end gap-2 mt-2 text-xs text-gray-400">
                              <span>จำนวนที่ยืม (ไม่เอา{unit}เก่ามาแลก)</span>
                              <input type="number" min="0" max={item.qty}
                                value={borrowedQty[item.sku] || ''}
                                onChange={e => setBorrowedQty(q => ({ ...q, [item.sku]: e.target.value }))}
                                placeholder="0"
                                className="w-16 bg-gray-800 text-white text-sm text-center px-2 py-1.5 rounded-lg border border-orange-700/50 focus:outline-none focus:border-orange-500" />
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
              <button onClick={() => setStep('menu')} className="text-gray-400 hover:text-white text-sm mb-4 flex items-center gap-1">← เมนู</button>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-white font-bold text-lg">งานเก็บเงิน/ของ</h2>
                <button onClick={fetchCollectionTasks} disabled={collectionTasksLoading}
                  className="text-green-400 text-xs border border-green-800 px-3 py-1.5 rounded-lg hover:bg-green-900/30 transition-colors">
                  {collectionTasksLoading ? '...' : '🔄 รีเฟรช'}
                </button>
              </div>

              {collectionTasksLoading ? (
                <div className="text-center text-gray-400 py-12">กำลังโหลด...</div>
              ) : collectionTasks.length === 0 ? (
                <div className="text-center py-16">
                  <div className="text-5xl mb-4">✅</div>
                  <div className="text-gray-300 font-medium">ไม่มีงานเก็บเงิน/ของค้าง</div>
                </div>
              ) : (
                <div className="space-y-3">
                  {collectionTasks.map(task => (
                    <div key={task.collection_no} className="bg-gray-900 rounded-2xl p-4 border border-gray-800">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <div className="text-white font-bold">{task.customer_name}</div>
                          {task.phone && <div className="text-gray-400 text-xs">📞 {task.phone}</div>}
                        </div>
                        <span className="bg-orange-900 text-orange-300 text-xs px-2 py-1 rounded-full shrink-0">{task.task_type}</span>
                      </div>
                      {task.debt_amount > 0 && (
                        <div className="text-orange-400 text-sm font-bold mb-1">💳 เงินเชื่อค้าง ฿{task.debt_amount.toLocaleString()}</div>
                      )}
                      {Array.isArray(task.items) && task.items.length > 0 && (
                        <div className="space-y-0.5 mb-2">
                          {task.items.map((item, j) => (
                            <div key={j} className="text-xs text-gray-400">🔄 {item.name} ×{item.qty}</div>
                          ))}
                        </div>
                      )}
                      {task.notes && <div className="text-gray-500 text-xs mb-2 truncate">📝 {task.notes}</div>}
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
              <button onClick={() => setStep('collections')} className="text-gray-400 hover:text-white text-sm mb-5 flex items-center gap-1">
                ← กลับ
              </button>

              <div className="bg-gray-900 rounded-2xl p-4 border border-gray-800 mb-5">
                <div className="text-white font-bold text-lg">{selectedCollection.customer_name}</div>
                {selectedCollection.phone && <div className="text-gray-400 text-xs mt-0.5">📞 {selectedCollection.phone}</div>}
                {selectedCollection.notes && <div className="text-gray-500 text-xs mt-1">📝 {selectedCollection.notes}</div>}
              </div>

              {selectedCollection.debt_amount > 0 && (
                <div className="mb-4">
                  <label className="text-white font-bold mb-2 block text-sm">💳 ยอดที่เก็บได้จริง (บาท)</label>
                  <div className="text-gray-500 text-xs mb-1.5">ยอดที่ต้องเก็บ ฿{selectedCollection.debt_amount.toLocaleString()} — ค่าเริ่มต้นคือเก็บได้ครบ แก้ได้ถ้าเก็บได้บางส่วน</div>
                  <input type="number" min="0" value={collectedAmount}
                    onChange={e => setCollectedAmount(e.target.value)}
                    className="w-full bg-gray-800 text-white text-lg font-bold px-4 py-3 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500" />

                  <h4 className="text-white font-bold mt-4 mb-2 text-sm">📷 แนบสลิปการโอน (ถ้ารับโอน)</h4>
                  {collectSlipUrl ? (
                    <div className="bg-green-900/30 border border-green-800 rounded-2xl p-4 flex items-center gap-3">
                      <div className="text-green-400 text-2xl shrink-0">✅</div>
                      <div className="flex-1 text-green-300 text-sm font-bold">อัปโหลดสลิปแล้ว</div>
                      <button onClick={() => setCollectSlipUrl('')} className="text-gray-500 hover:text-gray-300 shrink-0">✕</button>
                    </div>
                  ) : (
                    <div>
                      <button type="button" onClick={() => collectSlipRef.current?.click()} disabled={collectSlipUploading}
                        className="w-full bg-gray-800 hover:bg-gray-700 border-2 border-dashed border-gray-600 text-gray-300 font-medium py-4 rounded-2xl transition-colors flex flex-col items-center gap-2 disabled:opacity-60">
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
                  <h3 className="text-white font-bold mb-2 text-sm">🔄 สินค้าที่เก็บคืนได้จริง — ค่าเริ่มต้นคือเก็บได้ครบ</h3>
                  <div className="space-y-2">
                    {selectedCollection.items.map(item => (
                      <div key={item.sku} className="bg-gray-900 rounded-xl p-3 border border-gray-800 flex items-center justify-between gap-3">
                        <div className="text-gray-300 text-sm flex-1">{item.name} <span className="text-gray-600">(ต้องเก็บ {item.qty})</span></div>
                        <input type="number" min="0" max={item.qty}
                          value={collectedItemsQty[item.sku] ?? ''}
                          onChange={e => setCollectedItemsQty(q => ({ ...q, [item.sku]: e.target.value }))}
                          className="w-16 bg-gray-800 text-white text-sm text-center px-2 py-2 rounded-lg border border-gray-700 focus:outline-none focus:border-green-500" />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="mb-4">
                <label className="text-gray-400 text-xs block mb-1.5">หมายเหตุ (ใส่เหตุผลถ้าเก็บไม่ได้)</label>
                <input value={collectFailNote} onChange={e => setCollectFailNote(e.target.value)}
                  placeholder="เช่น ลูกค้าไม่อยู่ นัดใหม่พรุ่งนี้"
                  className="w-full bg-gray-800 text-white text-sm px-4 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => submitCollectionResult(false)} disabled={collectSubmitting}
                  className="bg-gray-800 hover:bg-red-900/60 border border-gray-700 disabled:opacity-50 text-gray-300 hover:text-red-300 font-bold py-4 rounded-2xl transition-colors">
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
      </div>
    </>
  );
}
