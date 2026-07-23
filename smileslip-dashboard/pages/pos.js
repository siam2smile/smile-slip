/**
 * หน้า POS ระบบขายหน้าร้าน + สต็อคสินค้า + ผู้ติดต่อ
 * ข้อมูลทั้งหมดเก็บใน Google Sheets ของร้าน (PDPA compliant)
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { MARKET_PRICE_FEATURE_LIVE } from '../lib/market-price-flag';
import { hasFeature } from '../lib/tier-features';
import { withBrandFooter } from '../lib/branding';

const UNITS = ['ชิ้น', 'อัน', 'กล่อง', 'แพ็ก', 'ขวด', 'ถัง', 'ถุง', 'กก.', 'กรัม', 'ลิตร', 'มล.', 'เมตร', 'คู่', 'ชุด', 'โหล', 'แผ่น', 'มัด', 'หัว', 'ลูก', 'ท่อน', 'แท่ง', 'ห่อ', 'เส้น', 'จาน', 'ชาม', 'แก้ว'];
const PAY_METHODS = ['เงินสด', 'โอน', 'บัตรเครดิต', 'QR Code', 'เชื่อ'];
// หมวดหมู่รายจ่ายที่พบบ่อย — กดเลือกแทนพิมพ์เอง (ยังพิมพ์/แก้เพิ่มเองได้เหมือนเดิม ไม่ใช่ dropdown บังคับ)
const EXPENSE_CATEGORIES = ['ค่าเช่าร้าน', 'ค่าน้ำ', 'ค่าไฟ', 'ค่าน้ำมัน/ขนส่ง', 'เงินเดือนพนักงาน', 'ค่าโทรศัพท์/อินเทอร์เน็ต', 'ค่าซ่อมบำรุง', 'ค่าวัสดุสิ้นเปลือง', 'ค่าการตลาด/โฆษณา'];
const CONTACT_TYPES = ['ผู้จำหน่าย', 'ลูกค้า', 'ทั้งคู่'];

// สิทธิ์เชิงลึกของพนักงาน (session ที่เซ็นชื่อผ่าน PIN) — บังคับจริงฝั่ง API ผ่าน lib/pos-auth.js
// ไม่ใช่แค่ซ่อน UI เฉยๆ — 4 ตัวแรกมีมาก่อน (ดูยอดขาย/กำไรขาดทุน/จัดการสต็อก/export VAT),
// 8 ตัวหลังเพิ่มใหม่ (2026-07-23) ครอบคลุมการขาย/จัดส่ง/ลูกค้า/รายจ่าย/รับสินค้า/ใบกำกับภาษี/
// จัดการพนักงานเอง
const STAFF_PERM_DEFS = [
  { key: 'perm_view_revenue', icon: '📊', label: 'ดูยอดขายรวม' },
  { key: 'perm_view_pl', icon: '💰', label: 'ดูกำไรขาดทุน' },
  { key: 'perm_manage_stock', icon: '📦', label: 'จัดการสต็อกสินค้า' },
  { key: 'perm_export_vat', icon: '🧾', label: 'Export รายงาน VAT' },
  { key: 'perm_process_sales', icon: '🛒', label: 'ขายหน้าร้าน' },
  { key: 'perm_void_sales', icon: '↩️', label: 'ยกเลิกบิล' },
  { key: 'perm_manage_customers', icon: '👥', label: 'จัดการลูกค้า/ผู้ติดต่อ' },
  { key: 'perm_manage_expenses', icon: '💸', label: 'จัดการรายจ่าย' },
  { key: 'perm_manage_delivery', icon: '🚚', label: 'จัดการจัดส่ง/เก็บเงิน' },
  { key: 'perm_manage_receiving', icon: '📥', label: 'บันทึกรับสินค้า' },
  { key: 'perm_issue_tax_invoice', icon: '📄', label: 'ออกใบกำกับภาษี' },
  { key: 'perm_manage_staff', icon: '🔐', label: 'จัดการพนักงาน (เพิ่ม/แก้ไข/ตั้งสิทธิ์)' },
];

// ตำแหน่งสำเร็จรูป — กดแล้วติ๊กสิทธิ์ที่แนะนำให้อัตโนมัติ ยังแก้ไขทีละอันต่อได้เหมือนเดิม
// (hybrid ตามที่ผู้ใช้เลือก: มีทั้งตำแหน่งสำเร็จรูปและติ๊กเองละเอียด)
const STAFF_PRESETS = {
  'แคชเชียร์': ['perm_process_sales', 'perm_manage_customers'],
  'ผู้จัดการสาขา': [
    'perm_process_sales', 'perm_void_sales', 'perm_manage_customers', 'perm_view_revenue',
    'perm_view_pl', 'perm_manage_stock', 'perm_manage_expenses', 'perm_manage_delivery', 'perm_manage_receiving',
  ],
  'พนักงานส่งของ': ['perm_manage_delivery'],
  'กำหนดเอง': [],
};

function emptyStaffPerms() {
  const perms = {};
  STAFF_PERM_DEFS.forEach(p => { perms[p.key] = false; });
  return perms;
}

function emptyProdForm() {
  return { name: '', category: '', price: '', stock: '', unit: 'ชิ้น', aliases: '', notes: '', type: 'นับสต็อค', product_code: '', barcode: '', description: '', vat_type: 'ไม่มี VAT', is_active: true, empty_ceiling: '', branches: [] };
}
function emptyContactForm() {
  return {
    name: '', contact_type: 'ผู้จำหน่าย', phone: '', email: '',
    address_1: '', maps_1: '', address_2: '', maps_2: '',
    company_name: '', tax_id: '', tax_address: '', tax_branch: '',
    debt: '', cylinders: '', shop_name: '', aliases: '', notes: '',
    person_type: 'บุคคลธรรมดา', contact_person_name: '', contact_person_phone: '',
    cylinder_limit: '',
  };
}

// ── พิมพ์ใบเสร็จ/ใบกำกับภาษี — สร้าง HTML สั่งพิมพ์ผ่าน window.print() ────────────
// ใช้ print dialog ของระบบปฏิบัติการเอง (ทำงานได้ทั้ง Android และ iPhone/AirPrint
// เหมือนกัน ไม่ต้องพึ่ง Web Bluetooth ซึ่งใช้ได้เฉพาะ Android/Chrome เท่านั้น)
function bahtText(amount) {
  const ones = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
  function spell(n) {
    if (!n) return '';
    const units = [[1000000, 'ล้าน'], [100000, 'แสน'], [10000, 'หมื่น'], [1000, 'พัน'], [100, 'ร้อย']];
    let s = '';
    for (const [d, label] of units) {
      const q = Math.floor(n / d);
      if (q) { s += ones[q] + label; n %= d; }
    }
    const ten = Math.floor(n / 10), one = n % 10;
    if (ten === 1) s += 'สิบ';
    else if (ten === 2) s += 'ยี่สิบ';
    else if (ten > 0) s += ones[ten] + 'สิบ';
    if (one === 1 && ten > 0) s += 'เอ็ด';
    else if (one > 0) s += ones[one];
    return s;
  }
  const v = Math.round(Number(amount || 0) * 100) / 100;
  const baht = Math.floor(v);
  const satang = Math.round((v - baht) * 100);
  return (baht ? spell(baht) : 'ศูนย์') + 'บาท' + (satang ? spell(satang) + 'สตางค์' : 'ถ้วน');
}

// แยกฐานราคาก่อน VAT / ยอด VAT จากราคาที่กรอกจริง ตาม vatType ('รวม VAT แล้ว'/'ไม่รวม VAT'/'ไม่มี VAT')
// ใช้ทั้งฝั่งรับสินค้า (unitCost ต่อหน่วย) — ต้องตรงกับ splitVat() ใน api/pos/receives.js เป๊ะ
function splitVatAmount(unitCost, vatType) {
  const VAT_RATE = 0.07;
  if (vatType === 'รวม VAT แล้ว') {
    const base = unitCost / (1 + VAT_RATE);
    return { base, vat: unitCost - base };
  }
  if (vatType === 'ไม่รวม VAT') {
    return { base: unitCost, vat: unitCost * VAT_RATE };
  }
  return { base: unitCost, vat: 0 };
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// paperSize: '58mm' | '80mm' — isTaxInvoice: true เมื่อพิมพ์ใบกำกับภาษีเต็มรูปแบบ (มีข้อมูลผู้ซื้อ + แยก VAT)
function buildReceiptHtml({ paperSize = '80mm', shopInfo, isTaxInvoice, showVat, docNo, dateStr, buyer, items, subtotal, vat, discount, total, payMethod, cashReceived, change, footer, isWhiteLabel }) {
  const widthMm = paperSize === '58mm' ? 58 : 80;
  const title = isTaxInvoice ? 'ใบกำกับภาษี / ใบเสร็จรับเงิน' : 'ใบเสร็จรับเงิน';
  const itemRows = (items || []).map(i => {
    // สินค้าหมุนเวียน (returned_qty !== undefined) แยกแสดง "แลกเปลี่ยน" vs "ยืม" ต่อรายการ
    const hasReturnInfo = i.returned_qty !== undefined;
    const returnedQty = parseInt(i.returned_qty) || 0;
    const borrowedQty = hasReturnInfo ? Math.max(0, i.qty - returnedQty) : 0;
    const cyclicalNote = hasReturnInfo
      ? `<tr><td colspan="3" style="color:#888;font-size:0.9em">${
          returnedQty > 0 ? `↔️ แลกเปลี่ยน ${returnedQty} ${i.unit || ''}` : ''
        }${returnedQty > 0 && borrowedQty > 0 ? ' + ' : ''}${
          borrowedQty > 0 ? `📦 ยืม ${borrowedQty} ${i.unit || ''} (ยังไม่คืน)` : ''
        }</td></tr>`
      : '';
    return `
    <tr>
      <td colspan="3" style="padding-top:4px">${escapeHtml(i.name)}</td>
    </tr>
    <tr>
      <td style="color:#555">${i.qty} × ${Number(i.price).toLocaleString()}</td>
      <td></td>
      <td style="text-align:right;font-weight:bold">${(i.qty * i.price).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
    </tr>${cyclicalNote}`;
  }).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${title} ${escapeHtml(docNo || '')}</title>
<style>
  @page { size: ${widthMm}mm auto; margin: 2mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Sarabun', 'TH Sarabun New', sans-serif; width: ${widthMm}mm; margin: 0; padding: 0; font-size: ${paperSize === '58mm' ? '10px' : '12px'}; color: #111; }
  .center { text-align: center; }
  .bold { font-weight: bold; }
  .line { border-top: 1px dashed #000; margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 1px 0; vertical-align: top; }
  .shop-name { font-size: ${paperSize === '58mm' ? '13px' : '15px'}; font-weight: bold; }
  .totals td { padding-top: 2px; }
  .grand { font-size: ${paperSize === '58mm' ? '13px' : '15px'}; font-weight: bold; }
  .foot { text-align: center; margin-top: 8px; font-size: ${paperSize === '58mm' ? '9px' : '10px'}; color: #444; }
</style></head>
<body onload="window.print()">
  <div class="center shop-name">${escapeHtml(shopInfo?.shop_name || '')}</div>
  ${shopInfo?.address ? `<div class="center">${escapeHtml(shopInfo.address)}</div>` : ''}
  ${shopInfo?.tax_id ? `<div class="center">เลขผู้เสียภาษี ${escapeHtml(shopInfo.tax_id)}</div>` : ''}
  ${shopInfo?.phone ? `<div class="center">โทร ${escapeHtml(shopInfo.phone)}</div>` : ''}
  <div class="line"></div>
  <div class="center bold">${title}</div>
  <div>เลขที่: ${escapeHtml(docNo || '')}</div>
  <div>วันที่: ${escapeHtml(dateStr || '')}</div>
  ${isTaxInvoice ? `
    <div class="line"></div>
    <div class="bold">ผู้ซื้อ:</div>
    <div>${escapeHtml(buyer?.name || '')}</div>
    ${buyer?.tax_id ? `<div>เลขผู้เสียภาษี: ${escapeHtml(buyer.tax_id)}</div>` : ''}
    ${buyer?.address ? `<div>${escapeHtml(buyer.address)}</div>` : ''}
    ${buyer?.branch ? `<div>สาขา: ${escapeHtml(buyer.branch)}</div>` : ''}
  ` : ''}
  <div class="line"></div>
  <table>${itemRows}</table>
  <div class="line"></div>
  <table class="totals">
    ${discount > 0 ? `<tr><td>ส่วนลด</td><td style="text-align:right">-${discount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td></tr>` : ''}
    ${(isTaxInvoice || (showVat && vat > 0)) ? `
      <tr><td>ยอดก่อน VAT</td><td style="text-align:right">${(subtotal || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td></tr>
      <tr><td>ภาษีมูลค่าเพิ่ม 7%</td><td style="text-align:right">${(vat || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td></tr>
    ` : ''}
    <tr class="grand"><td>ยอดรวมสุทธิ</td><td style="text-align:right">${total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td></tr>
    ${payMethod ? `<tr><td colspan="2">วิธีชำระ: ${escapeHtml(payMethod)}</td></tr>` : ''}
    ${cashReceived > 0 ? `<tr><td>รับเงิน</td><td style="text-align:right">${cashReceived.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td></tr>` : ''}
    ${change > 0 ? `<tr><td>เงินทอน</td><td style="text-align:right">${change.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td></tr>` : ''}
  </table>
  ${isTaxInvoice ? `<div style="margin-top:4px">(${bahtText(total)})</div>` : ''}
  <div class="line"></div>
  <div class="foot">${withBrandFooter(footer || 'ขอบคุณที่ใช้บริการ', isWhiteLabel).split('\n').map(escapeHtml).join('<br>')}</div>
</body></html>`;
}

function openPrintWindow(html) {
  const w = window.open('', '_blank', 'width=400,height=600');
  if (!w) { alert('เบราว์เซอร์บล็อกหน้าต่างพิมพ์ — กรุณาอนุญาต popup สำหรับเว็บนี้'); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

// แปลงสตริงวันที่ไทย "D/M/พ.ศ. H:mm:ss" (จาก toLocaleString('th-TH')) กลับเป็น Date ค.ศ. — ใช้กรอง วันนี้/เดือนนี้
function parseThaiOrderDate(str) {
  if (!str) return null;
  const datePart = str.split(' ')[0];
  const [d, m, yBE] = datePart.split('/').map(Number);
  if (!d || !m || !yBE) return null;
  return new Date(yBE - 543, m - 1, d);
}

// วันที่วันนี้แบบ ISO (YYYY-MM-DD) ตามเขตเวลาไทย — ใช้เป็นค่าเริ่มต้นของช่องเลือกวันที่ย้อนหลัง
function getTodayISO() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
}

// ── Map Picker Modal ─────────────────────────────────────────────────────────
// ใช้ Leaflet + OpenStreetMap (ฟรี ไม่ต้องมี API key)
// ผู้ใช้คลิกบนแผนที่เพื่อวางหมุดตรงจุดที่ต้องการ
function MapPickerModal({ initCoords, onConfirm, onClose }) {
  const mapDivRef = useRef(null);
  const leafletMapRef = useRef(null);
  const markerRef = useRef(null);
  const [pickedCoords, setPickedCoords] = useState(initCoords || null);
  const [loadState, setLoadState] = useState('loading');
  const [gpsLoading, setGpsLoading] = useState(false);

  useEffect(() => {
    // inject Leaflet CSS ครั้งเดียว
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css';
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }

    if (window.L) { initLeaflet(); return; }

    // ถ้า script กำลัง load อยู่แล้ว รอผล
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

    const center = initCoords ? [initCoords.lat, initCoords.lng] : [13.7563, 100.5018]; // default = กรุงเทพฯ
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
      <div className="bg-gray-900 rounded-2xl w-full max-w-lg border border-gray-700 shadow-2xl overflow-hidden flex flex-col" style={{ maxHeight: '92vh' }}>
        {/* header */}
        <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between shrink-0">
          <div>
            <h3 className="text-white font-bold text-sm">📍 เลือกตำแหน่งบนแผนที่</h3>
            <p className="text-gray-500 text-xs mt-0.5">แตะบนแผนที่เพื่อวางหมุด</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-xl w-8 h-8 flex items-center justify-center">✕</button>
        </div>

        {/* map */}
        <div className="relative" style={{ height: '360px', flexShrink: 0 }}>
          <div ref={mapDivRef} style={{ height: '100%', width: '100%' }} />
          {loadState === 'loading' && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-900 text-gray-400 text-sm animate-pulse">
              กำลังโหลดแผนที่...
            </div>
          )}
          {loadState === 'error' && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-900 text-red-400 text-sm text-center px-4">
              โหลดแผนที่ไม่ได้<br/>ตรวจสอบการเชื่อมต่ออินเทอร์เน็ต
            </div>
          )}
        </div>

        {/* bottom controls */}
        <div className="p-3 space-y-2 shrink-0">
          {pickedCoords ? (
            <div className="bg-gray-800 rounded-xl px-3 py-2 text-xs text-green-400 flex items-center gap-2">
              <span>✅</span>
              <span className="flex-1">วางหมุดที่ {pickedCoords.lat}, {pickedCoords.lng}</span>
            </div>
          ) : (
            <div className="bg-gray-800/50 rounded-xl px-3 py-2 text-xs text-gray-500 text-center">
              ยังไม่ได้วางหมุด — แตะบนแผนที่เพื่อเลือกตำแหน่ง
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={useCurrentGps} disabled={gpsLoading}
              className="flex-1 bg-gray-700 hover:bg-blue-800 disabled:opacity-50 text-gray-300 hover:text-white text-xs py-2.5 rounded-xl transition-colors flex items-center justify-center gap-1.5 border border-gray-600">
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

// ── QR Contact Card Modal ─────────────────────────────────────────────────────
function QrContactModal({ contact, onClose }) {
  const canvasRef = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const vcard = [
      'BEGIN:VCARD', 'VERSION:3.0',
      `FN:${contact.name || ''}`,
      contact.company_name ? `ORG:${contact.company_name}` : '',
      contact.phone ? `TEL;TYPE=CELL:${contact.phone}` : '',
      contact.email ? `EMAIL:${contact.email}` : '',
      contact.address_1 ? `ADR:;;${contact.address_1.replace(/,/g, ' ')};;;;TH` : '',
      'END:VCARD',
    ].filter(Boolean).join('\r\n');

    function render() {
      if (!canvasRef.current || !window.QRCode) return;
      window.QRCode.toCanvas(canvasRef.current, vcard, { width: 240, margin: 2 }, () => setReady(true));
    }

    if (window.QRCode) { render(); return; }
    if (document.getElementById('qrcode-js')) {
      const t = setInterval(() => { if (window.QRCode) { clearInterval(t); render(); } }, 100);
      return () => clearInterval(t);
    }
    const s = document.createElement('script');
    s.id = 'qrcode-js';
    s.src = 'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js';
    s.onload = render;
    document.head.appendChild(s);
  }, [contact]);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="bg-gray-900 rounded-2xl w-full max-w-xs">
        <div className="p-4 border-b border-gray-800 flex items-center justify-between">
          <h3 className="text-white font-bold">🪪 บัตรผู้ติดต่อ</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-xl w-8 h-8 flex items-center justify-center">✕</button>
        </div>
        <div className="p-6 text-center">
          {!ready && <div className="text-gray-500 text-sm py-8 animate-pulse">กำลังสร้าง QR...</div>}
          <canvas ref={canvasRef} className={`rounded-xl mx-auto block bg-white p-2 ${ready ? '' : 'hidden'}`} />
          <div className="mt-4">
            <p className="text-white font-semibold text-base">{contact.name}</p>
            {contact.company_name && <p className="text-gray-400 text-sm mt-0.5">{contact.company_name}</p>}
            {contact.phone && <p className="text-gray-300 text-sm mt-1">📞 {contact.phone}</p>}
            {contact.email && <p className="text-gray-400 text-xs mt-0.5">✉️ {contact.email}</p>}
          </div>
          <p className="text-gray-600 text-xs mt-4">สแกน QR เพื่อบันทึกผู้ติดต่อในโทรศัพท์</p>
        </div>
      </div>
    </div>
  );
}

export default function POSPage() {
  const router = useRouter();
  const { userId, mode, shopId: cashierShopId } = router.query;
  const cashierMode = mode === 'cashier';

  // ── โหมดแคชเชียร์ (/pos?shopId=<id>&mode=cashier) — ลิงก์แยกต่างหากสำหรับพนักงาน/แคชเชียร์
  // บังคับใส่ PIN ก่อนเสมอ ไม่มีทางเข้าถึง Dashboard/ตั้งค่าได้จากตรงนี้เลย (ต่างจากลิงก์
  // /pos?userId=... ของเจ้าของร้านที่ไม่มีการยืนยันตัวตนเพิ่มเติม เพราะผูกกับบัญชี LINE ที่
  // login เข้า Dashboard มาแล้ว) — แก้ปัญหาที่พนักงานแคชเชียร์เดิมใช้ลิงก์เดียวกับเจ้าของร้าน
  // แล้วกดเข้า Dashboard เห็นข้อมูลทั้งหมดได้ตลอด ไม่มีการแยกสิทธิ์จริงเลย
  const [cashierSession, setCashierSession] = useState(null); // { sessionToken, staff, isWhiteLabel } หลัง PIN ผ่าน
  const [cashierSessionChecked, setCashierSessionChecked] = useState(false); // เช็ค sessionStorage ครั้งแรกเสร็จหรือยัง
  const [cashierPin, setCashierPin] = useState('');
  const [cashierPinError, setCashierPinError] = useState('');
  const [cashierPinLoading, setCashierPinLoading] = useState(false);
  const cashierSessionKey = cashierMode && cashierShopId ? `pos_cashier_session_${cashierShopId}` : null;

  const [tab, setTab] = useState('sell');
  const [showMoreMenu, setShowMoreMenu] = useState(false); // แท็บมือถือ: ตัวเลือกรองที่ไม่ได้ใช้บ่อยซ่อนใน "เพิ่มเติม"
  const [loading, setLoading] = useState(true);
  const [configLoading, setConfigLoading] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [shopInfo, setShopInfo] = useState(null);

  // products & cart
  const [products, setProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [cart, setCart] = useState([]);
  // ค่าเริ่มต้น = ลูกค้านำของเก่ามาแลกครบทุกชิ้น (exchange) — ถ้ายืมไม่คืนของเก่า ต้องกดปุ่ม "ยืม" แล้วใส่จำนวนที่ยืมแยกต่างหาก
  const [borrowingSku, setBorrowingSku] = useState({}); // { sku: true } — เปิดโหมดยืมสำหรับ SKU นั้น (สินค้าหมุนเวียน)
  const [borrowedQty, setBorrowedQty] = useState({}); // { sku: จำนวนที่ยืม (ไม่คืนของเก่า) }
  const [selectedCat, setSelectedCat] = useState('ทั้งหมด');
  const [search, setSearch] = useState('');

  // checkout
  const [showCheckout, setShowCheckout] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [discount, setDiscount] = useState('');
  const [discountType, setDiscountType] = useState('amount'); // 'amount' (บาท) | 'percent' (%)
  const [customerPrices, setCustomerPrices] = useState({}); // { sku: ราคาล่าสุดที่ลูกค้าคนนี้เคยซื้อ }
  const [payMethod, setPayMethod] = useState('เงินสด');
  const [cashReceived, setCashReceived] = useState('');
  const [saleDate, setSaleDate] = useState(''); // ว่าง = วันนี้ (ปกติ) — เลือกวันอื่นได้เมื่อคีย์ข้อมูลย้อนหลัง
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [lastBill, setLastBill] = useState(null);
  const [showTaxInvoiceForm, setShowTaxInvoiceForm] = useState(false);
  const [taxInvoiceForm, setTaxInvoiceForm] = useState({ buyer_name: '', buyer_tax_id: '', buyer_address: '', buyer_branch: 'สำนักงานใหญ่', buyer_phone: '', customer_id: '' });
  const [taxInvoiceContactQ, setTaxInvoiceContactQ] = useState('');
  const [taxInvoiceIssuing, setTaxInvoiceIssuing] = useState(false);
  const [showBill, setShowBill] = useState(false);
  const [showCartDrawer, setShowCartDrawer] = useState(false);

  // slip upload (สำหรับชำระโอน)
  const [slipDriveUrl, setSlipDriveUrl] = useState('');
  const [slipOcrData, setSlipOcrData] = useState(null);
  const [slipUploading, setSlipUploading] = useState(false);
  const slipInputRef = useRef(null);

  // PromptPay QR
  const [qrImageData, setQrImageData] = useState('');
  const [qrLoading, setQrLoading] = useState(false);

  // POS settings (PromptPay + Biller ID) — Staff PIN เปลี่ยนเป็นรายบุคคลแล้ว ไม่มี PIN ร้านรวมอีกต่อไป
  const [posConfig, setPosConfig] = useState({ promptpay_id: '', scb_biller_id: '', receipt_paper_size: '80mm', vat_registered: false });
  const [posSettingsForm, setPosSettingsForm] = useState({ promptpay_id: '', scb_biller_id: '', vat_registered: false });
  const [settingsSaving, setSettingsSaving] = useState(false);

  // ── เปิดกะ/ปิดกะเงินสด (ผูกกับพนักงานรายคนผ่าน PIN ไม่ใช่สาขา/เครื่อง) ─────────
  const [activeShift, setActiveShift] = useState(null); // { shift_no, staff_id, staff_name, opening_cash, opened_at }
  const [showOpenShiftModal, setShowOpenShiftModal] = useState(false);
  const [openShiftStep, setOpenShiftStep] = useState('pin'); // 'pin' | 'amount'
  const [openShiftPin, setOpenShiftPin] = useState('');
  const [openShiftPinError, setOpenShiftPinError] = useState('');
  const [openShiftVerifying, setOpenShiftVerifying] = useState(false);
  const [openShiftStaff, setOpenShiftStaff] = useState(null); // { staff_id, name }
  const [openShiftAmount, setOpenShiftAmount] = useState('');
  const [openShiftSaving, setOpenShiftSaving] = useState(false);
  const [showCloseShiftModal, setShowCloseShiftModal] = useState(false);
  const [closeShiftPreview, setCloseShiftPreview] = useState(null); // { expected_cash, opening_cash, opened_at, staff_name }
  const [closeShiftLoading, setCloseShiftLoading] = useState(false);
  const [closeShiftCounted, setCloseShiftCounted] = useState('');
  const [closeShiftWithdrawn, setCloseShiftWithdrawn] = useState('');
  const [closeShiftNotes, setCloseShiftNotes] = useState('');
  const [closeShiftSaving, setCloseShiftSaving] = useState(false);
  const [closeShiftResult, setCloseShiftResult] = useState(null); // สรุปหลังปิดกะสำเร็จ (แสดงก่อนปิด modal)

  // ── Multi-table bill management ───────────────────────────────────────────
  // เก็บบิลที่เปิดค้างอยู่ทั้งหมด — localStorage (แคชในเครื่อง, instant) + sync ขึ้น
  // Supabase แบบ debounce (ให้สลับเครื่อง/อุปกรณ์แล้วเห็นโต๊ะที่เปิดค้างตรงกัน — ผู้ใช้ยืนยันแล้ว
  // ว่าใช้ทีละเครื่องไม่ได้แก้พร้อมกัน จึงไม่ต้องมี conflict resolution แค่ last-write-wins พอ)
  const [openBills, setOpenBills] = useState([]);
  const [activeBillId, setActiveBillIdState] = useState(null);
  const activeBillIdRef = useRef(null); // ref กันปัญหา stale closure ใน useEffect
  const openBillsSyncTimer = useRef(null);
  const [showNewBillModal, setShowNewBillModal] = useState(false);
  const [newBillName, setNewBillName] = useState('');
  const [newBillCust, setNewBillCust] = useState(null); // ลูกค้าที่เลือกสำหรับบิลใหม่
  const [newBillCustQ, setNewBillCustQ] = useState(''); // query ค้นหาลูกค้าในโมดัลเปิดบิล
  const [tableNames, setTableNames] = useState([]); // ชื่อโต๊ะที่ตั้งค่าไว้ใน settings
  const [showBillsSidebar, setShowBillsSidebar] = useState(false); // แผงขยายรายการบิลที่เปิดค้างอยู่ + ค้นหา (เมื่อมีบิลเยอะ)
  const [billsSidebarQ, setBillsSidebarQ] = useState('');
  const [tableNamesInput, setTableNamesInput] = useState(''); // สำหรับ settings form

  // บันทึกบิลที่เปิดค้าง — localStorage ทันที (ให้ UI เร็ว/ใช้ต่อได้แม้เน็ตหลุด) + sync
  // ขึ้น server แบบ debounce กันยิง Supabase ถี่เกินตอนแก้ตะกร้ารัวๆ (เช่น พิมพ์จำนวนสินค้า)
  function persistOpenBills(bills, names = tableNames) {
    if (!shopId) return;
    try { localStorage.setItem(`pos_bills_${shopId}`, JSON.stringify(bills)); } catch {}
    clearTimeout(openBillsSyncTimer.current);
    openBillsSyncTimer.current = setTimeout(() => {
      fetch('/api/pos/open-bills', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId, bills, table_names: names }),
      }).catch(() => {});
    }, 1200);
  }

  function setActiveBillId(id) {
    activeBillIdRef.current = id;
    setActiveBillIdState(id);
  }

  // product management
  const [showProdForm, setShowProdForm] = useState(false);
  const [editProd, setEditProd] = useState(null);
  const [prodForm, setProdForm] = useState(emptyProdForm());
  const [prodSaving, setProdSaving] = useState(false);

  // reports (เดิม — ยังใช้สำหรับ date-based sales list)
  const [sales, setSales] = useState([]);
  const [salesSummary, setSalesSummary] = useState({ count: 0, total: 0, cash: 0, transfer: 0 });
  const [salesLoading, setSalesLoading] = useState(false);

  // reports tab ใหม่ (comprehensive)
  const today = new Date().toISOString().slice(0, 10);
  const [reportDateFrom, setReportDateFrom] = useState(today);
  const [reportDateTo, setReportDateTo] = useState(today);
  const [reportType, setReportType] = useState('sales');
  const [reportData, setReportData] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportBranch, setReportBranch] = useState('');
  const [reportStatusFilter, setReportStatusFilter] = useState('ทั้งหมด');
  const [expandedCredit, setExpandedCredit] = useState(null);
  const [expandedCyclicalCust, setExpandedCyclicalCust] = useState(null);
  const [cyclicalHoldingsCache, setCyclicalHoldingsCache] = useState({}); // { contact_id: { sku: qty } | 'unreconciled' }
  const [expandedLoan, setExpandedLoan] = useState(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportTypes, setExportTypes] = useState(['sales', 'inventory', 'credit', 'loans', 'topsellers', 'pl', 'expenses', 'vat']);
  const [exportLoading, setExportLoading] = useState(false);

  // loans management
  const [showLoanForm, setShowLoanForm] = useState(false);
  const [loanForm, setLoanForm] = useState({ contact_id: '', contact_name: '', contact_phone: '', items: [], due_date: '', notes: '', deduct_stock: true });
  const [loanContactQ, setLoanContactQ] = useState('');
  const [loanItemQ, setLoanItemQ] = useState('');
  const [loanSaving, setLoanSaving] = useState(false);

  // credit checkout — ลูกค้าสำหรับขายเชื่อ
  const [creditCustomer, setCreditCustomer] = useState(null);
  const [creditCustomerQ, setCreditCustomerQ] = useState('');

  // receive stock — แบบใบรับสินค้า (รองรับหลายรายการ)
  const [receiveSupplier, setReceiveSupplier] = useState(''); // ชื่อพิมพ์อิสระ (fallback ถ้าไม่ผูก contact)
  const [receiveSupplierContact, setReceiveSupplierContact] = useState(null); // ผู้จำหน่ายที่ผูก contact_id จริง
  const [receiveSupplierQ, setReceiveSupplierQ] = useState('');
  const [supplierPrices, setSupplierPrices] = useState({}); // { sku: ราคาต่อหน่วยล่าสุดที่ผู้จำหน่ายรายนี้เคยขายให้ }
  const [receiveItems, setReceiveItems] = useState([]);   // [{sku,name,qty,unit,unitCost,vatType}]
  const [receiveSearch, setReceiveSearch] = useState('');
  const [receiveCat, setReceiveCat] = useState('ทั้งหมด'); // ตัวกรองหมวดหมู่ตอนเลือกสินค้าเข้าใบรับสินค้า
  const [showReceivePicker, setShowReceivePicker] = useState(false); // เปิด/ปิด รายการสินค้าให้เลือกแบบเบราส์
  const [receiveNotes, setReceiveNotes] = useState('');
  const [receivePhotoUrl, setReceivePhotoUrl] = useState(''); // รูปบิล/ใบส่งของ — ใช้เป็นหลักฐานสำหรับดัชนีราคากลาง
  const [receiveDate, setReceiveDate] = useState(''); // ว่าง = วันนี้ — แก้ย้อนหลังได้ถ้าเอกสารมาช้า
  const [receivePhotoUploading, setReceivePhotoUploading] = useState(false);
  const [receiveSaving, setReceiveSaving] = useState(false);
  const [receiveHistory, setReceiveHistory] = useState([]);
  const [receiveHistoryLoading, setReceiveHistoryLoading] = useState(false);
  const [receiveHistoryMonth, setReceiveHistoryMonth] = useState('all'); // 'all' | 'YYYY-MM' (ปี ค.ศ.)
  const [receiveHistoryPage, setReceiveHistoryPage] = useState(0);
  const [receiveView, setReceiveView] = useState('form'); // 'form' | 'history' | 'pending'
  const [pendingReceives, setPendingReceives] = useState([]); // มาจากบอท LINE #รับสินค้า รอตรวจสอบ
  const [customerOrders, setCustomerOrders] = useState([]); // มาจากหน้าเว็บสั่งซื้อสาธารณะ /order รอตรวจสอบ
  const [customerOrdersLoading, setCustomerOrdersLoading] = useState(false);
  const [showCustomerOrders, setShowCustomerOrders] = useState(false);
  const [confirmingCustomerOrder, setConfirmingCustomerOrder] = useState(null);
  const [confirmOrderStaffId, setConfirmOrderStaffId] = useState('');
  const [confirmOrderSubmitting, setConfirmOrderSubmitting] = useState(false);
  const [pendingReceivesLoading, setPendingReceivesLoading] = useState(false);
  const [linkedPendingNo, setLinkedPendingNo] = useState(null); // pending_no ที่กำลังแก้ไขอยู่ในฟอร์ม (ลบออกจากคิวหลังยืนยันสำเร็จ)

  // รายจ่าย — ค่าใช้จ่ายร้านที่ไม่เกี่ยวกับสต็อคสินค้า
  const [expenseForm, setExpenseForm] = useState({ label: '', amount: '', vatType: 'ไม่มี VAT', payment_method: 'เงินสด', notes: '', transactionDate: '' });
  const [expensePhotoUrl, setExpensePhotoUrl] = useState('');
  const [expensePhotoUploading, setExpensePhotoUploading] = useState(false);
  const [expenseSaving, setExpenseSaving] = useState(false);
  const [expenseHistory, setExpenseHistory] = useState([]);
  const [expenseHistoryLoading, setExpenseHistoryLoading] = useState(false);
  const [expenseSummary, setExpenseSummary] = useState(null);
  const [pendingExpenses, setPendingExpenses] = useState([]); // มาจากบอท LINE #รายจ่าย รอตรวจสอบ
  const [pendingExpensesLoading, setPendingExpensesLoading] = useState(false);
  const [linkedExpensePendingNo, setLinkedExpensePendingNo] = useState(null);

  // contacts (ลูกค้า / ผู้จำหน่าย)
  const [contacts, setContacts] = useState([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [showContactForm, setShowContactForm] = useState(false);
  const [editContact, setEditContact] = useState(null);
  const [contactForm, setContactForm] = useState(emptyContactForm());
  const [contactSaving, setContactSaving] = useState(false);
  const [contactFilter, setContactFilter] = useState('ทั้งหมด');
  const [contactOutstandingOnly, setContactOutstandingOnly] = useState(false); // แสดงเฉพาะที่มียอดค้างชำระ/ค้างสินค้า
  const [showTaxSection, setShowTaxSection] = useState(false);
  const [contactSearch, setContactSearch] = useState('');
  const [contactPage, setContactPage] = useState(1);
  const CONTACTS_PER_PAGE = 20;

  // debt history modal
  const [showDebtHistory, setShowDebtHistory] = useState(false);
  const [debtHistoryCont, setDebtHistoryCont] = useState(null);
  const [debtHistoryOrders, setDebtHistoryOrders] = useState([]);
  const [debtHistoryLoading, setDebtHistoryLoading] = useState(false);

  // QR contact card modal
  const [showQrModal, setShowQrModal] = useState(false);
  const [qrContact, setQrContact] = useState(null);

  // contacts CSV/VCF import
  const [showImportModal, setShowImportModal] = useState(false);
  const [importRows, setImportRows] = useState([]);
  const [importHeaders, setImportHeaders] = useState([]);
  const [importMapping, setImportMapping] = useState({ name: '', phone: '', email: '', company_name: '', notes: '' });
  const [importDefaultType, setImportDefaultType] = useState('ลูกค้า');
  const [importLoading, setImportLoading] = useState(false);
  const [importProgress, setImportProgress] = useState(null);
  const [isVcfMode, setIsVcfMode] = useState(false);
  const importFileRef = useRef(null);

  const [showMapPicker, setShowMapPicker] = useState(false);
  const [mapPickerSlot, setMapPickerSlot] = useState(1);

  // ── Branch selection ──────────────────────────────────────────────────────
  const [posBranches, setPosBranches] = useState([]);
  const [selectedBranch, setSelectedBranch] = useState(null);
  const [showBranchSelect, setShowBranchSelect] = useState(false);

  // ── Staff/Drivers (พนักงานส่งสินค้า) ────────────────────────────────────
  const [staff, setStaff] = useState([]);
  const [staffLoading, setStaffLoading] = useState(false);
  const [showStaffForm, setShowStaffForm] = useState(false);
  const [editStaff, setEditStaff] = useState(null);
  const [staffForm, setStaffForm] = useState({ name: '', phone: '', line_id: '', role: 'พนักงานส่ง', notes: '', ...emptyStaffPerms() });
  const [staffPreset, setStaffPreset] = useState('');

  // ── คำขอสมัคร #สมัครพนักงานขนส่ง / #สมัครผู้จัดการสาขา (ผ่านกลุ่ม LINE) ──────
  const [staffRequests, setStaffRequests] = useState([]);
  const [staffRequestsLoading, setStaffRequestsLoading] = useState(false);
  const [staffRequestActing, setStaffRequestActing] = useState(null); // request id กำลังดำเนินการ
  const [staffSaving, setStaffSaving] = useState(false);

  // ── Orders (ออเดอร์จัดส่ง) ─────────────────────────────────────────────
  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [orderStatusUpdating, setOrderStatusUpdating] = useState(null); // order_no being updated
  const [orderDeleting, setOrderDeleting] = useState(null); // order_no being deleted
  const [showOrderEditForm, setShowOrderEditForm] = useState(false);
  const [editingOrder, setEditingOrder] = useState(null);
  const [adminsList, setAdminsList] = useState([]); // ใช้ resolve "สร้างโดย" เป็นชื่อคน
  const [cashConfirming, setCashConfirming] = useState(null); // order_no ที่กำลังกดยืนยันรับเงิน
  const [goodsConfirming, setGoodsConfirming] = useState(null); // order_no ที่กำลังกดยืนยันรับของ
  const [orderStatusFilter, setOrderStatusFilter] = useState('all'); // 'all' | 'pending' | 'delivered'
  const [orderDateFilter, setOrderDateFilter] = useState('all'); // 'all' | 'today' | 'month'
  const [orderEditForm, setOrderEditForm] = useState({
    customer_name: '', phone: '', address: '', payment_method: '', staff_id: '', notes: '',
  });
  const [orderEditSaving, setOrderEditSaving] = useState(false);

  // ── Debt payment modal ────────────────────────────────────────────────────
  const [showDebtModal, setShowDebtModal] = useState(false);
  const [debtCust, setDebtCust] = useState(null);
  const [debtAmount, setDebtAmount] = useState('');
  const [debtSaving, setDebtSaving] = useState(false);

  // ── ส่งพนักงานไปเก็บเงินเชื่อ/สินค้ายืม (collection dispatch) ─────────────────
  const [showCollectDispatch, setShowCollectDispatch] = useState(false);
  const [collectDispatchCust, setCollectDispatchCust] = useState(null);
  const [collectDispatchForm, setCollectDispatchForm] = useState({
    task_type: 'เงินเชื่อ', debt_amount: '', itemsQty: {}, staff_id: '', staff_name: '', staff_line_id: '', notes: '',
  });
  const [collectDispatching, setCollectDispatching] = useState(false);
  const [collectionTasks, setCollectionTasks] = useState([]);
  const [collectionTasksLoading, setCollectionTasksLoading] = useState(false);
  // ค่าเริ่มต้นซ่อนงานที่เสร็จแล้ว (ข้อมูลบันทึกอยู่ในรายงานขายอยู่แล้ว ไม่ต้องค้างโชว์ในนี้ตลอดไป — 2026-07-20)
  const [collectStatusFilter, setCollectStatusFilter] = useState('pending'); // 'all' | 'pending' | 'done'
  const [collectDateFilter, setCollectDateFilter] = useState('all'); // 'all' | 'today' | 'week' | 'month'
  const [collectCashConfirming, setCollectCashConfirming] = useState(null);
  const [collectGoodsConfirming, setCollectGoodsConfirming] = useState(null);

  // ── Cyclical product modal ────────────────────────────────────────────────
  const [showCyclicalModal, setShowCyclicalModal] = useState(null); // 'receive-back' | 'refill' | null
  const [cyclicalProd, setCyclicalProd] = useState(null);
  const [cyclicalQty, setCyclicalQty] = useState('');
  const [cyclicalSaving, setCyclicalSaving] = useState(false);

  // ── Delivery modal ────────────────────────────────────────────────────────
  const [showDelivery, setShowDelivery] = useState(false);
  const [delivStep, setDelivStep] = useState(1); // 1=เลือกลูกค้า 2=รายละเอียด
  const [delivCust, setDelivCust] = useState(null); // ลูกค้าที่เลือก
  const [delivAddrIdx, setDelivAddrIdx] = useState(0); // 0=ที่อยู่_1, 1=ที่อยู่_2, 2=กรอกใหม่
  const [delivAddrCustom, setDelivAddrCustom] = useState('');
  const [delivMapsCustom, setDelivMapsCustom] = useState('');
  const [showDelivMapPicker, setShowDelivMapPicker] = useState(false);
  const [delivStaff, setDelivStaff] = useState(null);
  const [delivPayment, setDelivPayment] = useState('เก็บปลายทาง');
  const [delivNotes, setDelivNotes] = useState('');
  const [delivLoading, setDelivLoading] = useState(false);
  const [delivCustSearch, setDelivCustSearch] = useState('');

  const [toast, setToast] = useState('');

  const shopId = shopInfo?.id;

  // ── init ──────────────────────────────────────────────────────────────────
  // โหลดสาขา/สินค้า/ผู้ติดต่อ/พนักงาน/ฯลฯ หลังรู้ profile ของร้านแล้ว — ใช้ร่วมกันทั้งเส้นทาง
  // เจ้าของร้าน (ผ่าน /api/shop/data?userId=) และเส้นทางแคชเชียร์ (ผ่าน PIN + /api/pos/cashier-shop-info)
  async function loadShopBody(profile) {
    if (!profile?.id) { setLoading(false); return; }

    const brRes = await fetch(`/api/shop/branches?shopId=${profile.id}`);
    const brData = await brRes.json();
    const activeBranches = (brData.branches || []).filter(b => b.is_active !== false);
    setPosBranches(activeBranches);

    const cfgRes = await fetch(`/api/pos/setup?shopId=${profile.id}`);
    const cfg = await cfgRes.json();
    setConfigured(cfg.configured);
    if (cfg.configured) {
      await Promise.all([
        fetchProducts(profile.id),
        fetchContacts(profile.id),
        fetchStaff(profile.id),
        fetchStaffRequests(profile.id),
        fetchPosConfig(profile.id),
        fetchOrders(profile.id),
        fetchAdmins(profile.id),
      ]);

      // เลือกสาขาอัตโนมัติ (หรือให้เลือก)
      if (activeBranches.length === 1) {
        setSelectedBranch(activeBranches[0]);
      } else if (activeBranches.length > 1) {
        try {
          const saved = localStorage.getItem(`pos_branch_${profile.id}`);
          if (saved) {
            const parsed = JSON.parse(saved);
            // ตรวจว่าสาขายังมีอยู่
            if (activeBranches.find(b => b.id === parsed.id)) {
              setSelectedBranch(parsed);
            } else {
              setShowBranchSelect(true);
            }
          } else {
            setShowBranchSelect(true);
          }
        } catch {
          setShowBranchSelect(true);
        }
      }
    }
  }

  useEffect(() => {
    if (cashierMode || !userId) return; // โหมดแคชเชียร์โหลดข้อมูลหลัง PIN ผ่านแยกต่างหาก (ดูด้านล่าง)
    async function init() {
      setLoading(true);
      try {
        const shopRes = await fetch(`/api/shop/data?userId=${userId}`);
        const shopData = await shopRes.json();
        const profile = shopData.profile;
        setShopInfo(profile);
        setGoogleConnected(!!(shopData.googleConfig?.google_refresh_token));
        await loadShopBody(profile);
      } catch (err) {
        console.error('[pos/init]', err);
      }
      setLoading(false);
    }
    init();
  }, [userId, cashierMode]);

  // ── โหมดแคชเชียร์: กู้คืน session ที่เซ็นชื่อจาก sessionStorage ถ้ามี (ยังไม่หมดอายุ) ──
  // sessionStorage อยู่ได้แค่ในแท็บนี้จนกว่าจะปิด พอดีกับเครื่องคิดเงินที่หลายคนหมุนเวียนใช้
  // เครื่องเดียวกัน (ปิดแท็บ = ล้าง session อัตโนมัติ ไม่ตกค้างให้คนถัดไปสวมสิทธิ์)
  useEffect(() => {
    if (!cashierMode || !cashierShopId) return;
    (async () => {
      let saved = null;
      try { saved = JSON.parse(sessionStorage.getItem(cashierSessionKey) || 'null'); } catch {}
      if (!saved?.sessionToken) { setCashierSessionChecked(true); setLoading(false); return; }
      try {
        const r = await fetch(`/api/pos/cashier-shop-info?shopId=${cashierShopId}&session=${encodeURIComponent(saved.sessionToken)}`);
        const d = await r.json();
        if (!r.ok || !d.ok) {
          try { sessionStorage.removeItem(cashierSessionKey); } catch {}
          setCashierSessionChecked(true);
          setLoading(false);
          return;
        }
        setCashierSession(saved);
        setShopInfo(d.shop);
        setGoogleConnected(true); // มีลิงก์แคชเชียร์ได้แปลว่าร้านตั้งค่า POS + เชื่อม Google ไว้แล้วเสมอ
        await loadShopBody(d.shop);
      } catch {}
      setCashierSessionChecked(true);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cashierMode, cashierShopId]);

  async function verifyCashierPin() {
    if (!cashierPin.trim() || cashierPinLoading || !cashierShopId) return;
    setCashierPinLoading(true);
    setCashierPinError('');
    try {
      const r = await fetch('/api/pos/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId: cashierShopId, pin: cashierPin.trim(), purpose: 'pos_cashier' }),
      });
      const d = await r.json();
      if (d.ok && d.sessionToken) {
        const sessionPayload = { sessionToken: d.sessionToken, staff: d.staff, isWhiteLabel: !!d.isWhiteLabel };
        setCashierSession(sessionPayload);
        if (cashierSessionKey) { try { sessionStorage.setItem(cashierSessionKey, JSON.stringify(sessionPayload)); } catch {} }
        setLoading(true);
        try {
          const infoRes = await fetch(`/api/pos/cashier-shop-info?shopId=${cashierShopId}&session=${encodeURIComponent(d.sessionToken)}`);
          const infoData = await infoRes.json();
          if (infoData.ok) {
            setShopInfo(infoData.shop);
            setGoogleConnected(true);
            await loadShopBody(infoData.shop);
          }
        } catch (err) { console.error('[pos/cashier-shop-info]', err); }
        setLoading(false);
      } else {
        setCashierPinError(d.error || 'PIN ไม่ถูกต้อง');
        setCashierPin('');
      }
    } catch (err) {
      setCashierPinError('เกิดข้อผิดพลาด');
    }
    setCashierPinLoading(false);
  }

  function cashierLogout() {
    setCashierSession(null);
    if (cashierSessionKey) { try { sessionStorage.removeItem(cashierSessionKey); } catch {} }
    setCashierPin('');
    setShopInfo(null);
    setConfigured(false);
  }

  // แนบ session ของแคชเชียร์เป็น header `x-staff-session` ให้ทุกคำขอ /api/ ที่ยิงออกจากหน้านี้
  // โดยอัตโนมัติ (ไม่ต้องแก้ทุกจุดที่เรียก fetch() ในไฟล์นี้ทีละจุด — ไฟล์นี้ใหญ่มาก) เจ้าของร้าน
  // (ไม่ใช่โหมดแคชเชียร์) ไม่ถูกกระทบเลยเพราะ effect นี้ไม่ทำงานเลยถ้า cashierMode เป็น false
  useEffect(() => {
    if (!cashierMode || !cashierSession?.sessionToken) return;
    const originalFetch = window.fetch;
    window.fetch = (input, init = {}) => {
      const url = typeof input === 'string' ? input : (input?.url || '');
      if (url.startsWith('/api/')) {
        init = { ...init, headers: { ...(init.headers || {}), 'x-staff-session': cashierSession.sessionToken } };
      }
      return originalFetch(input, init);
    };
    return () => { window.fetch = originalFetch; };
  }, [cashierMode, cashierSession?.sessionToken]);

  // ── โหลดกะเงินสดที่เปิดค้างไว้ (ถ้ามี) จาก localStorage แล้วเช็คกับ server ว่ายังเปิดอยู่จริง ──
  // (กันเคสกะถูกปิดไปแล้วจากอุปกรณ์อื่น/ปิดกะแล้วแต่ localStorage เครื่องนี้ไม่ทันอัปเดต)
  useEffect(() => {
    if (!shopId) return;
    (async () => {
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem(`pos_shift_${shopId}`) || 'null'); } catch {}
      if (!saved?.shift_no) return;
      try {
        const r = await fetch(`/api/pos/cash-shifts?shopId=${shopId}&shift_no=${saved.shift_no}`);
        const d = await r.json();
        if (d.shift && d.shift.status === 'เปิดอยู่') {
          setActiveShift(saved);
        } else {
          localStorage.removeItem(`pos_shift_${shopId}`);
        }
      } catch {}
    })();
  }, [shopId]);

  function openShiftModalStart() {
    setOpenShiftStep('pin');
    setOpenShiftPin('');
    setOpenShiftPinError('');
    setOpenShiftStaff(null);
    setOpenShiftAmount('');
    setShowOpenShiftModal(true);
  }

  async function verifyOpenShiftPin() {
    if (!openShiftPin.trim() || openShiftVerifying) return;
    setOpenShiftVerifying(true);
    setOpenShiftPinError('');
    try {
      const r = await fetch('/api/pos/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId, pin: openShiftPin.trim(), purpose: 'cash_shift' }),
      });
      const d = await r.json();
      if (d.ok) {
        setOpenShiftStaff(d.staff);
        setOpenShiftStep('amount');
      } else {
        setOpenShiftPinError(d.error || 'PIN ไม่ถูกต้อง');
      }
    } catch (err) {
      setOpenShiftPinError(err.message);
    }
    setOpenShiftVerifying(false);
  }

  async function confirmOpenShift() {
    if (!openShiftStaff || openShiftSaving) return;
    setOpenShiftSaving(true);
    try {
      const r = await fetch('/api/pos/cash-shifts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopId, staff_id: openShiftStaff.staff_id, staff_name: openShiftStaff.name,
          branch: selectedBranch?.branch_name || '', opening_cash: openShiftAmount || 0,
        }),
      });
      const d = await r.json();
      if (d.ok) {
        const shift = { shift_no: d.shift_no, staff_id: openShiftStaff.staff_id, staff_name: d.staff_name, opening_cash: d.opening_cash, opened_at: d.opened_at };
        setActiveShift(shift);
        try { localStorage.setItem(`pos_shift_${shopId}`, JSON.stringify(shift)); } catch {}
        setShowOpenShiftModal(false);
        showToast(`✅ เปิดกะแล้ว — ${d.staff_name}`);
      } else {
        alert(d.error);
      }
    } catch (err) {
      alert(err.message);
    }
    setOpenShiftSaving(false);
  }

  async function openCloseShiftModal() {
    if (!activeShift) return;
    setShowCloseShiftModal(true);
    setCloseShiftLoading(true);
    setCloseShiftPreview(null);
    setCloseShiftCounted('');
    setCloseShiftWithdrawn('');
    setCloseShiftNotes('');
    setCloseShiftResult(null);
    try {
      const r = await fetch(`/api/pos/cash-shifts?shopId=${shopId}&shift_no=${activeShift.shift_no}`);
      const d = await r.json();
      if (d.shift) setCloseShiftPreview(d.shift);
    } catch {}
    setCloseShiftLoading(false);
  }

  const closeShiftVariance = closeShiftPreview
    ? Math.round(((parseFloat(closeShiftCounted) || 0) - closeShiftPreview.expected_cash) * 100) / 100
    : 0;

  async function confirmCloseShift() {
    if (!activeShift || closeShiftSaving) return;
    if (closeShiftCounted === '') { showToast('กรุณากรอกยอดเงินสดที่นับได้จริง'); return; }
    if (closeShiftVariance !== 0 && !closeShiftNotes.trim()) { showToast('ยอดไม่ตรง กรุณาระบุหมายเหตุก่อนปิดกะ'); return; }
    setCloseShiftSaving(true);
    try {
      const r = await fetch('/api/pos/cash-shifts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopId, shift_no: activeShift.shift_no,
          counted_cash: closeShiftCounted, notes: closeShiftNotes, withdrawn_amount: closeShiftWithdrawn || 0,
        }),
      });
      const d = await r.json();
      if (d.ok) {
        setCloseShiftResult(d);
        setActiveShift(null);
        try { localStorage.removeItem(`pos_shift_${shopId}`); } catch {}
      } else if (d.expected_cash !== undefined) {
        // ยอดคำนวณจริงตอนปิดกะเปลี่ยนไปจากตอนเปิด modal (มีรายการใหม่เข้ามาระหว่างนั้น) — รีเฟรช preview แล้วให้ใส่หมายเหตุ
        setCloseShiftPreview(prev => ({ ...prev, expected_cash: d.expected_cash }));
        showToast(d.error);
      } else {
        showToast(d.error || 'ปิดกะไม่สำเร็จ');
      }
    } catch (err) {
      alert(err.message);
    }
    setCloseShiftSaving(false);
  }

  async function fetchPosConfig(sid = shopId) {
    if (!sid) return;
    try {
      const r = await fetch(`/api/pos/pos-config?shopId=${sid}`);
      const d = await r.json();
      if (d.ok !== false) {
        setPosConfig(d);
        setPosSettingsForm({ promptpay_id: d.promptpay_id || '', scb_biller_id: d.scb_biller_id || '', receipt_paper_size: d.receipt_paper_size || '80mm', vat_registered: !!d.vat_registered });
      }
    } catch {}
  }

  async function savePosSettings() {
    if (!shopId) return;
    setSettingsSaving(true);
    try {
      const body = { shopId };
      if (posSettingsForm.promptpay_id !== undefined) body.promptpay_id = posSettingsForm.promptpay_id;
      if (posSettingsForm.scb_biller_id !== undefined) body.scb_biller_id = posSettingsForm.scb_biller_id;
      if (posSettingsForm.receipt_paper_size !== undefined) body.receipt_paper_size = posSettingsForm.receipt_paper_size;
      body.vat_registered = !!posSettingsForm.vat_registered;
      const r = await fetch('/api/pos/pos-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (d.ok) {
        await fetchPosConfig();
        showToast('บันทึกตั้งค่าแล้ว');
      } else {
        alert(d.error);
      }
    } catch (err) {
      alert(err.message);
    }
    setSettingsSaving(false);
  }

  async function fetchProducts(sid = shopId) {
    if (!sid) return;
    setProductsLoading(true);
    try {
      const r = await fetch(`/api/pos/products?shopId=${sid}&showInactive=true`);
      const d = await r.json();
      if (d.products) setProducts(d.products);
    } catch {}
    setProductsLoading(false);
  }

  async function fetchSales(sid = shopId, date = reportDate) {
    if (!sid) return;
    setSalesLoading(true);
    let url = `/api/pos/sales?shopId=${sid}`;
    if (date) url += `&date=${date}`;
    try {
      const r = await fetch(url);
      const d = await r.json();
      if (d.sales) { setSales(d.sales); setSalesSummary(d.summary); }
    } catch {}
    setSalesLoading(false);
  }

  async function fetchContacts(sid = shopId) {
    if (!sid) return;
    setContactsLoading(true);
    try {
      const r = await fetch(`/api/pos/contacts?shopId=${sid}`);
      const d = await r.json();
      if (d.contacts) setContacts(d.contacts);
    } catch {}
    setContactsLoading(false);
  }

  async function fetchStaff(sid = shopId) {
    if (!sid) return;
    setStaffLoading(true);
    try {
      const r = await fetch(`/api/pos/staff?shopId=${sid}`);
      const d = await r.json();
      if (d.staff) setStaff(d.staff);
    } catch {}
    setStaffLoading(false);
  }

  async function fetchStaffRequests(sid = shopId) {
    if (!sid) return;
    setStaffRequestsLoading(true);
    try {
      const r = await fetch(`/api/pos/staff-requests?shopId=${sid}`);
      const d = await r.json();
      if (d.requests) setStaffRequests(d.requests);
    } catch {}
    setStaffRequestsLoading(false);
  }

  async function actOnStaffRequest(requestId, action) {
    setStaffRequestActing(requestId);
    try {
      const r = await fetch('/api/pos/staff-requests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId, requestId, action }),
      });
      const d = await r.json();
      if (d.ok) {
        await fetchStaffRequests(shopId);
        if (action === 'approve') { await fetchStaff(shopId); showToast('อนุมัติแล้ว'); }
        else showToast('ปฏิเสธคำขอแล้ว');
      } else {
        alert(d.error);
      }
    } catch (err) { alert(err.message); }
    setStaffRequestActing(null);
  }

  function openMapPicker(slot) {
    setMapPickerSlot(slot);
    setShowMapPicker(true);
  }

  async function payDebt() {
    if (!debtCust || !debtAmount || debtSaving) return;
    setDebtSaving(true);
    try {
      const newDebt = Math.max(0, (debtCust.debt || 0) - parseFloat(debtAmount));
      await fetch('/api/pos/contacts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId, contact_id: debtCust.contact_id, debt: newDebt }),
      });
      showToast(`รับเงิน ฿${parseFloat(debtAmount).toLocaleString()} จาก ${debtCust.name} แล้ว`);
      setShowDebtModal(false);
      setDebtAmount('');
      setDebtCust(null);
      fetchContacts(shopId);
    } catch (err) { alert(err.message); }
    setDebtSaving(false);
  }

  async function saveStaffMember() {
    if (!shopId || !staffForm.name) return;
    setStaffSaving(true);
    try {
      const body = { shopId, ...staffForm };
      const method = editStaff ? 'PATCH' : 'POST';
      if (editStaff) body.staff_id = editStaff.staff_id;
      const r = await fetch('/api/pos/staff', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (d.ok !== false) {
        setShowStaffForm(false);
        setEditStaff(null);
        setStaffForm({ name: '', phone: '', line_id: '', role: 'พนักงานส่ง', notes: '', ...emptyStaffPerms() });
        setStaffPreset('');
        await fetchStaff();
        showToast(editStaff ? 'แก้ไขพนักงานแล้ว' : 'เพิ่มพนักงานแล้ว');
      } else { alert(d.error); }
    } catch (err) { alert(err.message); }
    setStaffSaving(false);
  }

  async function deleteStaffMember(s) {
    if (!confirm(`ลบพนักงาน "${s.name}" ออก?`)) return;
    await fetch('/api/pos/staff', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shopId, staff_id: s.staff_id }),
    });
    await fetchStaff();
    showToast('ลบแล้ว');
  }

  // ส่งลิงก์ตั้ง/เปลี่ยนรหัส PIN ให้พนักงานทาง LINE อีกครั้ง (ไม่ล้าง PIN เดิม — ยังใช้ได้จนกว่าจะตั้งใหม่)
  async function resendStaffPinLink(s) {
    try {
      const r = await fetch('/api/pos/staff', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId, staff_id: s.staff_id, resend_pin_link: true }),
      });
      const d = await r.json();
      if (d.ok) showToast(`ส่งลิงก์ตั้ง PIN ให้ ${s.name} แล้ว`);
      else alert(d.error);
    } catch (err) { alert(err.message); }
  }

  // ปิดใช้งาน PIN เดิมทันที — ใช้ตอนพนักงานออกจากงาน กันแอบเข้าระบบด้วย PIN เก่า (ไม่ส่งลิงก์ใหม่ให้)
  async function revokeStaffPin(s) {
    if (!confirm(`ปิดใช้งาน PIN ของ "${s.name}" ทันที? (ต้องส่งลิงก์ตั้งรหัสใหม่ถึงจะเข้าระบบได้อีกครั้ง)`)) return;
    try {
      const r = await fetch('/api/pos/staff', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId, staff_id: s.staff_id, reset_pin: true }),
      });
      const d = await r.json();
      if (d.ok) { await fetchStaff(); showToast(`ปิดใช้งาน PIN ของ ${s.name} แล้ว`); }
      else alert(d.error);
    } catch (err) { alert(err.message); }
  }

  async function fetchOrders(sid) {
    if (!sid) return;
    setOrdersLoading(true);
    try {
      const r = await fetch(`/api/pos/delivery?shopId=${sid}`);
      const d = await r.json();
      if (d.orders) setOrders(d.orders);
    } catch {}
    setOrdersLoading(false);
  }

  async function fetchAdmins(sid) {
    if (!sid) return;
    try {
      const r = await fetch(`/api/shop/admins?shopId=${sid}`);
      const d = await r.json();
      if (d.admins) setAdminsList(d.admins);
    } catch {}
  }

  // แปลง LINE user id ของผู้สร้างออเดอร์ → ชื่อคนอ่านง่าย (เจ้าของร้าน/ชื่อแอดมิน/รหัสดิบ)
  function resolveCreatedBy(lineId) {
    if (!lineId) return '';
    if (lineId === shopInfo?.owner_line_id) return 'เจ้าของร้าน';
    const admin = adminsList.find(a => a.line_user_id === lineId);
    return admin?.display_name || `แอดมิน (${lineId.slice(-6)})`;
  }

  async function confirmCashReceived(order) {
    setCashConfirming(order.order_no);
    try {
      const r = await fetch('/api/pos/delivery', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId, order_no: order.order_no, cash_received: true }),
      });
      const d = await r.json();
      if (d.ok) { await fetchOrders(shopId); showToast('✅ ยืนยันรับเงินเข้าร้านแล้ว'); }
      else alert(d.error);
    } catch (err) { alert(err.message); }
    setCashConfirming(null);
  }

  async function confirmGoodsReceived(order) {
    setGoodsConfirming(order.order_no);
    try {
      const r = await fetch('/api/pos/delivery', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId, order_no: order.order_no, goods_received: true }),
      });
      const d = await r.json();
      if (d.ok) { await fetchOrders(shopId); showToast('✅ ยืนยันรับของคืนเข้าคลังแล้ว'); }
      else alert(d.error);
    } catch (err) { alert(err.message); }
    setGoodsConfirming(null);
  }

  // ── งานเก็บเงิน/ของ (collection dispatch) ────────────────────────────────
  async function fetchCollectionTasks(sid = shopId) {
    if (!sid) return;
    setCollectionTasksLoading(true);
    try {
      const r = await fetch(`/api/pos/collections?shopId=${sid}`);
      const d = await r.json();
      if (d.tasks) setCollectionTasks(d.tasks);
    } catch {}
    setCollectionTasksLoading(false);
  }

  // ดึงรายการสินค้าหมุนเวียนแยกตาม SKU ที่ลูกค้าคนนี้ถืออยู่ (ใช้ในรายงาน→สินค้าหมุนเวียน ตอนกดดูรายละเอียด)
  // คืน 'unreconciled' ถ้าผลรวมที่คำนวณได้ไม่ตรงกับยอดรวมจริง (ข้อมูล log เก่าไม่ครบ) กันโชว์เลขผิด
  async function fetchCyclicalHoldingsFor(cust) {
    if (cyclicalHoldingsCache[cust.contact_id] !== undefined) return;
    try {
      const r = await fetch(`/api/pos/collections?shopId=${shopId}&holdingsFor=${cust.contact_id}`);
      const d = await r.json();
      const holdings = d.holdings || {};
      const sum = Object.values(holdings).reduce((s, q) => s + q, 0);
      setCyclicalHoldingsCache(prev => ({ ...prev, [cust.contact_id]: sum === cust.cylinders ? holdings : 'unreconciled' }));
    } catch {
      setCyclicalHoldingsCache(prev => ({ ...prev, [cust.contact_id]: 'unreconciled' }));
    }
  }

  async function openCollectDispatch(cust) {
    const hasDebt = (cust.debt || 0) > 0;
    const hasItems = (cust.cylinders || 0) > 0;
    const cyclicalProducts = products.filter(p => p.type === 'หมุนเวียน');
    let itemsQty = {};
    let itemsUnreconciled = false;

    // ดึงจำนวนที่ลูกค้าถืออยู่จริงแยกตาม SKU จากประวัติแลกเปลี่ยน — แม่นกว่าเดาเดี่ยว แต่ใช้ได้เฉพาะ
    // ตอนผลรวมตรงกับยอดรวม (cust.cylinders) เท่านั้น เพราะ log บางรายการ (ยืมจากออเดอร์จัดส่ง)
    // เก็บเป็นยอดรวมไม่แยก SKU มาตั้งแต่ต้น (known gap เดิม) ทำให้แยกคืนไม่ได้ครบทุกเคส —
    // ถ้าไม่ตรง ไม่เดาส่งเดา (เสี่ยงผิด) แต่โชว์ยอดรวมให้แอดมินกรอกแยกเองแทน
    if (hasItems && shopId) {
      try {
        const r = await fetch(`/api/pos/collections?shopId=${shopId}&holdingsFor=${cust.contact_id}`);
        const d = await r.json();
        const holdings = d.holdings || {};
        const sumHoldings = Object.values(holdings).reduce((s, q) => s + q, 0);
        if (sumHoldings === cust.cylinders && Object.keys(holdings).length) {
          for (const [sku, qty] of Object.entries(holdings)) {
            if (qty > 0) itemsQty[sku] = String(qty);
          }
        }
      } catch {}
    }
    // ถ้าร้านมีสินค้าหมุนเวียนแบบเดียว ยอดรวม = ยอดของ SKU นั้นเป๊ะอยู่แล้วไม่ต้องเดา
    if (hasItems && !Object.keys(itemsQty).length && cyclicalProducts.length === 1) {
      itemsQty[cyclicalProducts[0].sku] = String(cust.cylinders);
    }
    if (hasItems && !Object.keys(itemsQty).length && cyclicalProducts.length > 1) {
      itemsUnreconciled = true;
    }

    setCollectDispatchCust(cust);
    setCollectDispatchForm({
      task_type: hasDebt && hasItems ? 'ทั้งคู่' : hasItems ? 'สินค้ายืม' : 'เงินเชื่อ',
      debt_amount: hasDebt ? String(cust.debt) : '',
      itemsQty,
      itemsUnreconciled,
      staff_id: '', staff_name: '', staff_line_id: '', notes: '',
    });
    setShowCollectDispatch(true);
  }

  async function submitCollectDispatch() {
    if (!collectDispatchCust || !collectDispatchForm.staff_id || collectDispatching) return;
    setCollectDispatching(true);
    try {
      const cyclicalProducts = products.filter(p => p.type === 'หมุนเวียน');
      const items = cyclicalProducts
        .map(p => ({ sku: p.sku, name: p.name, unit: p.unit, qty: parseInt(collectDispatchForm.itemsQty[p.sku]) || 0 }))
        .filter(i => i.qty > 0);
      const r = await fetch('/api/pos/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopId,
          customer_id: collectDispatchCust.contact_id,
          customer_name: collectDispatchCust.name,
          phone: collectDispatchCust.phone,
          task_type: collectDispatchForm.task_type,
          debt_amount: parseFloat(collectDispatchForm.debt_amount) || 0,
          items,
          staff_id: collectDispatchForm.staff_id,
          staff_name: collectDispatchForm.staff_name,
          staff_line_id: collectDispatchForm.staff_line_id,
          notes: collectDispatchForm.notes,
          created_by: userId || '',
        }),
      });
      const d = await r.json();
      if (d.ok) {
        showToast(`ส่งงานให้ ${collectDispatchForm.staff_name} แล้ว — ${d.collection_no}`);
        setShowCollectDispatch(false);
        fetchCollectionTasks();
      } else {
        alert(d.error);
      }
    } catch (err) { alert(err.message); }
    setCollectDispatching(false);
  }

  async function confirmCollectCash(task) {
    setCollectCashConfirming(task.collection_no);
    try {
      const r = await fetch('/api/pos/collections', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId, collection_no: task.collection_no, cash_received: true }),
      });
      const d = await r.json();
      if (d.ok) { await fetchCollectionTasks(); showToast('✅ ยืนยันรับเงินเข้าร้านแล้ว'); }
      else alert(d.error);
    } catch (err) { alert(err.message); }
    setCollectCashConfirming(null);
  }

  async function confirmCollectGoods(task) {
    setCollectGoodsConfirming(task.collection_no);
    try {
      const r = await fetch('/api/pos/collections', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId, collection_no: task.collection_no, goods_received: true }),
      });
      const d = await r.json();
      if (d.ok) { await fetchCollectionTasks(); showToast('✅ ยืนยันรับของคืนเข้าคลังแล้ว'); }
      else alert(d.error);
    } catch (err) { alert(err.message); }
    setCollectGoodsConfirming(null);
  }

  async function deleteCollectionTask(task) {
    if (!confirm(`ยกเลิกงาน ${task.collection_no}?`)) return;
    try {
      const r = await fetch('/api/pos/collections', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId, collection_no: task.collection_no }),
      });
      const d = await r.json();
      if (d.ok) { await fetchCollectionTasks(); showToast('ยกเลิกงานแล้ว'); }
      else alert(d.error);
    } catch (err) { alert(err.message); }
  }

  async function updateOrderStatus(orderNo, newStatus) {
    setOrderStatusUpdating(orderNo);
    try {
      await fetch('/api/pos/delivery', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId, order_no: orderNo, status: newStatus }),
      });
      fetchOrders(shopId);
    } catch (err) { alert(err.message); }
    setOrderStatusUpdating(null);
  }

  function openEditOrder(order) {
    setEditingOrder(order);
    setOrderEditForm({
      customer_name: order.customer_name || '',
      phone: order.phone || '',
      address: order.address || '',
      payment_method: order.payment_method || 'เก็บปลายทาง',
      staff_id: order.staff_id || '',
      notes: order.notes || '',
    });
    setShowOrderEditForm(true);
  }

  async function saveOrderEdit() {
    if (!editingOrder) return;
    if (!orderEditForm.customer_name.trim()) { showToast('กรุณากรอกชื่อลูกค้า'); return; }
    setOrderEditSaving(true);
    try {
      const chosenStaff = staff.find(s => s.staff_id === orderEditForm.staff_id);
      const r = await fetch('/api/pos/delivery', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopId,
          order_no: editingOrder.order_no,
          customer_name: orderEditForm.customer_name,
          phone: orderEditForm.phone,
          address: orderEditForm.address,
          payment_method: orderEditForm.payment_method,
          staff_id: orderEditForm.staff_id,
          staff_name: chosenStaff?.name || '',
          notes: orderEditForm.notes,
        }),
      });
      const d = await r.json();
      if (d.ok) {
        setShowOrderEditForm(false);
        setEditingOrder(null);
        await fetchOrders(shopId);
        showToast('แก้ไขออเดอร์แล้ว');
      } else {
        alert(d.error);
      }
    } catch (err) { alert(err.message); }
    setOrderEditSaving(false);
  }

  async function deleteOrder(order) {
    if (!confirm(`ลบออเดอร์ "${order.order_no}" ของ "${order.customer_name}" ?`)) return;
    setOrderDeleting(order.order_no);
    try {
      const r = await fetch('/api/pos/delivery', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId, order_no: order.order_no }),
      });
      const d = await r.json();
      if (d.ok) {
        await fetchOrders(shopId);
        showToast('ลบออเดอร์แล้ว');
      } else {
        alert(d.error);
      }
    } catch (err) { alert(err.message); }
    setOrderDeleting(null);
  }

  async function handleDelivery() {
    if (!delivCust || !delivStaff || cart.length === 0) return;

    const addrPre = delivAddrIdx === 0 ? delivCust.address_1 :
                    delivAddrIdx === 1 ? delivCust.address_2 : delivAddrCustom;
    const mapsPre = delivAddrIdx === 0 ? delivCust.maps_1 :
                    delivAddrIdx === 1 ? delivCust.maps_2 : delivMapsCustom;
    // เตือนก่อนส่งงานจริง ถ้าไม่มีที่อยู่/แผนที่/ราคา — พนักงานส่งของจะเปิดมาเจอออเดอร์ที่หาที่ทางไม่ได้
    const missing = [];
    if (!addrPre?.trim()) missing.push('ที่อยู่จัดส่ง');
    if (!mapsPre?.trim()) missing.push('ลิงก์แผนที่ (พนักงานจะกดเปิดแผนที่ไม่ได้)');
    if (cartTotal <= 0) missing.push('ยอดรวม (ตอนนี้เป็น 0 บาท)');
    if (missing.length && !confirm(`ออเดอร์นี้ไม่มี: ${missing.join(', ')} — ยืนยันส่งงานต่อเลยไหม?`)) return;

    setDelivLoading(true);
    try {
      const addr = addrPre;
      const maps = mapsPre;
      const items = cart.map(i => ({ name: i.name, qty: i.qty, price: i.price, sku: i.sku }));
      const total = cartTotal;
      const cylinders_delivered = cart
        .filter(i => products.find(p => p.sku === i.sku)?.type === 'หมุนเวียน')
        .reduce((sum, i) => sum + i.qty, 0);
      const r = await fetch('/api/pos/delivery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopId,
          customer_id: delivCust.contact_id,
          customer_name: delivCust.name,
          phone: delivCust.phone,
          address: addr,
          maps_link: maps,
          items, total,
          payment_method: delivPayment,
          staff_id: delivStaff.staff_id,
          staff_name: delivStaff.name,
          staff_line_id: delivStaff.line_id,
          notes: delivNotes,
          cylinders_delivered,
          created_by: userId || '',
        }),
      });
      const d = await r.json();
      if (d.ok) {
        // บันทึกที่อยู่ที่พิมพ์เองกลับเข้าข้อมูลลูกค้า (ช่องที่ยังว่าง) กันต้องพิมพ์ที่อยู่ซ้ำทุกครั้งที่สั่งจัดส่ง
        if (delivAddrIdx === 2 && delivAddrCustom.trim() && delivCust.contact_id) {
          const slot = !delivCust.address_1 ? 'address_1' : !delivCust.address_2 ? 'address_2' : null;
          if (slot) {
            try {
              await fetch('/api/pos/contacts', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  shopId, contact_id: delivCust.contact_id,
                  [slot]: delivAddrCustom,
                  [slot === 'address_1' ? 'maps_1' : 'maps_2']: delivMapsCustom,
                }),
              });
              fetchContacts();
            } catch {}
          }
        }
        showToast(d.warnings?.length ? d.warnings.join(' / ') : `ส่งงานให้ ${delivStaff.name} แล้ว — ${d.order_no}`);
        setShowDelivery(false);
        // ปิดบิลที่ active
        const remaining = openBills.filter(b => b.id !== activeBillId);
        setOpenBills(remaining);
        persistOpenBills(remaining);
        if (remaining.length > 0) { setActiveBillId(remaining[0].id); setCart(remaining[0].items || []); }
        else { setActiveBillId(null); setCart([]); }
        setDiscount('');
      } else { alert(d.error); }
    } catch (err) { alert(err.message); }
    setDelivLoading(false);
  }

  async function fetchReceiveHistory(sid = shopId) {
    if (!sid) return;
    setReceiveHistoryLoading(true);
    try {
      const r = await fetch(`/api/pos/receives?shopId=${sid}`);
      const d = await r.json();
      if (d.receives) setReceiveHistory(d.receives);
    } catch {}
    setReceiveHistoryLoading(false);
  }

  // ── รับสินค้ารอยืนยันจาก LINE (#รับสินค้า → ถ่ายรูปใบส่งของ → OCR) ───────────
  // ── คำสั่งซื้อจากลูกค้ารอยืนยัน (หน้าเว็บสาธารณะ /order) ──────────────────────
  async function fetchCustomerOrders(sid = shopId) {
    if (!sid) return;
    setCustomerOrdersLoading(true);
    try {
      const r = await fetch(`/api/pos/customer-orders?shopId=${sid}`);
      const d = await r.json();
      if (d.pending) setCustomerOrders(d.pending);
    } catch {}
    setCustomerOrdersLoading(false);
  }

  async function rejectCustomerOrder(order) {
    if (!confirm(`ปฏิเสธคำสั่งซื้อนี้จาก "${order.customer_name}"?`)) return;
    try {
      const r = await fetch('/api/pos/customer-orders', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId, order_no: order.order_no }),
      });
      const d = await r.json();
      if (d.ok) { await fetchCustomerOrders(); showToast('ปฏิเสธคำสั่งซื้อแล้ว'); }
      else alert(d.error);
    } catch (err) { alert(err.message); }
  }

  // ยืนยันคำสั่งซื้อจากลูกค้า → สร้างเป็นออเดอร์จัดส่งจริงผ่าน /api/pos/delivery ตรงๆ (ไม่ผ่าน cart/บิลที่
  // เปิดอยู่ในแท็บขาย เพราะ cart เป็น state ที่ผูกกับบิลที่ active อยู่ ถ้าไปยุ่งจะทำข้อมูลบิลที่กำลังขายอยู่หายได้)
  async function submitCustomerOrderConfirm() {
    if (!confirmingCustomerOrder || !confirmOrderStaffId || confirmOrderSubmitting) return;
    setConfirmOrderSubmitting(true);
    try {
      const order = confirmingCustomerOrder;
      const staffObj = staff.find(s => s.staff_id === confirmOrderStaffId);
      const items = (order.items || []).map(i => ({ name: i.name, qty: i.qty, price: i.price, sku: i.sku }));
      const noteParts = [`สั่งซื้อออนไลน์ ${order.order_no}`, order.notes];
      if (order.payment_method === 'โอนแล้ว' && order.slip_url) noteParts.push(`ลูกค้าแจ้งโอนแล้ว สลิป: ${order.slip_url}`);
      const r = await fetch('/api/pos/delivery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopId,
          customer_name: order.customer_name,
          phone: order.phone,
          address: order.address,
          items, total: order.total,
          payment_method: order.payment_method === 'โอนแล้ว' ? 'โอนแล้ว' : 'เก็บปลายทาง',
          staff_id: staffObj?.staff_id || '',
          staff_name: staffObj?.name || '',
          staff_line_id: staffObj?.line_id || '',
          notes: noteParts.filter(Boolean).join(' | '),
          created_by: userId || '',
        }),
      });
      const d = await r.json();
      if (d.ok) {
        await fetch('/api/pos/customer-orders', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ shopId, order_no: order.order_no }),
        });
        showToast(`ยืนยันเป็นออเดอร์จัดส่งแล้ว — ${d.order_no}`);
        setConfirmingCustomerOrder(null);
        setConfirmOrderStaffId('');
        fetchCustomerOrders();
        fetchOrders();
      } else {
        alert(d.error);
      }
    } catch (err) { alert(err.message); }
    setConfirmOrderSubmitting(false);
  }

  async function fetchPendingReceives(sid = shopId) {
    if (!sid) return;
    setPendingReceivesLoading(true);
    try {
      const r = await fetch(`/api/pos/receives-pending?shopId=${sid}`);
      const d = await r.json();
      if (d.pending) setPendingReceives(d.pending);
    } catch {}
    setPendingReceivesLoading(false);
  }

  // จับคู่ชื่อสินค้าที่ OCR อ่านมากับสินค้าจริงในระบบ (ชื่อ/คำค้น) — รายการที่จับคู่ไม่ได้ต้องไปเพิ่มสินค้าใหม่ก่อน
  function loadPendingIntoForm(pending) {
    const matchedItems = [];
    const unmatchedNames = [];
    for (const item of (pending.items || [])) {
      const q = (item.name || '').toLowerCase().replace(/\s+/g, '');
      const prod = products.find(p => {
        const pn = p.name.toLowerCase().replace(/\s+/g, '');
        const aliases = (p.aliases || '').toLowerCase().split(',').map(a => a.trim().replace(/\s+/g, ''));
        return q && (pn === q || pn.includes(q) || q.includes(pn) || aliases.some(a => a && (a === q || a.includes(q) || q.includes(a))));
      });
      if (prod) {
        matchedItems.push({ sku: prod.sku, name: prod.name, unit: prod.unit, qty: String(item.qty || ''), unitCost: String(item.unitPrice || ''), vatType: 'ไม่มี VAT' });
      } else {
        unmatchedNames.push(item.name);
      }
    }
    setReceiveItems(matchedItems);
    setReceiveSupplierContact(null);
    setReceiveSupplier(pending.supplier || '');
    setReceiveSupplierQ(pending.supplier || '');
    setReceiveNotes(
      `จากใบส่งของ LINE เลขที่ ${pending.invoice_no || '-'} วันที่ ${pending.invoice_date || '-'}` +
      (unmatchedNames.length ? ` — ⚠️ ไม่พบสินค้านี้ในระบบ ต้องเพิ่มสินค้าใหม่ก่อน: ${unmatchedNames.join(', ')}` : '')
    );
    setReceivePhotoUrl(pending.image_url || '');
    setLinkedPendingNo(pending.pending_no);
    setReceiveView('form');
    if (unmatchedNames.length) showToast(`⚠️ ไม่พบสินค้า ${unmatchedNames.length} รายการในระบบ ดูหมายเหตุในฟอร์ม`);
  }

  async function rejectPendingReceive(pending) {
    if (!confirm(`ปฏิเสธรายการรับสินค้านี้จาก "${pending.supplier}"?`)) return;
    try {
      const r = await fetch('/api/pos/receives-pending', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId, pending_no: pending.pending_no }),
      });
      const d = await r.json();
      if (d.ok) { await fetchPendingReceives(); showToast('ปฏิเสธรายการแล้ว'); }
      else alert(d.error);
    } catch (err) { alert(err.message); }
  }

  useEffect(() => {
    if (!configured || !shopId) return;
    if (tab === 'report') { fetchSales(); fetchReport('sales', reportDateFrom, reportDateTo); }
    if (tab === 'settings') { fetchStaff(); fetchStaffRequests(); }
    if (tab === 'orders') { fetchOrders(shopId); fetchCustomerOrders(shopId); fetchStaff(); }
    if (tab === 'collections') fetchCollectionTasks(shopId);
  }, [tab, configured, shopId]);

  // โหลดบิลที่ค้างเมื่อ shopId พร้อม — ลอง server ก่อนเสมอ (ให้สลับเครื่องแล้วเห็นตรงกัน)
  // ถ้าเรียก server ไม่ได้ (ออฟไลน์/ตารางยังไม่ถูกสร้าง) ใช้ localStorage เป็น fallback
  // ถ้า server ว่างแต่เครื่องนี้มีข้อมูลเก่าใน localStorage (ยังไม่เคย sync มาก่อน) ให้ migrate ขึ้น server ทันที
  useEffect(() => {
    if (!shopId) return;
    (async () => {
      let localBills = [], localNames = [];
      try {
        const stored = localStorage.getItem(`pos_bills_${shopId}`);
        localBills = stored ? JSON.parse(stored) : [];
        const storedNames = localStorage.getItem(`pos_table_names_${shopId}`);
        localNames = storedNames ? JSON.parse(storedNames) : [];
      } catch {}

      let bills = localBills, names = localNames;
      try {
        const r = await fetch(`/api/pos/open-bills?shopId=${shopId}`);
        const d = await r.json();
        if (d.ok && !d.tableMissing) {
          bills = d.bills || [];
          names = (d.table_names && d.table_names.length) ? d.table_names : localNames;
          if (bills.length === 0 && localBills.length > 0) {
            bills = localBills; // เครื่องนี้ยังไม่เคย sync มาก่อน — ใช้ของเดิมเป็นตั้งต้นแล้วดันขึ้น server
            persistOpenBills(bills, names);
          }
        }
      } catch {}

      if (names.length) {
        setTableNames(names);
        setTableNamesInput(names.join(', '));
      }
      if (bills.length > 0) {
        setOpenBills(bills);
        setActiveBillId(bills[0].id);
        setCart(bills[0].items || []);
        try { localStorage.setItem(`pos_bills_${shopId}`, JSON.stringify(bills)); } catch {}
      }
    })();
  }, [shopId]);

  // sync cart → openBills ทุกครั้งที่ cart เปลี่ยน
  useEffect(() => {
    const id = activeBillIdRef.current;
    if (!id || !shopId) return;
    setOpenBills(prev => {
      const updated = prev.map(b => b.id === id ? { ...b, items: cart } : b);
      persistOpenBills(updated);
      return updated;
    });
  }, [cart]); // eslint-disable-line react-hooks/exhaustive-deps

  function createBill(name, custObj = null) {
    const trimmed = name?.trim();
    const billName = trimmed || (custObj ? custObj.name : '') || 'cash sale / ขายเงินสด';
    const id = `bill_${Date.now()}`;
    const newBill = {
      id, name: billName, items: [], created_at: new Date().toISOString(),
      customer_id:    custObj?.contact_id || '',
      customer_name:  custObj?.name        || '',
      customer_phone: custObj?.phone       || '',
      customer_shop:  custObj?.shop_name   || '',
    };
    setOpenBills(prev => {
      const updated = [...prev, newBill];
      if (shopId) persistOpenBills(updated);
      return updated;
    });
    setActiveBillId(id);
    setCart([]);
    setDiscount('');
    setCashReceived('');
    setCustomerName('');
    setCreditCustomer(custObj);
    setCustomerPrices({});
    setShowNewBillModal(false);
    setNewBillName('');
    setNewBillCust(null);
    setNewBillCustQ('');
  }

  function switchBill(billId) {
    if (billId === activeBillId) return;
    const bill = openBills.find(b => b.id === billId);
    if (!bill) return;
    setActiveBillId(billId);
    setCart(bill.items || []);
    setDiscount('');
    setCashReceived('');
    setCustomerName('');
    setCreditCustomer(bill.customer_id ? (contacts.find(c => c.contact_id === bill.customer_id) || null) : null);
    setCustomerPrices({});
    setShowCartDrawer(false);
    setShowCheckout(false);
  }

  // ลูกค้าที่เลือกไว้ตอนเปิดบิล (newBillCust) หรือระหว่างขาย (creditCustomer) ให้ใช้ตัวเดียวกันต่อ
  // ไม่ต้องเลือกซ้ำตอนกดชำระเงิน/จัดส่ง — ถ้ายังไม่มีเลยค่อยถามตอนนั้น
  // หมายเหตุ: ขายหน้าร้านใช้ราคากลางเสมอ ไม่ดึงราคาประจำตัวลูกค้ามาใช้ (ราคาประจำตัวใช้เฉพาะตอนเปิดออเดอร์จัดส่งเท่านั้น)
  function openCheckout() {
    if (!creditCustomer) {
      const bill = openBills.find(b => b.id === activeBillId);
      const full = bill?.customer_id ? contacts.find(c => c.contact_id === bill.customer_id) : null;
      if (full) setCreditCustomer(full);
    }
    setBorrowingSku({});
    setBorrowedQty({});
    setShowCheckout(true);
  }

  // รายการในตะกร้าที่เป็นสินค้าหมุนเวียน (เช่น ถังแก๊ส/ขวดน้ำ/ถังออกซิเจน) — ค่าเริ่มต้นถือว่าแลกเปลี่ยนเต็มจำนวน
  const cyclicalCartItems = cart.filter(item => products.find(p => p.sku === item.sku)?.type === 'หมุนเวียน');

  function openDelivery() {
    const bill = openBills.find(b => b.id === activeBillId);
    const full = bill?.customer_id ? contacts.find(c => c.contact_id === bill.customer_id) : null;
    const already = creditCustomer || full;
    setDelivStaff(null);
    setDelivAddrIdx(0);
    setDelivAddrCustom('');
    setDelivMapsCustom('');
    setDelivPayment('เก็บปลายทาง');
    setDelivNotes('');
    setDelivCustSearch('');
    setShowCartDrawer(false);
    if (already) {
      setDelivCust(already);
      setDelivStep(2);
      fetchCustomerPrices(already.contact_id);
    } else {
      setDelivCust(null);
      setDelivStep(1);
    }
    setShowDelivery(true);
  }

  function closeBill(billId, e) {
    e?.stopPropagation();
    const bill = openBills.find(b => b.id === billId);
    if (!bill) return;
    if ((bill.items || []).length > 0) {
      if (!confirm(`ปิดบิล "${bill.name}"?\nรายการในตะกร้าจะหายไป`)) return;
    }
    const remaining = openBills.filter(b => b.id !== billId);
    setOpenBills(remaining);
    if (shopId) persistOpenBills(remaining);
    if (billId === activeBillId) {
      if (remaining.length > 0) {
        setActiveBillId(remaining[0].id);
        setCart(remaining[0].items || []);
      } else {
        setActiveBillId(null);
        setCart([]);
      }
      setDiscount('');
      setCashReceived('');
      setCustomerName('');
    }
  }

  function saveTableNames(rawInput) {
    const names = rawInput.split(',').map(s => s.trim()).filter(Boolean);
    setTableNames(names);
    if (shopId) {
      localStorage.setItem(`pos_table_names_${shopId}`, JSON.stringify(names));
      persistOpenBills(openBills, names); // sync ชื่อโต๊ะขึ้น server ด้วย ให้เครื่องอื่นเห็นตรงกัน
    }
    showToast('บันทึกชื่อโต๊ะแล้ว');
  }

  useEffect(() => {
    if (tab === 'receive' && receiveView === 'history' && shopId) fetchReceiveHistory();
    if (tab === 'receive' && shopId) fetchPendingReceives();
  }, [tab, receiveView, shopId]);

  useEffect(() => {
    if (tab === 'expenses' && shopId) { fetchExpenseHistory(); fetchPendingExpenses(); }
  }, [tab, shopId]);

  // ── categories & filter ───────────────────────────────────────────────────
  const categories = useMemo(() => {
    const cats = [...new Set(products.map(p => p.category).filter(Boolean))].sort();
    return ['ทั้งหมด', ...cats];
  }, [products]);

  const displayProducts = useMemo(() => {
    // sale tab แสดงเฉพาะ active + กรองตามสาขาที่เลือก, products tab (จัดการสินค้า) แสดงทั้งหมดทุกสาขาเสมอ
    let p = tab === 'products' ? products : products.filter(x => x.is_active !== false);
    if (tab !== 'products' && selectedBranch?.branch_name) {
      p = p.filter(x => !x.branches?.length || x.branches.includes(selectedBranch.branch_name));
    }
    if (selectedCat !== 'ทั้งหมด') p = p.filter(x => x.category === selectedCat);
    if (search) {
      const q = search.toLowerCase();
      p = p.filter(x =>
        x.name.toLowerCase().includes(q) ||
        x.aliases.toLowerCase().includes(q) ||
        x.sku.toLowerCase().includes(q) ||
        (x.product_code || '').toLowerCase().includes(q) ||
        (x.barcode || '').toLowerCase().includes(q)
      );
    }
    return p;
  }, [products, selectedCat, search, tab, selectedBranch]);

  // ── cart ──────────────────────────────────────────────────────────────────
  function addToCart(prod) {
    if (prod.type !== 'ไม่นับสต็อค' && prod.stock <= 0) { showToast('สินค้าหมดสต็อค'); return; }
    setCart(prev => {
      const ex = prev.find(i => i.sku === prod.sku);
      if (ex) {
        if (ex.qty >= prod.stock) { showToast('เกินจำนวนสต็อค'); return prev; }
        return prev.map(i => i.sku === prod.sku ? { ...i, qty: i.qty + 1 } : i);
      }
      return [...prev, { sku: prod.sku, name: prod.name, price: prod.price, qty: 1, unit: prod.unit }];
    });
  }

  function updateQty(sku, qty) {
    if (qty <= 0) { setCart(prev => prev.filter(i => i.sku !== sku)); return; }
    setCart(prev => prev.map(i => i.sku === sku ? { ...i, qty } : i));
  }

  function updatePrice(sku, newPrice) {
    const price = Math.max(0, parseFloat(newPrice) || 0);
    setCart(prev => prev.map(i => i.sku === sku ? { ...i, price } : i));
  }

  // ดึงราคาประจำตัวของลูกค้า (จากบิลล่าสุดที่เคยขายให้ลูกค้าคนนี้) มาใช้กับสินค้าในตะกร้า
  async function fetchCustomerPrices(contactId) {
    if (!contactId || !shopId) { setCustomerPrices({}); return; }
    try {
      const r = await fetch(`/api/pos/sales?shopId=${shopId}&customerId=${contactId}`);
      const d = await r.json();
      const prices = {};
      // sales คืนเรียงใหม่สุดก่อนอยู่แล้ว — เจอ sku ไหนก่อนคือราคาล่าสุด
      for (const sale of (d.sales || [])) {
        for (const item of (sale.items || [])) {
          if (item.sku && !(item.sku in prices)) prices[item.sku] = item.price;
        }
      }
      setCustomerPrices(prices);
      if (Object.keys(prices).length > 0) {
        setCart(prev => prev.map(i => prices[i.sku] !== undefined ? { ...i, price: prices[i.sku] } : i));
        showToast('ใช้ราคาประจำตัวของลูกค้าคนนี้แล้ว');
      }
    } catch {}
  }

  const cartSubtotal = useMemo(() => cart.reduce((sum, i) => sum + i.price * i.qty, 0), [cart]);
  const cartDiscount = discountType === 'percent'
    ? cartSubtotal * (parseFloat(discount) || 0) / 100
    : (parseFloat(discount) || 0);
  const cartTotal = Math.max(0, cartSubtotal - cartDiscount);
  const cartChange = payMethod === 'เงินสด' ? Math.max(0, (parseFloat(cashReceived) || 0) - cartTotal) : 0;

  // โหลด QR เมื่อเปลี่ยนวิธีชำระเป็น "โอน" ใน checkout
  useEffect(() => {
    if (!showCheckout || payMethod !== 'โอน' || !shopId || !cartTotal) {
      setQrImageData('');
      return;
    }
    let cancelled = false;
    setQrLoading(true);
    fetch(`/api/pos/promptpay-qr?shopId=${shopId}&amount=${cartTotal}`)
      .then(r => r.json())
      .then(d => { if (!cancelled && d.qr) setQrImageData(d.qr); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setQrLoading(false); });
    return () => { cancelled = true; };
  }, [showCheckout, payMethod, shopId, cartTotal]);

  // ── checkout ──────────────────────────────────────────────────────────────
  async function handleSlipCapture(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSlipUploading(true);
    setSlipDriveUrl('');
    setSlipOcrData(null);
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
        setSlipDriveUrl(d.url || '');
        setSlipOcrData(d);
      } else {
        alert('อัปโหลดสลิปไม่สำเร็จ: ' + (d.error || 'unknown error'));
      }
    } catch (err) {
      alert('เกิดข้อผิดพลาด: ' + err.message);
    } finally {
      setSlipUploading(false);
      if (slipInputRef.current) slipInputRef.current.value = '';
    }
  }

  async function handleCheckout() {
    if (!cart.length || checkoutLoading) return;
    setCheckoutLoading(true);
    try {
      // แนบ returned_qty (ของเก่าที่ลูกค้าคืนมา) เข้ากับรายการสินค้าหมุนเวียนในตะกร้า
      // ค่าเริ่มต้น = แลกเปลี่ยนเต็มจำนวน (returned_qty = qty) ยกเว้นเปิดโหมด "ยืม" ไว้จะหักจำนวนที่ยืมออก
      const itemsWithReturns = cart.map(item => {
        const isCyclical = products.find(p => p.sku === item.sku)?.type === 'หมุนเวียน';
        if (!isCyclical) return item;
        const borrowed = borrowingSku[item.sku] ? Math.min(item.qty, parseInt(borrowedQty[item.sku]) || 0) : 0;
        // returned_qty ใส่เสมอสำหรับสินค้าหมุนเวียน (แม้เป็น 0 ตอนยืมเต็มจำนวน) — ใบเสร็จ/รายงาน
        // ใช้ presence ของฟิลด์นี้แยกว่ารายการนี้เป็นสินค้าหมุนเวียนหรือไม่ (ไม่ใช่แค่ตอนมีการคืน)
        return { ...item, returned_qty: Math.max(0, item.qty - borrowed) };
      });
      const r = await fetch('/api/pos/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopId,
          items: itemsWithReturns,
          discount: cartDiscount,
          payment_method: payMethod,
          cash_received: parseFloat(cashReceived) || cartTotal,
          cashier: shopInfo?.shop_name || '',
          customerName: creditCustomer?.name || customerName.trim(),
          customerId: creditCustomer?.contact_id || '',
          slipUrl: slipDriveUrl || '',
          slipSender: slipOcrData?.sender || '',
          slipRefNo: slipOcrData?.refNo || '',
          branch: selectedBranch?.branch_name || '',
          transactionDate: saleDate || '',
          shift_no: payMethod === 'เงินสด' ? (activeShift?.shift_no || '') : '',
        }),
      });
      const d = await r.json();
      if (d.ok) {
        setSaleDate('');
        setLastBill({
          billNo: d.billNo,
          items: itemsWithReturns,
          subtotal: cartSubtotal,
          discount: cartDiscount,
          total: cartTotal,
          payMethod,
          customerName: creditCustomer?.name || customerName.trim(),
          customerId: creditCustomer?.contact_id || '',
          cashReceived: parseFloat(cashReceived) || cartTotal,
          change: cartChange,
          time: new Date().toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok' }),
          billName: openBills.find(b => b.id === activeBillId)?.name || '',
          vatSubtotal: d.vatSubtotal || 0,
          vatAmount: d.vatAmount || 0,
        });
        // ปิดบิลที่ checkout เสร็จ + สลับไปบิลถัดไป (ถ้ามี)
        const remaining = openBills.filter(b => b.id !== activeBillId);
        setOpenBills(remaining);
        if (shopId) persistOpenBills(remaining);
        if (remaining.length > 0) {
          setActiveBillId(remaining[0].id);
          setCart(remaining[0].items || []);
        } else {
          setActiveBillId(null);
          setCart([]);
        }
        setDiscount('');
        setCashReceived('');
        setCustomerName('');
        setSlipDriveUrl('');
        setSlipOcrData(null);
        setCreditCustomer(null);
        setCreditCustomerQ('');
        setBorrowingSku({});
        setBorrowedQty({});
        setShowCheckout(false);
        setShowCartDrawer(false);
        setShowBill(true);
        fetchProducts();
        if (d.warnings?.length) showToast(d.warnings.join(' / '));
      } else {
        alert(d.error || 'เกิดข้อผิดพลาด');
      }
    } catch (err) {
      alert(err.message);
    }
    setCheckoutLoading(false);
  }

  // ── ยกเลิกบิล (คืนสต็อค/ยอดค้างชำระให้อัตโนมัติ) ─────────────────────────────
  async function cancelBill(billNo) {
    if (!confirm(`ยกเลิกบิล ${billNo}? ระบบจะคืนสต็อคสินค้าและยอดค้างชำระ (ถ้ามี) กลับให้อัตโนมัติ`)) return;
    try {
      const r = await fetch('/api/pos/sales', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId, bill_no: billNo }),
      });
      const d = await r.json();
      if (d.ok) {
        showToast('ยกเลิกบิลแล้ว');
        fetchReport();
        fetchProducts();
      } else { alert(d.error); }
    } catch (err) { alert(err.message); }
  }

  // ── พิมพ์ใบเสร็จ / ใบกำกับภาษี ───────────────────────────────────────────────
  function printReceipt(bill) {
    // ถ้าสาขาที่เลือกอยู่ตั้งชื่อแบรนด์/ที่อยู่แยกไว้ (หน้าตั้งค่า → จัดการสาขา) ใบเสร็จแสดงของสาขานั้นแทน
    const receiptShopInfo = (selectedBranch?.brand_name || selectedBranch?.address)
      ? { ...shopInfo, shop_name: selectedBranch.brand_name || shopInfo?.shop_name, address: selectedBranch.address || shopInfo?.address }
      : shopInfo;
    const html = buildReceiptHtml({
      paperSize: posConfig.receipt_paper_size || '80mm',
      shopInfo: receiptShopInfo,
      isTaxInvoice: false,
      showVat: !!posConfig.vat_registered,
      docNo: bill.billNo,
      dateStr: new Date().toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' }) + ' ' + bill.time,
      items: bill.items,
      subtotal: bill.vatSubtotal || bill.subtotal,
      vat: bill.vatAmount || 0,
      discount: bill.discount,
      total: bill.total,
      payMethod: bill.payMethod,
      cashReceived: bill.payMethod === 'เงินสด' ? bill.cashReceived : 0,
      change: bill.change,
      isWhiteLabel: hasFeature(shopInfo?.subscription_tier, 'white_label'),
    });
    openPrintWindow(html);
  }

  function openTaxInvoiceForm(bill) {
    const cust = bill.customerId ? contacts.find(c => c.contact_id === bill.customerId) : null;
    setTaxInvoiceForm({
      buyer_name: cust?.company_name || cust?.name || bill.customerName || '',
      buyer_tax_id: cust?.tax_id || '',
      buyer_address: cust?.tax_address || cust?.address_1 || '',
      buyer_branch: cust?.tax_branch || 'สำนักงานใหญ่',
      buyer_phone: cust?.phone || '',
      customer_id: cust?.contact_id || '',
    });
    setTaxInvoiceContactQ('');
    setShowTaxInvoiceForm(true);
  }

  // เลือกผู้ติดต่อมาเติมข้อมูลผู้ซื้อในฟอร์มใบกำกับภาษีทั้งชุด
  function pickTaxInvoiceContact(c) {
    setTaxInvoiceForm(f => ({
      ...f,
      buyer_name: c.company_name || c.name || '',
      buyer_tax_id: c.tax_id || '',
      buyer_address: c.tax_address || c.address_1 || '',
      buyer_branch: c.tax_branch || 'สำนักงานใหญ่',
      buyer_phone: c.phone || '',
      customer_id: c.contact_id || '',
    }));
    setTaxInvoiceContactQ('');
  }

  async function issueTaxInvoice() {
    if (!lastBill || taxInvoiceIssuing) return;
    if (!taxInvoiceForm.buyer_name.trim()) { showToast('กรุณากรอกชื่อผู้ซื้อ'); return; }
    if (!taxInvoiceForm.buyer_tax_id.trim()) { showToast('กรุณากรอกเลขผู้เสียภาษีของผู้ซื้อ'); return; }
    setTaxInvoiceIssuing(true);
    try {
      const r = await fetch('/api/pos/tax-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopId,
          ref_bill_no: lastBill.billNo,
          customer_id: taxInvoiceForm.customer_id || lastBill.customerId || '',
          buyer_name: taxInvoiceForm.buyer_name.trim(),
          buyer_tax_id: taxInvoiceForm.buyer_tax_id.trim(),
          buyer_address: taxInvoiceForm.buyer_address.trim(),
          buyer_branch: taxInvoiceForm.buyer_branch.trim(),
          buyer_phone: taxInvoiceForm.buyer_phone.trim(),
          items: lastBill.items,
          issued_by: shopInfo?.shop_name || '',
          // ผู้ออกใบกำกับภาษีจริง — ถ้าสาขาที่เลือกอยู่ตั้งชื่อแบรนด์/ที่อยู่แยกไว้ (หน้าตั้งค่า → จัดการสาขา)
          // ใช้ของสาขานั้นแทน ไม่งั้นใช้ชื่อ/ที่อยู่บริษัทหลักตามปกติ (แช่แข็งค่านี้ไว้ตอนออกจริง)
          seller_name: selectedBranch?.brand_name || shopInfo?.shop_name || '',
          seller_address: selectedBranch?.address || shopInfo?.address || '',
        }),
      });
      const d = await r.json();
      if (d.ok) {
        window.open(`/api/pos/tax-invoice-pdf?shopId=${shopId}&invoice_no=${encodeURIComponent(d.invoice_no)}`, '_blank');
        setShowTaxInvoiceForm(false);
        showToast(`ออกใบกำกับภาษี ${d.invoice_no} แล้ว`);
      } else {
        alert(d.error);
      }
    } catch (err) { alert(err.message); }
    setTaxInvoiceIssuing(false);
  }

  // ── product CRUD ──────────────────────────────────────────────────────────
  function openAddProd() {
    setEditProd(null);
    setProdForm(emptyProdForm());
    setShowProdForm(true);
  }

  function openEditProd(prod) {
    setEditProd(prod);
    setProdForm({
      name: prod.name, category: prod.category,
      price: String(prod.price), stock: String(prod.stock),
      unit: prod.unit, aliases: prod.aliases, notes: prod.notes,
      type: prod.type || 'นับสต็อค',
      product_code: prod.product_code || '',
      barcode: prod.barcode || '',
      description: prod.description || '',
      vat_type: prod.vat_type || 'ไม่มี VAT',
      is_active: prod.is_active !== false,
      empty_ceiling: prod.empty_ceiling ? String(prod.empty_ceiling) : '',
      branches: prod.branches || [],
    });
    setShowProdForm(true);
  }

  async function saveProd() {
    if (!prodForm.name) { showToast('กรุณากรอกชื่อสินค้า'); return; }
    setProdSaving(true);
    const base = {
      ...prodForm,
      price: parseFloat(prodForm.price) || 0,
      stock: parseFloat(prodForm.stock) || 0,
      empty_ceiling: parseFloat(prodForm.empty_ceiling) || 0,
    };
    const body = editProd ? { shopId, sku: editProd.sku, ...base } : { shopId, ...base };
    try {
      const r = await fetch('/api/pos/products', {
        method: editProd ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (d.ok) {
        setShowProdForm(false);
        setEditProd(null);
        await fetchProducts();
        showToast(editProd ? 'แก้ไขสินค้าแล้ว' : 'เพิ่มสินค้าแล้ว');
      } else {
        alert(d.error);
      }
    } catch (err) {
      alert(err.message);
    }
    setProdSaving(false);
  }

  async function deleteProd(prod) {
    if (!confirm(`ลบสินค้า "${prod.name}" ?`)) return;
    await fetch('/api/pos/products', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shopId, sku: prod.sku }),
    });
    await fetchProducts();
    showToast('ลบสินค้าแล้ว');
  }

  async function doCyclicalAction() {
    if (!cyclicalProd || !cyclicalQty || cyclicalSaving) return;
    setCyclicalSaving(true);
    try {
      const r = await fetch('/api/pos/products', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId, sku: cyclicalProd.sku, action: showCyclicalModal, qty: parseInt(cyclicalQty) }),
      });
      const d = await r.json();
      if (d.ok) {
        showToast(showCyclicalModal === 'receive-back' ? `รับคืน ${cyclicalQty} ${cyclicalProd.unit}` : `รีฟิล ${cyclicalQty} ${cyclicalProd.unit} เรียบร้อย`);
        setShowCyclicalModal(null);
        setCyclicalQty('');
        fetchProducts();
      } else { alert(d.error); }
    } catch (err) { alert(err.message); }
    setCyclicalSaving(false);
  }

  // ── receive stock ─────────────────────────────────────────────────────────
  const receiveFiltered = products.filter(p => {
    if (receiveCat !== 'ทั้งหมด' && p.category !== receiveCat) return false;
    if (!receiveSearch) return true;
    const q = receiveSearch.toLowerCase();
    return p.name.toLowerCase().includes(q) || p.aliases.toLowerCase().includes(q);
  });

  function addReceiveItem(prod) {
    setReceiveItems(prev => {
      const ex = prev.find(i => i.sku === prod.sku);
      if (ex) return prev; // มีแล้ว ไม่เพิ่มซ้ำ
      // ถ้าผู้จำหน่ายรายนี้เคยขายสินค้าตัวนี้มาก่อน ใส่ราคาล่าสุดให้อัตโนมัติ
      const lastPrice = supplierPrices[prod.sku];
      return [...prev, { sku: prod.sku, name: prod.name, unit: prod.unit, qty: '', unitCost: lastPrice != null ? String(lastPrice) : '', vatType: 'ไม่มี VAT' }];
    });
    setReceiveSearch('');
    showToast(`เพิ่ม "${prod.name}" แล้ว`);
  }

  function removeReceiveItem(sku) {
    setReceiveItems(prev => prev.filter(i => i.sku !== sku));
  }

  function updateReceiveItem(sku, field, value) {
    setReceiveItems(prev => prev.map(i => i.sku === sku ? { ...i, [field]: value } : i));
  }

  const receiveSubtotal = receiveItems.reduce((sum, i) => {
    const { base } = splitVatAmount(parseFloat(i.unitCost) || 0, i.vatType);
    return sum + (parseFloat(i.qty) || 0) * base;
  }, 0);
  const receiveVatTotal = receiveItems.reduce((sum, i) => {
    const { vat } = splitVatAmount(parseFloat(i.unitCost) || 0, i.vatType);
    return sum + (parseFloat(i.qty) || 0) * vat;
  }, 0);
  const receiveTotalCost = receiveSubtotal + receiveVatTotal;

  // computed views — ลูกค้า / ผู้จำหน่าย filtered จาก contacts รวม
  const customers = contacts.filter(c => c.contact_type === 'ลูกค้า' || c.contact_type === 'ทั้งคู่');
  const suppliers = contacts.filter(c => c.contact_type === 'ผู้จำหน่าย' || c.contact_type === 'ทั้งคู่');

  // ลูกค้าที่ตรงกับคำค้นหาในหน้าจัดส่ง — เทียบเบอร์โทรเฉพาะตัวเลข กันปัญหาต้องพิมพ์ขีด (-) ให้ตรงเป๊ะ
  const delivMatchedCustomers = useMemo(() => {
    const q = delivCustSearch.trim().toLowerCase();
    if (!q) return customers;
    const qDigits = q.replace(/\D/g, '');
    return customers.filter(c =>
      (c.name || '').toLowerCase().includes(q) ||
      (qDigits.length > 0 && (c.phone || '').replace(/\D/g, '').includes(qDigits))
    );
  }, [customers, delivCustSearch]);

  // ผู้ติดต่อที่ตรงกับคำค้นหาในฟอร์มออกใบกำกับภาษี — ค้นได้ทั้งชื่อและเบอร์โทร (แบบเดียวกับจุดอื่น)
  const taxInvoiceMatchedContacts = useMemo(() => {
    const q = taxInvoiceContactQ.trim().toLowerCase();
    if (!q) return [];
    const qDigits = q.replace(/\D/g, '');
    return contacts.filter(c =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.company_name || '').toLowerCase().includes(q) ||
      (qDigits.length > 0 && (c.phone || '').replace(/\D/g, '').includes(qDigits))
    ).slice(0, 5);
  }, [contacts, taxInvoiceContactQ]);

  // ผู้จำหน่ายที่ตรงกับคำค้นหาในหน้ารับสินค้า — เทียบเบอร์โทรเฉพาะตัวเลขเหมือนกัน
  const receiveMatchedSuppliers = useMemo(() => {
    const q = receiveSupplierQ.trim().toLowerCase();
    if (!q) return [];
    const qDigits = q.replace(/\D/g, '');
    return suppliers.filter(c =>
      (c.name || '').toLowerCase().includes(q) ||
      (qDigits.length > 0 && (c.phone || '').replace(/\D/g, '').includes(qDigits))
    ).slice(0, 5);
  }, [suppliers, receiveSupplierQ]);

  // ดึงราคาซื้อล่าสุดจากผู้จำหน่ายรายนี้ต่อสินค้าแต่ละตัว (จากประวัติรับสินค้า)
  async function fetchSupplierPrices(contactId) {
    if (!contactId || !shopId) { setSupplierPrices({}); return; }
    try {
      const r = await fetch(`/api/pos/receives?shopId=${shopId}&supplierId=${contactId}`);
      const d = await r.json();
      const prices = {};
      // receives คืนเรียงใหม่สุดก่อนอยู่แล้ว — เจอ sku ไหนก่อนคือราคาล่าสุด
      for (const rec of (d.receives || [])) {
        for (const item of (rec.items || [])) {
          if (item.sku && !(item.sku in prices)) prices[item.sku] = item.unitCost;
        }
      }
      setSupplierPrices(prices);
      if (Object.keys(prices).length > 0) {
        setReceiveItems(prev => prev.map(i => prices[i.sku] != null ? { ...i, unitCost: String(prices[i.sku]) } : i));
        showToast('ใช้ราคาซื้อล่าสุดจากผู้จำหน่ายรายนี้แล้ว');
      }
    } catch {}
  }

  async function handleReceive() {
    if (!receiveItems.length || receiveSaving) return;
    const validItems = receiveItems.filter(i => i.qty && parseFloat(i.qty) > 0);
    if (!validItems.length) { showToast('กรุณากรอกจำนวนที่รับ'); return; }

    setReceiveSaving(true);
    try {
      const r = await fetch('/api/pos/receives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopId,
          supplierId: receiveSupplierContact?.contact_id || '',
          supplier: receiveSupplierContact?.name || receiveSupplier,
          items: validItems,
          notes: receiveNotes,
          branch: selectedBranch?.branch_name || '',
          photoUrl: receivePhotoUrl,
          transactionDate: receiveDate || '',
        }),
      });
      const d = await r.json();
      if (d.ok) {
        await fetchProducts();
        showToast(`✅ รับสินค้าสำเร็จ! ${d.itemCount} รายการ รวม ฿${(d.totalCost || 0).toLocaleString()} (VAT ฿${(d.vatTotal || 0).toLocaleString()})`);
        setReceiveItems([]);
        setReceiveSupplier('');
        setReceiveSupplierContact(null);
        setReceiveSupplierQ('');
        setSupplierPrices({});
        setReceiveNotes('');
        setReceivePhotoUrl('');
        setReceiveDate('');
        if (d.warnings?.length) setTimeout(() => showToast(d.warnings.join(' / ')), 3200);
        // ถ้ามาจากรายการรอยืนยันของ LINE — ลบออกจากคิวรอ เพราะยืนยันเข้าสต็อคจริงแล้ว
        if (linkedPendingNo) {
          const doneNo = linkedPendingNo;
          setLinkedPendingNo(null);
          fetch('/api/pos/receives-pending', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ shopId, pending_no: doneNo }),
          }).then(() => fetchPendingReceives()).catch(() => {});
        }
      } else {
        alert(d.error);
      }
    } catch (err) {
      alert(err.message);
    }
    setReceiveSaving(false);
  }

  // ── รายจ่าย ────────────────────────────────────────────────────────────────
  async function fetchExpenseHistory(sid = shopId) {
    if (!sid) return;
    setExpenseHistoryLoading(true);
    try {
      const r = await fetch(`/api/pos/expenses?shopId=${sid}`);
      const d = await r.json();
      setExpenseHistory(d.expenses || []);
      setExpenseSummary(d.summary || null);
    } catch {}
    setExpenseHistoryLoading(false);
  }

  async function handleExpensePhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setExpensePhotoUploading(true);
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
        body: JSON.stringify({ shopId, imageBase64: base64, mimeType: file.type, folderLabel: 'expense' }),
      });
      const d = await r.json();
      if (d.ok) { setExpensePhotoUrl(d.url); showToast('แนบรูปแล้ว'); }
      else alert(d.error || 'อัปโหลดรูปไม่สำเร็จ');
    } catch (err) {
      alert(err.message);
    }
    setExpensePhotoUploading(false);
  }

  async function handleReceivePhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setReceivePhotoUploading(true);
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
        body: JSON.stringify({ shopId, imageBase64: base64, mimeType: file.type, folderLabel: 'receive' }),
      });
      const d = await r.json();
      if (d.ok) { setReceivePhotoUrl(d.url); showToast('แนบรูปแล้ว'); }
      else alert(d.error || 'อัปโหลดรูปไม่สำเร็จ');
    } catch (err) {
      alert(err.message);
    }
    setReceivePhotoUploading(false);
  }

  async function submitExpense() {
    if (!expenseForm.label.trim()) { showToast('กรุณากรอกรายการ/หมวดหมู่'); return; }
    if (!expenseForm.amount || parseFloat(expenseForm.amount) <= 0) { showToast('กรุณากรอกจำนวนเงิน'); return; }
    setExpenseSaving(true);
    try {
      const r = await fetch('/api/pos/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopId,
          label: expenseForm.label.trim(),
          amount: expenseForm.amount,
          vatType: expenseForm.vatType,
          payment_method: expenseForm.payment_method,
          photo_url: expensePhotoUrl,
          notes: expenseForm.notes,
          recordedBy: shopInfo?.shop_name || '',
          branch: selectedBranch?.branch_name || '',
          transactionDate: expenseForm.transactionDate || '',
          shift_no: expenseForm.payment_method === 'เงินสด' ? (activeShift?.shift_no || '') : '',
        }),
      });
      const d = await r.json();
      if (d.ok) {
        showToast(`✅ บันทึกรายจ่าย ${d.expenseNo} แล้ว (฿${d.total.toLocaleString()})`);
        setExpenseForm({ label: '', amount: '', vatType: 'ไม่มี VAT', payment_method: 'เงินสด', notes: '', transactionDate: '' });
        setExpensePhotoUrl('');
        fetchExpenseHistory();
        // ถ้ามาจากรายการรอยืนยันของ LINE — ลบออกจากคิวรอ เพราะบันทึกจริงแล้ว
        if (linkedExpensePendingNo) {
          const doneNo = linkedExpensePendingNo;
          setLinkedExpensePendingNo(null);
          fetch('/api/pos/expenses-pending', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ shopId, pending_no: doneNo }),
          }).then(() => fetchPendingExpenses()).catch(() => {});
        }
      } else {
        alert(d.error);
      }
    } catch (err) {
      alert(err.message);
    }
    setExpenseSaving(false);
  }

  async function deleteExpense(expense_no) {
    if (!confirm('ลบรายการรายจ่ายนี้?')) return;
    try {
      const r = await fetch('/api/pos/expenses', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId, expense_no }),
      });
      const d = await r.json();
      if (d.ok) { showToast('ลบแล้ว'); fetchExpenseHistory(); } else alert(d.error);
    } catch (err) { alert(err.message); }
  }

  // รอยืนยันจาก LINE (#รายจ่าย → ถ่ายรูปบิล → OCR)
  async function fetchPendingExpenses(sid = shopId) {
    if (!sid) return;
    setPendingExpensesLoading(true);
    try {
      const r = await fetch(`/api/pos/expenses-pending?shopId=${sid}`);
      const d = await r.json();
      if (d.pending) setPendingExpenses(d.pending);
    } catch {}
    setPendingExpensesLoading(false);
  }

  function loadPendingExpenseIntoForm(pending) {
    setExpenseForm({
      label: pending.label || '',
      amount: pending.amount ? String(pending.amount) : '',
      vatType: pending.vat_type || 'ไม่มี VAT',
      payment_method: 'เงินสด',
      notes: `จากบิล LINE เลขที่ ${pending.invoice_no || '-'} วันที่ ${pending.invoice_date || '-'}${pending.vendor && pending.vendor !== '-' ? ` — ผู้รับเงิน: ${pending.vendor}` : ''}`,
    });
    setExpensePhotoUrl(pending.image_url || '');
    setLinkedExpensePendingNo(pending.pending_no);
    showToast('โหลดข้อมูลจาก LINE เข้าฟอร์มแล้ว — ตรวจสอบก่อนกดบันทึก');
  }

  async function rejectPendingExpense(pending) {
    if (!confirm(`ปฏิเสธรายการรายจ่ายนี้ "${pending.label}"?`)) return;
    try {
      const r = await fetch('/api/pos/expenses-pending', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId, pending_no: pending.pending_no }),
      });
      const d = await r.json();
      if (d.ok) { await fetchPendingExpenses(); showToast('ปฏิเสธรายการแล้ว'); }
      else alert(d.error);
    } catch (err) { alert(err.message); }
  }

  // ── contacts CRUD ─────────────────────────────────────────────────────────
  const displayContacts = useMemo(() => {
    let list = contacts;
    if (contactFilter !== 'ทั้งหมด') {
      list = contactFilter === 'ทั้งคู่'
        ? list.filter(c => c.contact_type === 'ทั้งคู่')
        : list.filter(c => c.contact_type === contactFilter || c.contact_type === 'ทั้งคู่');
    }
    if (contactSearch.trim()) {
      const q = contactSearch.trim().toLowerCase();
      const qDigits = q.replace(/\D/g, '');
      list = list.filter(c => {
        const textHit = [c.name, c.email, c.company_name, c.shop_name, c.aliases, c.tax_id]
          .some(v => v && v.toLowerCase().includes(q));
        // เบอร์โทร: เทียบเฉพาะตัวเลข กันปัญหาต้องพิมพ์ขีด (-) ให้ตรงเป๊ะถึงจะเจอ
        const phoneHit = qDigits.length > 0 && c.phone && c.phone.replace(/\D/g, '').includes(qDigits);
        return textHit || phoneHit;
      });
    }
    // เฉพาะที่มียอดค้างชำระหรือถังค้างอยู่ — เรียงยอดค้าง (บาท) มากไปน้อยก่อน แล้วค่อยถังค้าง
    // (ไม่รวมหน่วยเข้าด้วยกัน กันเลขบาทกับจำนวนถังไปปนกันจนเรียงมั่ว)
    if (contactOutstandingOnly) {
      list = list.filter(c => (c.debt || 0) > 0 || (c.cylinders || 0) > 0)
        .slice()
        .sort((a, b) => (b.debt || 0) - (a.debt || 0) || (b.cylinders || 0) - (a.cylinders || 0));
    }
    return list;
  }, [contacts, contactFilter, contactSearch, contactOutstandingOnly]);

  // รีเซ็ตกลับหน้า 1 ทุกครั้งที่เปลี่ยนตัวกรอง/คำค้นหา
  useEffect(() => { setContactPage(1); }, [contactFilter, contactSearch, contactOutstandingOnly]);

  // ตัวกรองออเดอร์จัดส่ง — สถานะ (ค้าง/จัดส่งแล้ว) + วันที่ (วันนี้/เดือนนี้) กันหายากตอนออเดอร์เยอะ
  const displayOrders = useMemo(() => {
    let list = orders;
    if (orderStatusFilter === 'pending') {
      list = list.filter(o => o.status === 'รอจัดส่ง' || o.status === 'กำลังส่ง');
    } else if (orderStatusFilter === 'delivered') {
      list = list.filter(o => o.status === 'ส่งแล้ว');
    }
    if (orderDateFilter !== 'all') {
      const today = new Date();
      list = list.filter(o => {
        const od = parseThaiOrderDate(o.created_at);
        if (!od) return false;
        if (orderDateFilter === 'today') {
          return od.getFullYear() === today.getFullYear() && od.getMonth() === today.getMonth() && od.getDate() === today.getDate();
        }
        return od.getFullYear() === today.getFullYear() && od.getMonth() === today.getMonth();
      });
    }
    return list;
  }, [orders, orderStatusFilter, orderDateFilter]);

  const contactTotalPages = Math.max(1, Math.ceil(displayContacts.length / CONTACTS_PER_PAGE));
  const pagedContacts = useMemo(() =>
    displayContacts.slice((contactPage - 1) * CONTACTS_PER_PAGE, contactPage * CONTACTS_PER_PAGE),
    [displayContacts, contactPage]
  );

  function openAddContact() {
    setEditContact(null);
    setContactForm(emptyContactForm());
    setShowTaxSection(false);
    setShowContactForm(true);
  }

  function openEditContact(c) {
    setEditContact(c);
    setContactForm({
      name:                c.name                || '',
      contact_type:        c.contact_type        || 'ผู้จำหน่าย',
      phone:               c.phone               || '',
      email:               c.email               || '',
      address_1:           c.address_1           || '',
      maps_1:              c.maps_1              || '',
      address_2:           c.address_2           || '',
      maps_2:              c.maps_2              || '',
      company_name:        c.company_name        || '',
      tax_id:              c.tax_id              || '',
      tax_address:         c.tax_address         || '',
      tax_branch:          c.tax_branch          || '',
      debt:                c.debt > 0 ? c.debt : '',
      cylinders:           c.cylinders > 0 ? c.cylinders : '',
      shop_name:           c.shop_name           || '',
      aliases:             c.aliases             || '',
      notes:               c.notes               || '',
      person_type:         c.person_type         || 'บุคคลธรรมดา',
      contact_person_name: c.contact_person_name || '',
      contact_person_phone:c.contact_person_phone|| '',
      cylinder_limit:      c.cylinder_limit > 0 ? c.cylinder_limit : '',
    });
    setShowTaxSection(!!(c.company_name || c.tax_id || c.person_type === 'นิติบุคคล'));
    setShowContactForm(true);
  }

  async function saveContact() {
    if (!contactForm.name) { showToast('กรุณากรอกชื่อ'); return; }
    setContactSaving(true);
    try {
      const body = editContact
        ? { shopId, contact_id: editContact.contact_id, ...contactForm }
        : { shopId, ...contactForm };
      const r = await fetch('/api/pos/contacts', {
        method: editContact ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (d.ok) {
        setShowContactForm(false);
        setEditContact(null);
        await fetchContacts();
        showToast(editContact ? 'แก้ไขผู้ติดต่อแล้ว' : 'เพิ่มผู้ติดต่อแล้ว');
      } else {
        alert(d.error);
      }
    } catch (err) {
      alert(err.message);
    }
    setContactSaving(false);
  }

  async function deleteContact(c) {
    if (!confirm(`ลบ "${c.name}" ?`)) return;
    await fetch('/api/pos/contacts', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shopId, contact_id: c.contact_id }),
    });
    await fetchContacts();
    showToast('ลบผู้ติดต่อแล้ว');
  }

  async function openDebtHistory(c) {
    setDebtHistoryCont(c);
    setDebtHistoryOrders([]);
    setDebtHistoryLoading(true);
    setShowDebtHistory(true);
    try {
      // ยอดค้างชำระของลูกค้ามาจาก 2 แหล่ง — ขายเชื่อหน้าร้าน (sales.js) และออเดอร์จัดส่งค้างจ่าย
      // (delivery.js) — เดิมดูแค่จัดส่งอย่างเดียว ทำให้ลูกค้าที่ค้างจากขายเชื่อหน้าร้านล้วนๆ
      // ไม่เห็นรายการเลยสักบิล ทั้งที่ยอดค้างชำระรวมแสดงถูกต้องอยู่แล้ว
      const [salesRes, deliveryRes] = await Promise.all([
        fetch(`/api/pos/sales?shopId=${shopId}&customerId=${c.contact_id}`),
        fetch(`/api/pos/delivery?shopId=${shopId}`),
      ]);
      const salesData = await salesRes.json();
      const deliveryData = await deliveryRes.json();
      const creditSales = (salesData.sales || [])
        .filter(s => s.payment_method === 'เชื่อ')
        .map(s => ({ order_no: s.bill_no, created_at: s.created_at, notes: s.notes, items: s.items, total: s.total, status: s.status, source: 'pos' }));
      const creditOrders = (deliveryData.orders || [])
        .filter(o => o.customer_id === c.contact_id && o.payment_method === 'ค้างจ่าย')
        .map(o => ({ order_no: o.order_no, created_at: o.created_at, notes: o.notes, items: o.items, total: o.total, status: o.credit_settled ? 'ชำระแล้ว' : 'ค้างชำระ', source: 'delivery' }));
      setDebtHistoryOrders([...creditSales, ...creditOrders].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)));
    } catch {}
    setDebtHistoryLoading(false);
  }

  // ── CSV / VCF import / export helpers ────────────────────────────────────
  function decodeQuotedPrintable(str, charset) {
    const bytes = [];
    for (let i = 0; i < str.length; i++) {
      if (str[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(str.substr(i + 1, 2))) {
        bytes.push(parseInt(str.substr(i + 1, 2), 16));
        i += 2;
      } else {
        bytes.push(str.charCodeAt(i));
      }
    }
    try {
      return new TextDecoder(charset || 'utf-8').decode(new Uint8Array(bytes));
    } catch (e) {
      return str;
    }
  }

  function parseVCFText(text) {
    const results = [];
    const cards = text.split(/BEGIN:VCARD/i).slice(1);
    for (const card of cards) {
      // unfold continued lines (RFC 6350: CRLF + SPACE)
      const unfolded = card.replace(/\r?\n[ \t]/g, '');
      const rawLines = unfolded.split(/\r?\n/);

      // vCard 2.1 quoted-printable values can also soft-break with a trailing '='
      // (separate from RFC 6350 folding above) — rejoin those before parsing.
      const lines = [];
      for (let i = 0; i < rawLines.length; i++) {
        let line = rawLines[i];
        const colonIdx0 = line.indexOf(':');
        const isQPLine = colonIdx0 !== -1 && /ENCODING=QUOTED-PRINTABLE/i.test(line.slice(0, colonIdx0));
        if (isQPLine) {
          while (line.endsWith('=') && i + 1 < rawLines.length) {
            line = line.slice(0, -1) + rawLines[++i];
          }
        }
        lines.push(line);
      }

      let name = '', phone = '', email = '', company_name = '', notes = '';
      for (const line of lines) {
        const upper = line.toUpperCase();
        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) continue;
        const params = line.slice(0, colonIdx);
        let val = line.slice(colonIdx + 1).trim();
        if (/ENCODING=QUOTED-PRINTABLE/i.test(params)) {
          const charsetMatch = params.match(/CHARSET=([^;:]+)/i);
          val = decodeQuotedPrintable(val, charsetMatch ? charsetMatch[1] : 'utf-8');
        }
        if (upper.startsWith('FN:') || upper.startsWith('FN;')) {
          name = val;
        } else if (!name && (upper.startsWith('N:') || upper.startsWith('N;'))) {
          const parts = val.split(';');
          const last = (parts[0] || '').trim();
          const first = (parts[1] || '').trim();
          name = [first, last].filter(Boolean).join(' ');
        } else if (upper.match(/^TEL[;:]/) && !phone) {
          phone = val.replace(/[^\d+\-() ]/g, '').trim();
        } else if (upper.match(/^EMAIL[;:]/) && !email) {
          email = val;
        } else if (upper.match(/^ORG[;:]/) && !company_name) {
          company_name = val.split(';')[0].trim();
        } else if (upper.match(/^NOTE[;:]/) && !notes) {
          notes = val;
        }
      }
      if (name || phone) results.push({ name, phone, email, company_name, notes });
    }
    return results;
  }

  function parseCSVLine(line) {
    const result = [];
    let cur = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuote = !inQuote; }
      else if (ch === ',' && !inQuote) { result.push(cur.trim()); cur = ''; }
      else { cur += ch; }
    }
    result.push(cur.trim());
    return result;
  }

  function parseCSVText(text) {
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
    if (lines.length < 2) return { headers: [], rows: [] };
    const headers = parseCSVLine(lines[0]).map(h => h.replace(/^"|"$/g, ''));
    const rows = lines.slice(1).map(line => {
      const vals = parseCSVLine(line).map(v => v.replace(/^"|"$/g, ''));
      return headers.reduce((obj, h, i) => { obj[h] = (vals[i] || '').trim(); return obj; }, {});
    });
    return { headers, rows: rows.filter(r => Object.values(r).some(v => v)) };
  }

  function autoDetectMapping(headers) {
    const m = { name: '', phone: '', email: '', company_name: '', notes: '' };
    headers.forEach(h => {
      const hl = h.toLowerCase();
      if (!m.name         && (hl === 'name' || hl === 'ชื่อ' || hl.includes('full name') || hl.includes('display name') || hl.includes('first name'))) m.name = h;
      if (!m.phone        && (hl.includes('phone') || hl.includes('mobile') || hl.includes('เบอร์') || hl.includes('โทร') || hl.includes('tel')))        m.phone = h;
      if (!m.email        && (hl.includes('email') || hl.includes('e-mail') || hl.includes('อีเมล')))                                                      m.email = h;
      if (!m.company_name && (hl.includes('company') || hl.includes('organization') || hl.includes('บริษัท') || hl.includes('organisation')))              m.company_name = h;
      if (!m.notes        && (hl.includes('note') || hl.includes('หมายเหตุ') || hl.includes('remark') || hl.includes('description')))                      m.notes = h;
    });
    return m;
  }

  function handleImportFile(file) {
    const isVcf = file.name.toLowerCase().endsWith('.vcf') || file.type === 'text/vcard' || file.type === 'text/x-vcard';
    const reader = new FileReader();
    reader.onload = e => {
      if (isVcf) {
        const contacts = parseVCFText(e.target.result);
        setIsVcfMode(true);
        setImportHeaders(['name', 'phone', 'email', 'company_name', 'notes']);
        setImportRows(contacts);
        setImportMapping({ name: 'name', phone: 'phone', email: 'email', company_name: 'company_name', notes: 'notes' });
      } else {
        const { headers, rows } = parseCSVText(e.target.result);
        setIsVcfMode(false);
        setImportHeaders(headers);
        setImportRows(rows);
        setImportMapping(autoDetectMapping(headers));
      }
    };
    reader.readAsText(file, 'UTF-8');
  }

  async function runImport() {
    const validRows = importRows.filter(r => importMapping.name && r[importMapping.name]?.trim());
    if (!validRows.length) return;
    // build set of existing phones for duplicate detection
    const existingPhones = new Set(
      contacts.map(c => (c.phone || '').replace(/\D/g, '')).filter(Boolean)
    );
    setImportLoading(true);

    const seenPhones = new Set();
    const toImport = [];
    let skipped = 0;
    for (const row of validRows) {
      const rawPhone = (importMapping.phone ? row[importMapping.phone] : '') || '';
      const normPhone = rawPhone.replace(/\D/g, '');
      if (normPhone && (existingPhones.has(normPhone) || seenPhones.has(normPhone))) {
        skipped++;
        continue;
      }
      if (normPhone) seenPhones.add(normPhone);
      toImport.push({
        name:         row[importMapping.name]                                        || '',
        contact_type: importDefaultType,
        phone:        rawPhone,
        email:        (importMapping.email        ? row[importMapping.email]        : '') || '',
        company_name: (importMapping.company_name ? row[importMapping.company_name] : '') || '',
        notes:        (importMapping.notes        ? row[importMapping.notes]        : '') || '',
      });
    }

    // ยิงเป็น chunk (ไม่ใช่ทีละคนแบบเดิม) — กันคำขอเดียวใหญ่/นานเกินไป พร้อมให้เห็น progress
    // และสำคัญที่สุดคือ "เช็คผลลัพธ์จริง" ทุกก้อน ไม่ใช่ถือว่าสำเร็จเสมอเหมือนโค้ดเดิม
    const CHUNK = 300;
    let imported = 0, failed = 0;
    setImportProgress({ done: 0, total: toImport.length, skipped });
    for (let i = 0; i < toImport.length; i += CHUNK) {
      const chunk = toImport.slice(i, i + CHUNK);
      try {
        const r = await fetch('/api/pos/contacts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ shopId, contacts: chunk }),
        });
        const d = await r.json();
        if (d.ok) imported += d.imported ?? chunk.length;
        else failed += chunk.length;
      } catch (_) {
        failed += chunk.length;
      }
      setImportProgress({ done: Math.min(i + CHUNK, toImport.length), total: toImport.length, skipped });
    }

    setImportLoading(false);
    setImportProgress(null);
    setShowImportModal(false);
    setImportRows([]);
    setImportHeaders([]);
    await fetchContacts(shopId);
    if (failed > 0) {
      showToast(`นำเข้าสำเร็จ ${imported} รายการ — ล้มเหลว ${failed} รายการ (ลองนำเข้าไฟล์เดิมซ้ำได้ ระบบจะข้ามเบอร์ที่มีอยู่แล้ว)`);
    } else {
      showToast(skipped > 0 ? `นำเข้า ${imported} รายการ (ข้าม ${skipped} ซ้ำ)` : `นำเข้า ${imported} ผู้ติดต่อแล้ว`);
    }
  }

  function closeImportModal() {
    if (importLoading) return;
    setShowImportModal(false);
    setImportRows([]);
    setImportHeaders([]);
    setImportProgress(null);
    setIsVcfMode(false);
  }

  // ── Report helpers ────────────────────────────────────────────────────────
  async function fetchReport(type = reportType, dateFrom = reportDateFrom, dateTo = reportDateTo, branch = reportBranch, statusF = reportStatusFilter) {
    if (!shopId) return;
    setReportLoading(true);
    setReportData(null);
    try {
      // ราคาผิดปกติ/ทุจริตจัดซื้อ — คนละ endpoint จาก /api/pos/reports (คนละตารางข้อมูล)
      if (type === 'fraud') {
        const params = new URLSearchParams({ shopId });
        if (statusF && statusF !== 'ทั้งหมด') params.set('status', statusF);
        const r = await fetch(`/api/pos/procurement-alerts?${params}`);
        const d = await r.json();
        setReportData({ type: 'fraud', alerts: d.alerts || [], notSetup: d.notSetup });
        setReportLoading(false);
        return;
      }
      const params = new URLSearchParams({ shopId, type, dateFrom, dateTo });
      if (branch) params.set('branch', branch);
      if (statusF && statusF !== 'ทั้งหมด') params.set('status', statusF);
      const r = await fetch(`/api/pos/reports?${params}`);
      const d = await r.json();
      if (d.error) showToast('❌ ' + d.error);
      else setReportData(d);
    } catch (e) { showToast('❌ ' + e.message); }
    setReportLoading(false);
  }

  async function updateProcurementAlertStatus(id, status) {
    try {
      const r = await fetch('/api/pos/procurement-alerts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId, id, status }),
      });
      const d = await r.json();
      if (d.ok) { showToast('อัปเดตสถานะแล้ว'); fetchReport('fraud'); } else alert(d.error);
    } catch (err) { alert(err.message); }
  }

  // source: 'pos' (ขายเชื่อหน้าร้าน) หรือ 'delivery' (ออเดอร์จัดส่งค้างจ่าย) — คนละ endpoint กัน
  async function markCreditPaid(billNo, source = 'pos') {
    if (!confirm(`ยืนยันรับชำระบิล ${billNo}?`)) return;
    try {
      const r = source === 'delivery'
        ? await fetch('/api/pos/delivery', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ shopId, order_no: billNo, credit_settled: true }),
          })
        : await fetch('/api/pos/sales', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ shopId, bill_no: billNo }),
          });
      const d = await r.json();
      if (d.ok) { showToast('✅ บันทึกรับชำระแล้ว'); fetchReport(); }
      else showToast('❌ ' + d.error);
    } catch (e) { showToast('❌ ' + e.message); }
  }

  async function returnLoan(loanNo) {
    if (!confirm(`ยืนยันการคืนสินค้า ${loanNo}?`)) return;
    try {
      const r = await fetch('/api/pos/loans', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId, loan_no: loanNo }),
      });
      const d = await r.json();
      if (d.ok) { showToast('✅ บันทึกคืนสินค้าแล้ว'); fetchReport(); }
      else showToast('❌ ' + d.error);
    } catch (e) { showToast('❌ ' + e.message); }
  }

  async function saveLoan() {
    if (!loanForm.contact_name) { showToast('กรุณาเลือกผู้ยืม'); return; }
    if (!loanForm.items.length) { showToast('กรุณาเลือกสินค้า'); return; }
    setLoanSaving(true);
    try {
      const r = await fetch('/api/pos/loans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId, ...loanForm, branch: selectedBranch?.branch_name || '' }),
      });
      const d = await r.json();
      if (d.ok) {
        showToast('✅ บันทึกใบยืม ' + d.loanNo);
        setShowLoanForm(false);
        setLoanForm({ contact_id: '', contact_name: '', contact_phone: '', items: [], due_date: '', notes: '', deduct_stock: true });
        if (reportType === 'loans') fetchReport();
      } else showToast('❌ ' + d.error);
    } catch (e) { showToast('❌ ' + e.message); }
    setLoanSaving(false);
  }

  async function runExport() {
    setExportLoading(true);
    try {
      const params = new URLSearchParams({
        shopId,
        dateFrom: reportDateFrom,
        dateTo: reportDateTo,
        types: exportTypes.join(','),
      });
      if (reportBranch) params.set('branch', reportBranch);
      const r = await fetch(`/api/pos/export?${params}`);
      if (!r.ok) { const d = await r.json(); showToast('❌ ' + d.error); setExportLoading(false); return; }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const cd = r.headers.get('Content-Disposition') || '';
      const match = cd.match(/filename\*?=(?:UTF-8'')?(.+)/i);
      a.download = match ? decodeURIComponent(match[1]) : 'report.xlsx';
      a.click();
      URL.revokeObjectURL(url);
      setShowExportModal(false);
    } catch (e) { showToast('❌ ' + e.message); }
    setExportLoading(false);
  }

  function downloadTemplateCsv() {
    const csv = '﻿' +
      'ชื่อ,เบอร์โทร,อีเมล,ชื่อบริษัท,หมายเหตุ\n' +
      '"สมชาย ใจดี","0812345678","somchai@email.com","บริษัท ABC จำกัด","ลูกค้าประจำ"\n' +
      '"สุมาลี วงษ์ศรี","0898765432","","","ผู้จำหน่ายน้ำมัน"';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'contacts_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportContactsCsv() {
    if (!contacts.length) { showToast('ยังไม่มีผู้ติดต่อ'); return; }
    const headers = ['ชื่อ', 'ประเภท', 'เบอร์โทร', 'อีเมล', 'ชื่อร้านค้า', 'ชื่อบริษัท', 'เลขภาษี', 'ที่อยู่หลัก', 'หมายเหตุ'];
    const rows = contacts.map(c =>
      [c.name, c.contact_type, c.phone, c.email, c.shop_name, c.company_name, c.tax_id, c.address_1, c.notes]
        .map(v => `"${(v || '').toString().replace(/"/g, '""')}"`)
        .join(',')
    );
    const csv = '﻿' + headers.join(',') + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `contacts_${new Date().toLocaleDateString('en-CA')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── setup ─────────────────────────────────────────────────────────────────
  async function handleSetup() {
    if (!shopId) return;
    setConfigLoading(true);
    try {
      const r = await fetch('/api/pos/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId }),
      });
      const d = await r.json();
      if (d.ok) {
        setConfigured(true);
        await Promise.all([fetchProducts(), fetchContacts()]);
      } else {
        alert(d.error || 'เกิดข้อผิดพลาด');
      }
    } catch (err) {
      alert(err.message);
    }
    setConfigLoading(false);
  }

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  }

  // ── โหมดแคชเชียร์: บังคับใส่ PIN ก่อนเสมอ ไม่มีทางเห็นเนื้อหาอื่นได้เลยจนกว่าจะผ่าน ──
  // (ต่างจากลิงก์ /pos?userId=... ของเจ้าของร้านที่ไม่มีการยืนยันตัวตนเพิ่มเติมเลย)
  if (cashierMode && !cashierShopId) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
        <div className="text-gray-400 text-sm text-center">
          <div className="text-4xl mb-3">🔒</div>
          ลิงก์ไม่ถูกต้อง — ไม่พบรหัสร้าน<br />
          <span className="text-xs">ขอลิงก์แคชเชียร์ใหม่จากเจ้าของร้าน/แอดมิน</span>
        </div>
      </div>
    );
  }
  if (cashierMode && !cashierSessionChecked) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-400 text-sm animate-pulse">กำลังโหลด...</div>
      </div>
    );
  }
  if (cashierMode && !cashierSession) {
    return (
      <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-4">
        <Head><title>เข้าสู่ระบบแคชเชียร์ · Smile Slip POS</title></Head>
        <div className="text-4xl mb-4">🔐</div>
        <h2 className="text-white font-bold text-xl mb-2">ใส่ PIN แคชเชียร์</h2>
        <p className="text-gray-400 text-sm mb-8">กรอก PIN ส่วนตัวของคุณเพื่อเข้าระบบขายหน้าร้าน</p>

        <div className="w-full max-w-xs">
          <input type="password" inputMode="numeric" maxLength={4} value={cashierPin}
            onChange={e => setCashierPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
            onKeyDown={e => { if (e.key === 'Enter') verifyCashierPin(); }}
            placeholder="••••"
            className="w-full bg-gray-900 border border-gray-700 text-white text-center text-3xl tracking-[0.5em] px-4 py-4 rounded-2xl mb-4 focus:outline-none focus:border-green-500" />

          {cashierPinError && <div className="text-red-400 text-sm text-center mb-4">{cashierPinError}</div>}

          <button onClick={verifyCashierPin} disabled={cashierPin.length !== 4 || cashierPinLoading}
            className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-bold py-4 rounded-2xl text-lg transition-colors">
            {cashierPinLoading ? 'กำลังตรวจสอบ...' : 'เข้าสู่ระบบ'}
          </button>
        </div>
      </div>
    );
  }

  // ── loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-400 text-sm animate-pulse">กำลังโหลด...</div>
      </div>
    );
  }

  // ── setup screen ──────────────────────────────────────────────────────────
  if (!configured) {
    return (
      <>
        <Head><title>ระบบขายหน้าร้าน — Smile Slip Pro</title></Head>
        <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
          <div className="bg-gray-900 rounded-2xl p-8 max-w-md w-full text-center">
            <div className="text-5xl mb-4">🛒</div>
            <h1 className="text-white text-xl font-bold mb-2">ระบบขายหน้าร้าน</h1>
            <p className="text-gray-400 text-sm mb-6">
              จัดการสต็อคสินค้า บันทึกยอดขาย และดูรายงานได้จากที่นี่
            </p>
            {!googleConnected ? (
              <div className="bg-yellow-900/30 border border-yellow-700 rounded-xl p-4 mb-4 text-left">
                <p className="text-yellow-300 text-sm font-medium mb-1">⚠️ ต้องเชื่อมต่อ Google Drive ก่อน</p>
                <p className="text-yellow-400 text-xs">ไปที่ Dashboard → Settings → เชื่อมต่อ Google Drive</p>
              </div>
            ) : (
              <button
                onClick={handleSetup}
                disabled={configLoading}
                className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-colors"
              >
                {configLoading ? 'กำลังตั้งค่า...' : '🚀 เปิดใช้งานระบบ POS'}
              </button>
            )}
            {!cashierMode && (
              <a href={`/dashboard?userId=${userId}`} className="block mt-4 text-gray-500 text-sm hover:text-gray-300 transition-colors">
                ← กลับ Dashboard
              </a>
            )}
          </div>
        </div>
      </>
    );
  }

  // ── trial expired lock screen (30-Day Free Trial Lock Mechanism) ──────────
  // ข้อมูลของร้านยังอยู่ครบใน Google Sheets/Drive เสมอ — หน้านี้แค่บล็อกการใช้งานต่อ
  // (ฝั่ง API ก็บล็อกการเขียนซ้ำอีกชั้นแล้วผ่าน lib/shop-access.js กันคนข้าม UI ยิง API ตรง)
  if (shopInfo?.status === 'trial_expired') {
    return (
      <>
        <Head><title>หมดระยะทดลองใช้ — Smile Slip Pro</title></Head>
        <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
          <div className="bg-gray-900 rounded-2xl p-8 max-w-md w-full text-center">
            <div className="text-5xl mb-4">⏰</div>
            <h1 className="text-white text-xl font-bold mb-2">หมดระยะเวลาทดลองใช้ฟรี 30 วันแล้ว</h1>
            <p className="text-gray-400 text-sm mb-6">
              อัปเกรดแพ็กเกจเพื่อใช้งานระบบขายหน้าร้านต่อได้ทันที<br/>
              ข้อมูลเดิมของร้านยังอยู่ครบใน Google Sheets/Drive ไม่มีการสูญหายแต่อย่างใด
            </p>
            {!cashierMode && (
              <a href={`/pricing?userId=${userId}`}
                className="block w-full bg-green-600 hover:bg-green-500 text-white font-bold py-3 rounded-xl transition-colors">
                🚀 อัปเกรดแพ็กเกจ
              </a>
            )}
            {!cashierMode && (
              <a href={`/dashboard?userId=${userId}`} className="block mt-4 text-gray-500 text-sm hover:text-gray-300 transition-colors">
                ← กลับ Dashboard
              </a>
            )}
            {cashierMode && (
              <p className="text-gray-500 text-sm mt-4">แจ้งเจ้าของร้าน/แอดมินให้อัปเกรดแพ็กเกจก่อนใช้งานต่อ</p>
            )}
          </div>
        </div>
      </>
    );
  }

  // ── branch selection screen ───────────────────────────────────────────────
  if (showBranchSelect) {
    return (
      <>
        <Head><title>เลือกสาขา — POS</title></Head>
        <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
          <div className="bg-gray-900 rounded-2xl p-8 max-w-md w-full">
            <div className="text-center mb-6">
              <div className="text-4xl mb-3">🏪</div>
              <h2 className="text-white text-lg font-bold">เลือกสาขา</h2>
              <p className="text-gray-400 text-sm mt-1">เลือกสาขาที่คุณกำลังทำงานอยู่</p>
            </div>
            <div className="space-y-2">
              {posBranches.map(b => (
                <button key={b.id}
                  onClick={() => {
                    setSelectedBranch(b);
                    setShowBranchSelect(false);
                    try { localStorage.setItem(`pos_branch_${shopId}`, JSON.stringify(b)); } catch {}
                  }}
                  className="w-full bg-gray-800 hover:bg-green-800 border border-gray-700 hover:border-green-600 text-white text-sm font-medium py-3.5 px-5 rounded-xl transition-colors text-left flex items-center gap-3">
                  <span className="text-xl">🏪</span>
                  <div>
                    <div className="font-semibold">{b.branch_name}</div>
                    {b.brand_name && <div className="text-gray-400 text-xs">{b.brand_name}</div>}
                  </div>
                </button>
              ))}
            </div>
            {!cashierMode && (
              <a href={`/dashboard?userId=${userId}`} className="block mt-5 text-center text-gray-500 text-sm hover:text-gray-300 transition-colors">
                ← กลับ Dashboard
              </a>
            )}
          </div>
        </div>
      </>
    );
  }

  // ── main UI ───────────────────────────────────────────────────────────────
  return (
    <>
      <Head><title>POS ขายหน้าร้าน — {shopInfo?.shop_name || 'Smile Slip Pro'}</title></Head>

      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-gray-800 text-white text-sm px-5 py-2.5 rounded-full shadow-lg max-w-xs text-center">
          {toast}
        </div>
      )}

      <div className="min-h-screen bg-gray-950 flex flex-col">
        {/* Header */}
        <header className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🛒</span>
            <div>
              <div className="text-white font-bold text-sm">{shopInfo?.shop_name || 'ร้านค้า'}</div>
              <div className="text-gray-400 text-xs flex items-center gap-1.5">
                ระบบขายหน้าร้าน
                {selectedBranch && (
                  <span className="text-green-400">
                    · {selectedBranch.branch_name}
                    {posBranches.length > 1 && (
                      <button onClick={() => setShowBranchSelect(true)}
                        className="ml-1 text-gray-500 hover:text-green-400 transition-colors text-[10px] underline">
                        เปลี่ยน
                      </button>
                    )}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {activeShift ? (
              <button onClick={openCloseShiftModal}
                className="flex items-center gap-1.5 bg-green-950 hover:bg-green-900 border border-green-700 text-green-300 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse"></span>
                {activeShift.staff_name} · ปิดกะ
              </button>
            ) : (
              <button onClick={openShiftModalStart}
                className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors">
                🔓 เปิดกะ
              </button>
            )}
            {cashierMode ? (
              <>
                {cashierSession?.staff?.name && (
                  <span className="text-gray-400 text-xs hidden sm:inline">👤 {cashierSession.staff.name}</span>
                )}
                <button onClick={cashierLogout}
                  className="text-gray-400 hover:text-white text-xs px-3 py-1.5 rounded-lg border border-gray-700 hover:border-red-500 transition-colors">
                  ออกจากระบบ
                </button>
              </>
            ) : (
              <a href={`/dashboard?userId=${userId}`} className="text-gray-400 hover:text-white text-xs px-3 py-1.5 rounded-lg border border-gray-700 hover:border-gray-500 transition-colors">
                ← Dashboard
              </a>
            )}
          </div>
        </header>

        {/* Tab nav — แท็บที่ใช้บ่อยที่สุดอยู่บนแถบหลัก ที่เหลือซ่อนใน "เพิ่มเติม" กันแถบแน่นเกินไปบนมือถือ */}
        {(() => {
          const primaryTabs = [
            { key: 'sell',     label: '💰 ขาย' },
            { key: 'orders',   label: '🚚 ออเดอร์' },
            { key: 'contacts', label: '👥 ผู้ติดต่อ' },
            { key: 'products', label: '📦 สินค้า' },
          ];
          const moreTabs = [
            ...(hasFeature(shopInfo?.subscription_tier, 'credit_ar') ? [{ key: 'collections', label: '🧾 เก็บเงิน/ของ' }] : []),
            { key: 'receive',  label: '📥 รับสินค้า' },
            { key: 'expenses', label: '🧾 รายจ่าย' },
            { key: 'report',   label: '📊 รายงาน' },
            // ตั้งค่าร้าน (พร้อมเพย์/API ธนาคาร/จัดการพนักงาน) — เจ้าของ/แอดมินเท่านั้น ไม่โชว์
            // ในโหมดแคชเชียร์เลย (ฝั่ง API เองก็บล็อก session พนักงานทุกคนจาก pos-config.js อยู่แล้ว)
            ...(cashierMode ? [] : [{ key: 'settings', label: '⚙️ ตั้งค่า' }]),
          ];
          const isMoreActive = moreTabs.some(t => t.key === tab);
          return (
            <nav className="bg-gray-900 border-b border-gray-800 flex shrink-0 overflow-x-auto">
              {primaryTabs.map(t => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`shrink-0 flex-1 py-3 text-xs font-medium transition-colors border-b-2 min-w-0 ${
                    tab === t.key
                      ? 'text-green-400 border-green-400'
                      : 'text-gray-400 border-transparent hover:text-gray-200'
                  }`}
                >
                  {t.label}
                </button>
              ))}
              <button
                onClick={() => setShowMoreMenu(true)}
                className={`shrink-0 flex-1 py-3 text-xs font-medium transition-colors border-b-2 min-w-0 ${
                  isMoreActive
                    ? 'text-green-400 border-green-400'
                    : 'text-gray-400 border-transparent hover:text-gray-200'
                }`}
              >
                {isMoreActive ? moreTabs.find(t => t.key === tab)?.label : '⋯ เพิ่มเติม'}
              </button>
            </nav>
          );
        })()}

        {/* แผงเลือกแท็บรอง — เปิดจากปุ่ม "เพิ่มเติม" */}
        {showMoreMenu && (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center" onClick={() => setShowMoreMenu(false)}>
            <div className="bg-gray-900 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm border-t sm:border border-gray-700 max-h-[70vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="p-4 border-b border-gray-800 flex items-center justify-between">
                <h3 className="text-white font-bold text-sm">เมนูเพิ่มเติม</h3>
                <button onClick={() => setShowMoreMenu(false)} className="text-gray-400 hover:text-white text-xl leading-none">✕</button>
              </div>
              <div className="p-2">
                {[
                  ...(hasFeature(shopInfo?.subscription_tier, 'credit_ar') ? [{ key: 'collections', label: '🧾 เก็บเงิน/ของ' }] : []),
                  { key: 'receive',  label: '📥 รับสินค้า' },
                  { key: 'expenses', label: '🧾 รายจ่าย' },
                  { key: 'report',   label: '📊 รายงาน' },
                  ...(cashierMode ? [] : [{ key: 'settings', label: '⚙️ ตั้งค่า' }]),
                ].map(t => (
                  <button key={t.key}
                    onClick={() => { setTab(t.key); setShowMoreMenu(false); }}
                    className={`w-full text-left px-4 py-3 rounded-xl text-sm font-medium transition-colors ${
                      tab === t.key ? 'bg-green-900/40 text-green-400' : 'text-gray-300 hover:bg-gray-800'
                    }`}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-hidden">

          {/* ══ TAB: ขายสินค้า ══════════════════════════════════════════════ */}
          {tab === 'sell' && (
            <div className="h-full flex flex-col lg:flex-row">
              <div className="flex-1 flex flex-col overflow-hidden">

                {/* ── Bills bar (multi-table) ──────────────────────────── */}
                <div className="shrink-0 bg-gray-900 border-b border-gray-800 px-3 py-2 flex items-center gap-2 overflow-x-auto scrollbar-hide">
                  {openBills.length > 3 && (
                    <button
                      onClick={() => setShowBillsSidebar(true)}
                      title="ค้นหา/ดูบิลทั้งหมด"
                      className="shrink-0 flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold text-blue-300 hover:text-white hover:bg-blue-900/50 border border-blue-800 transition-colors"
                    >
                      🔍 ทั้งหมด ({openBills.length})
                    </button>
                  )}
                  {openBills.map(bill => {
                    const isActive = bill.id === activeBillId;
                    const itemCount = (bill.items || []).reduce((s, i) => s + i.qty, 0);
                    const billTotal = (bill.items || []).reduce((s, i) => s + i.price * i.qty, 0);
                    return (
                      <div
                        key={bill.id}
                        onClick={() => switchBill(bill.id)}
                        className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs shrink-0 cursor-pointer transition-all border ${
                          isActive
                            ? 'bg-green-600 border-green-500 text-white'
                            : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
                        }`}
                      >
                        <span className="font-bold truncate max-w-[80px]">{bill.name}</span>
                        {itemCount > 0 && (
                          <span className={`text-xs font-medium ${isActive ? 'text-green-200' : 'text-gray-400'}`}>
                            ฿{billTotal.toLocaleString()}
                          </span>
                        )}
                        <button
                          onClick={(e) => closeBill(bill.id, e)}
                          className={`text-xs shrink-0 hover:text-red-400 transition-colors ${isActive ? 'text-green-300' : 'text-gray-600'}`}
                        >✕</button>
                      </div>
                    );
                  })}
                  <button
                    onClick={() => setShowNewBillModal(true)}
                    className="shrink-0 flex items-center gap-1 px-3 py-2 rounded-xl text-xs text-gray-400 hover:text-white hover:bg-gray-800 border border-dashed border-gray-700 transition-colors"
                  >
                    <span className="text-base leading-none">＋</span>
                    <span>บิลใหม่</span>
                  </button>
                </div>

                {/* ── แผงขยายรายการบิลที่เปิดค้างอยู่ทั้งหมด + ค้นหา (สำหรับตอนมีบิลเยอะหาไม่เจอ) ── */}
                {showBillsSidebar && (
                  <div className="fixed inset-0 z-[70] bg-black/60 flex justify-end" onClick={() => setShowBillsSidebar(false)}>
                    <div className="bg-gray-900 w-full max-w-xs h-full flex flex-col border-l border-gray-800" onClick={e => e.stopPropagation()}>
                      <div className="p-4 border-b border-gray-800 flex items-center justify-between shrink-0">
                        <h3 className="text-white font-bold">🪑 บิลที่เปิดอยู่ ({openBills.length})</h3>
                        <button onClick={() => setShowBillsSidebar(false)} className="text-gray-400 hover:text-white text-2xl leading-none">×</button>
                      </div>
                      <div className="p-3 border-b border-gray-800 shrink-0">
                        <input autoFocus value={billsSidebarQ} onChange={e => setBillsSidebarQ(e.target.value)}
                          placeholder="ค้นหาชื่อบิล/ชื่อลูกค้า..."
                          className="w-full bg-gray-800 text-white text-sm px-4 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500" />
                      </div>
                      <div className="flex-1 overflow-y-auto p-3 space-y-2">
                        {openBills
                          .filter(b => {
                            const q = billsSidebarQ.trim().toLowerCase();
                            if (!q) return true;
                            return (b.name || '').toLowerCase().includes(q) || (b.customer_name || '').toLowerCase().includes(q);
                          })
                          .map(bill => {
                            const isActive = bill.id === activeBillId;
                            const itemCount = (bill.items || []).reduce((s, i) => s + i.qty, 0);
                            const billTotal = (bill.items || []).reduce((s, i) => s + i.price * i.qty, 0);
                            return (
                              <div key={bill.id}
                                onClick={() => { switchBill(bill.id); setShowBillsSidebar(false); setBillsSidebarQ(''); }}
                                className={`p-3 rounded-xl cursor-pointer border transition-colors flex items-center justify-between gap-2 ${
                                  isActive ? 'bg-green-600 border-green-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
                                }`}>
                                <div className="min-w-0">
                                  <div className="font-bold text-sm truncate">{bill.name}</div>
                                  {bill.customer_name && <div className="text-xs opacity-70 truncate">{bill.customer_name}</div>}
                                  <div className="text-xs opacity-70">{itemCount} รายการ</div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <span className="font-bold text-sm">฿{billTotal.toLocaleString()}</span>
                                  <button onClick={(e) => closeBill(bill.id, e)} className="hover:text-red-400 transition-colors">✕</button>
                                </div>
                              </div>
                            );
                          })}
                        {openBills.filter(b => {
                          const q = billsSidebarQ.trim().toLowerCase();
                          if (!q) return true;
                          return (b.name || '').toLowerCase().includes(q) || (b.customer_name || '').toLowerCase().includes(q);
                        }).length === 0 && (
                          <div className="text-center text-gray-500 text-sm py-8">ไม่พบบิลที่ตรงกับคำค้นหา</div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* ── ถ้าไม่มีบิลเปิด: empty state ──────────────────── */}
                {!activeBillId && (
                  <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
                    <div className="text-6xl mb-4">🪑</div>
                    <div className="text-white font-bold text-lg mb-2">ยังไม่มีบิลเปิด</div>
                    <div className="text-gray-400 text-sm mb-6">กดปุ่มด้านล่างเพื่อเปิดโต๊ะหรือบิลใหม่</div>
                    <button
                      onClick={() => setShowNewBillModal(true)}
                      className="bg-green-600 hover:bg-green-500 text-white font-bold px-8 py-3 rounded-2xl text-base transition-colors"
                    >
                      ＋ เปิดบิลใหม่
                    </button>
                    {tableNames.length > 0 && (
                      <div className="mt-6">
                        <div className="text-gray-500 text-xs mb-3">หรือกดเปิดโต๊ะที่ตั้งค่าไว้</div>
                        <div className="flex flex-wrap gap-2 justify-center max-w-sm">
                          {tableNames.map(name => (
                            <button key={name} onClick={() => createBill(name)}
                              className="bg-gray-800 hover:bg-gray-700 text-gray-200 text-sm px-4 py-2 rounded-xl border border-gray-700 transition-colors">
                              {name}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* ── Product area (แสดงเฉพาะเมื่อมีบิลเปิด) ──────────── */}
                {activeBillId && (
                <>

                <div className="p-3 bg-gray-900 space-y-2 shrink-0">
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="🔍 ค้นหาสินค้า..."
                    className="w-full bg-gray-800 text-white text-sm px-4 py-2 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500"
                  />
                  <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                    {categories.map(cat => (
                      <button key={cat} onClick={() => setSelectedCat(cat)}
                        className={`shrink-0 text-xs px-3 py-1.5 rounded-full transition-colors ${
                          selectedCat === cat ? 'bg-green-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                        }`}
                      >{cat}</button>
                    ))}
                  </div>
                </div>

                {/* padding ล่างบน mobile เผื่อแถบตะกร้าลอยอยู่ */}
                <div className={`flex-1 overflow-y-auto p-3 ${cart.length > 0 ? 'pb-24 lg:pb-3' : ''}`}>
                  {productsLoading ? (
                    <div className="text-center text-gray-500 py-12 text-sm animate-pulse">กำลังโหลดสินค้า...</div>
                  ) : displayProducts.length === 0 ? (
                    <div className="text-center text-gray-500 py-12">
                      <div className="text-4xl mb-3">📦</div>
                      <p className="text-sm">ไม่พบสินค้า</p>
                      <button onClick={() => setTab('products')} className="mt-3 text-green-400 text-xs underline">เพิ่มสินค้าใหม่</button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2">
                      {displayProducts.map(prod => {
                        const inCart = cart.find(i => i.sku === prod.sku);
                        const outOfStock = prod.type !== 'ไม่นับสต็อค' && prod.stock <= 0;
                        return (
                          <button key={prod.sku} onClick={() => addToCart(prod)} disabled={outOfStock}
                            className={`relative rounded-xl p-3 text-left transition-all border ${
                              outOfStock
                                ? 'bg-gray-900 border-gray-800 opacity-50 cursor-not-allowed'
                                : inCart
                                ? 'bg-green-900/40 border-green-600 hover:bg-green-900/60'
                                : 'bg-gray-800 border-gray-700 hover:bg-gray-700 hover:border-gray-500 active:scale-95'
                            }`}
                          >
                            {inCart && (
                              <span className="absolute top-2 right-2 bg-green-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center font-bold">
                                {inCart.qty}
                              </span>
                            )}
                            <div className="text-2xl mb-1">
                              {prod.type === 'ไม่นับสต็อค' ? '🛠️' : prod.category === 'เครื่องดื่ม' ? '🥤' : prod.category === 'อาหาร' ? '🍱' : prod.category === 'ของใช้' ? '🧴' : '📦'}
                            </div>
                            <div className="text-white text-xs font-medium leading-snug line-clamp-2">{prod.name}</div>
                            <div className="text-green-400 text-sm font-bold mt-1">฿{prod.price.toLocaleString()}</div>
                            {prod.type === 'ไม่นับสต็อค' ? (
                              <div className="text-xs mt-0.5 text-blue-400">บริการ</div>
                            ) : (
                              <div className={`text-xs mt-0.5 ${prod.stock <= 5 ? 'text-red-400' : 'text-gray-500'}`}>
                                คงเหลือ {prod.stock} {prod.unit}
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
              )}
              </div>

              {/* Cart — Desktop sidebar (lg+) */}
              <div className="hidden lg:flex lg:w-80 xl:w-96 bg-gray-900 border-l border-gray-800 flex-col">
                <div className="px-4 py-3 border-b border-gray-800 shrink-0 flex items-center justify-between">
                  <span className="text-white font-bold text-sm">🛒 ตะกร้า</span>
                  {cart.length > 0 && (
                    <button onClick={() => setCart([])} className="text-gray-500 hover:text-red-400 text-xs transition-colors">ล้างทั้งหมด ✕</button>
                  )}
                </div>
                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                  {cart.length === 0 ? (
                    <div className="text-center text-gray-600 py-8 text-sm">เลือกสินค้าเพื่อเพิ่มในตะกร้า</div>
                  ) : cart.map(item => (
                    <div key={item.sku} className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-white text-xs font-medium truncate">{item.name}</div>
                        <div className="text-green-400 text-xs">฿{(item.price * item.qty).toLocaleString()}</div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={() => updateQty(item.sku, item.qty - 1)} className="w-6 h-6 rounded-full bg-gray-700 hover:bg-red-700 text-white text-sm flex items-center justify-center transition-colors">−</button>
                        <span className="text-white text-xs w-6 text-center">{item.qty}</span>
                        <button onClick={() => updateQty(item.sku, item.qty + 1)} className="w-6 h-6 rounded-full bg-gray-700 hover:bg-green-700 text-white text-sm flex items-center justify-center transition-colors">+</button>
                      </div>
                    </div>
                  ))}
                </div>
                {cart.length > 0 && (
                  <div className="p-4 border-t border-gray-800 shrink-0 space-y-3">
                    <div className="flex justify-between text-gray-400 text-xs">
                      <span>รวม {cart.reduce((s, i) => s + i.qty, 0)} รายการ</span>
                      <span className="text-white font-bold text-base">฿{cartSubtotal.toLocaleString()}</span>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={openCheckout} className="flex-1 bg-green-600 hover:bg-green-500 active:bg-green-700 text-white font-bold py-3 rounded-xl transition-colors text-sm">
                        ชำระเงิน ฿{cartSubtotal.toLocaleString()}
                      </button>
                      <button onClick={openDelivery} className="w-14 bg-orange-600 hover:bg-orange-500 active:bg-orange-700 text-white font-bold py-3 rounded-xl transition-colors text-xl flex items-center justify-center" title="ส่งสินค้า">
                        🛵
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* ── Mobile floating cart bar (แสดงเมื่อมีสินค้าในตะกร้า) ── */}
              {cart.length > 0 && (
                <div className="lg:hidden fixed bottom-0 left-0 right-0 z-30 p-3 bg-gray-950/95 backdrop-blur border-t border-gray-800">
                  <button
                    onClick={() => setShowCartDrawer(true)}
                    className="w-full bg-green-600 hover:bg-green-500 active:bg-green-700 text-white font-bold py-3.5 rounded-2xl flex items-center justify-between px-5 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className="bg-white text-green-600 w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center">
                        {cart.reduce((s, i) => s + i.qty, 0)}
                      </span>
                      <span className="text-sm">ดูตะกร้า</span>
                    </div>
                    <span className="text-lg font-bold">฿{cartSubtotal.toLocaleString()}</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ══ TAB: สินค้า/สต็อค ══════════════════════════════════════════ */}
          {tab === 'products' && (
            <div className="h-full overflow-y-auto">
              <div className="p-4 max-w-4xl mx-auto">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-white font-bold">สินค้าทั้งหมด ({products.length})</h2>
                  <button onClick={openAddProd} className="bg-green-600 hover:bg-green-500 text-white text-sm font-bold px-4 py-2 rounded-xl transition-colors">
                    + เพิ่มสินค้า
                  </button>
                </div>

                <div className="flex gap-2 overflow-x-auto pb-2 mb-4 scrollbar-hide">
                  {categories.map(cat => (
                    <button key={cat} onClick={() => setSelectedCat(cat)}
                      className={`shrink-0 text-xs px-3 py-1.5 rounded-full transition-colors ${
                        selectedCat === cat ? 'bg-green-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                      }`}
                    >{cat}</button>
                  ))}
                </div>

                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="🔍 ค้นหาสินค้า..."
                  className="w-full bg-gray-800 text-white text-sm px-4 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500 mb-4"
                />

                {productsLoading ? (
                  <div className="text-center text-gray-500 py-12 animate-pulse">กำลังโหลด...</div>
                ) : displayProducts.length === 0 ? (
                  <div className="text-center py-16">
                    <div className="text-5xl mb-3">📦</div>
                    <p className="text-gray-400 text-sm mb-4">ยังไม่มีสินค้า</p>
                    <button onClick={openAddProd} className="bg-green-600 text-white text-sm font-bold px-6 py-2.5 rounded-xl hover:bg-green-500 transition-colors">
                      + เพิ่มสินค้าแรก
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {displayProducts.map(prod => (
                      <div key={prod.sku} className={`rounded-xl p-4 flex items-center gap-4 ${prod.is_active === false ? 'bg-gray-900 border border-gray-800 opacity-70' : 'bg-gray-800'}`}>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-white font-medium text-sm">{prod.name}</span>
                            {prod.category && <span className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded-full">{prod.category}</span>}
                            {prod.type === 'ไม่นับสต็อค' && <span className="text-xs bg-blue-900/50 text-blue-300 px-2 py-0.5 rounded-full">🛠️ บริการ</span>}
                            {prod.type === 'หมุนเวียน' && <span className="text-xs bg-purple-900/50 text-purple-300 px-2 py-0.5 rounded-full">🔄 หมุนเวียน</span>}
                            {prod.is_active === false && <span className="text-xs bg-red-900/50 text-red-400 px-2 py-0.5 rounded-full">inactive</span>}
                          </div>
                          <div className="flex items-center gap-3 mt-1 flex-wrap">
                            <span className="text-green-400 text-sm font-bold">฿{prod.price.toLocaleString()}</span>
                            {prod.cost > 0 && (
                              <span className="text-gray-500 text-xs">ทุนเฉลี่ย ฿{prod.cost.toLocaleString()}</span>
                            )}
                            {prod.type === 'หมุนเวียน' ? (
                              <>
                                <span className="text-xs bg-green-900/50 text-green-300 px-2 py-0.5 rounded-full">เต็ม {prod.stock}</span>
                                <span className="text-xs bg-orange-900/50 text-orange-300 px-2 py-0.5 rounded-full">กับลูกค้า {prod.at_customer || 0}</span>
                                <span className="text-xs bg-gray-700 text-gray-400 px-2 py-0.5 rounded-full">เปล่า {prod.empty_waiting || 0}</span>
                              </>
                            ) : prod.type === 'ไม่นับสต็อค' ? null : (
                              <span className={`text-xs font-medium ${prod.stock <= 0 ? 'text-red-400' : prod.stock <= 5 ? 'text-yellow-400' : 'text-gray-400'}`}>
                                สต็อค: {prod.stock} {prod.unit}
                              </span>
                            )}
                            {prod.vat_type && prod.vat_type !== 'ไม่มี VAT' && (
                              <span className="text-xs text-gray-500">{prod.vat_type}</span>
                            )}
                          </div>
                          {prod.product_code && <div className="text-gray-500 text-xs mt-0.5">รหัส: {prod.product_code}{prod.barcode ? ` · บาร์โค้ด: ${prod.barcode}` : ''}</div>}
                          {prod.description && <div className="text-gray-500 text-xs mt-0.5 line-clamp-1">{prod.description}</div>}
                          {prod.aliases && <div className="text-gray-600 text-xs mt-0.5">ค้นหาได้: {prod.aliases}</div>}
                        </div>
                        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                          {prod.type === 'หมุนเวียน' && (
                            <>
                              <button onClick={() => { setCyclicalProd(prod); setCyclicalQty(''); setShowCyclicalModal('receive-back'); }}
                                className="text-xs bg-gray-700 hover:bg-orange-700 text-gray-300 hover:text-white px-3 py-1.5 rounded-lg transition-colors">
                                รับคืน
                              </button>
                              <button onClick={() => { setCyclicalProd(prod); setCyclicalQty(''); setShowCyclicalModal('refill'); }}
                                className="text-xs bg-gray-700 hover:bg-blue-700 text-gray-300 hover:text-white px-3 py-1.5 rounded-lg transition-colors">
                                รีฟิล
                              </button>
                            </>
                          )}
                          <button onClick={() => openEditProd(prod)} className="text-xs bg-gray-700 hover:bg-blue-700 text-gray-300 hover:text-white px-3 py-1.5 rounded-lg transition-colors">แก้ไข</button>
                          <button onClick={() => deleteProd(prod)} className="text-xs bg-gray-700 hover:bg-red-700 text-gray-300 hover:text-white px-3 py-1.5 rounded-lg transition-colors">ลบ</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ══ TAB: รับสินค้า ════════════════════════════════════════════ */}
          {tab === 'receive' && (
            <div className="h-full overflow-y-auto">
              <div className="p-4 max-w-2xl mx-auto">

                {/* toggle form / pending / history */}
                <div className="flex gap-2 mb-4 flex-wrap">
                  {[
                    { key:'form', label:'📥 บันทึกรับสินค้า' },
                    { key:'pending', label: `🔔 รอยืนยันจาก LINE${pendingReceives.length ? ` (${pendingReceives.length})` : ''}` },
                    { key:'history', label:'📋 ประวัติ' },
                  ].map(v => (
                    <button key={v.key} onClick={() => setReceiveView(v.key)}
                      className={`px-4 py-2 rounded-xl text-xs font-medium transition-colors ${
                        receiveView === v.key ? 'bg-green-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                      }`}
                    >{v.label}</button>
                  ))}
                </div>

                {receiveView === 'form' ? (
                  <>
                    {/* ผู้จำหน่าย — เลือกจาก contact จริงเพื่อผูกประวัติราคาซื้อ หรือพิมพ์ชื่อใหม่เฉยๆ ก็ได้ */}
                    <div className="bg-gray-800 rounded-xl p-4 mb-4">
                      <label className="block text-gray-400 text-xs mb-2 font-medium">🏢 ผู้จำหน่าย</label>
                      {receiveSupplierContact ? (
                        <div className="bg-gray-700 rounded-xl p-3 flex items-center justify-between">
                          <div>
                            <div className="text-white font-bold text-sm">{receiveSupplierContact.name}</div>
                            {receiveSupplierContact.phone && <div className="text-gray-400 text-xs">{receiveSupplierContact.phone}</div>}
                            {Object.keys(supplierPrices).length > 0 && (
                              <div className="text-green-400 text-xs mt-0.5">💰 ใช้ราคาซื้อล่าสุดแล้ว</div>
                            )}
                          </div>
                          <button onClick={() => { setReceiveSupplierContact(null); setSupplierPrices({}); }}
                            className="text-gray-500 hover:text-gray-300 text-lg ml-2">✕</button>
                        </div>
                      ) : (
                        <div>
                          <input
                            value={receiveSupplierQ}
                            onChange={e => { setReceiveSupplierQ(e.target.value); setReceiveSupplier(e.target.value); }}
                            placeholder="ค้นหาผู้จำหน่ายเดิม หรือพิมพ์ชื่อใหม่..."
                            className="w-full bg-gray-700 text-white text-sm px-4 py-2.5 rounded-xl border border-gray-600 focus:outline-none focus:border-green-500"
                          />
                          {receiveMatchedSuppliers.length > 0 && (
                            <div className="bg-gray-700 rounded-xl overflow-hidden border border-gray-600 mt-2">
                              {receiveMatchedSuppliers.map(c => (
                                <button key={c.contact_id} className="w-full text-left px-3 py-2.5 hover:bg-gray-600 text-sm text-gray-200 border-b border-gray-600/50 last:border-0"
                                  onClick={() => { setReceiveSupplierContact(c); setReceiveSupplierQ(''); setReceiveSupplier(''); fetchSupplierPrices(c.contact_id); }}>
                                  <div>{c.name}</div>
                                  {c.phone && <div className="text-gray-500 text-xs">{c.phone}</div>}
                                </button>
                              ))}
                            </div>
                          )}
                          {suppliers.length === 0 && (
                            <p className="text-gray-600 text-xs mt-1.5">
                              ยังไม่มีผู้จำหน่ายในระบบ —{' '}
                              <button onClick={() => setTab('contacts')} className="text-green-500 underline">เพิ่มผู้จำหน่าย</button>
                              {' '}(หรือพิมพ์ชื่อไว้เฉยๆ ก็บันทึกได้ แค่จะไม่ผูกประวัติราคาซื้อ)
                            </p>
                          )}
                        </div>
                      )}
                    </div>

                    {/* เพิ่มรายการสินค้า */}
                    <div className="bg-gray-800 rounded-xl p-4 mb-4">
                      <div className="flex items-center justify-between mb-3">
                        <label className="text-gray-400 text-xs font-medium">📦 รายการสินค้าที่รับ</label>
                        <span className="text-gray-500 text-xs">{receiveItems.length} รายการ</span>
                      </div>

                      {/* ค้นหา + เลือกจากรายการสินค้า */}
                      <div className="mb-3">
                        <div className="flex gap-2 mb-2">
                          <input
                            value={receiveSearch}
                            onChange={e => { setReceiveSearch(e.target.value); setShowReceivePicker(true); }}
                            onFocus={() => setShowReceivePicker(true)}
                            placeholder="🔍 ค้นหาสินค้าที่ต้องการเพิ่ม..."
                            className="flex-1 min-w-0 bg-gray-700 text-white text-sm px-4 py-2.5 rounded-xl border border-gray-600 focus:outline-none focus:border-green-500"
                          />
                          <button type="button" onClick={() => setShowReceivePicker(v => !v)}
                            className={`shrink-0 text-xs px-3 py-2.5 rounded-xl transition-colors ${showReceivePicker ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
                            📋 เลือกจากรายการ
                          </button>
                        </div>

                        {showReceivePicker && (
                          <div className="bg-gray-700 rounded-xl border border-gray-600 overflow-hidden">
                            {/* ตัวกรองหมวดหมู่ */}
                            {categories.length > 1 && (
                              <div className="flex gap-1.5 overflow-x-auto p-2 border-b border-gray-600 scrollbar-hide">
                                {categories.map(cat => (
                                  <button key={cat} onClick={() => setReceiveCat(cat)}
                                    className={`shrink-0 text-xs px-3 py-1 rounded-full transition-colors ${
                                      receiveCat === cat ? 'bg-green-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-600'
                                    }`}>{cat}</button>
                                ))}
                              </div>
                            )}
                            <div className="max-h-56 overflow-y-auto">
                              {receiveFiltered.slice(0, 30).map(p => {
                                const already = receiveItems.some(i => i.sku === p.sku);
                                return (
                                  <button
                                    key={p.sku}
                                    onClick={() => !already && addReceiveItem(p)}
                                    disabled={already}
                                    className={`w-full text-left px-4 py-2.5 transition-colors flex items-center justify-between gap-2 border-b border-gray-600/50 last:border-0 ${already ? 'opacity-50 cursor-default' : 'hover:bg-gray-600'}`}
                                  >
                                    <span className="text-white text-sm truncate">{p.name}</span>
                                    <span className="text-gray-400 text-xs shrink-0">{already ? '✅ เพิ่มแล้ว' : `${p.stock} ${p.unit}`}</span>
                                  </button>
                                );
                              })}
                              {receiveFiltered.length === 0 && (
                                <div className="text-gray-500 text-xs text-center py-3">ไม่พบสินค้า</div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* รายการที่เพิ่มแล้ว */}
                      {receiveItems.length > 0 ? (
                        <div className="space-y-3">
                          {receiveItems.map(item => (
                            <div key={item.sku} className="bg-gray-700 rounded-xl p-3">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-white text-sm font-medium">{item.name}</span>
                                <button onClick={() => removeReceiveItem(item.sku)} className="text-gray-500 hover:text-red-400 text-xs transition-colors">✕</button>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="block text-gray-400 text-xs mb-1">จำนวนที่รับ ({item.unit})</label>
                                  <input
                                    type="number"
                                    value={item.qty}
                                    onChange={e => updateReceiveItem(item.sku, 'qty', e.target.value)}
                                    placeholder="0"
                                    min="0.01" step="any"
                                    className="w-full bg-gray-600 text-white text-sm px-3 py-2 rounded-lg border border-gray-500 focus:outline-none focus:border-green-500"
                                  />
                                </div>
                                <div>
                                  <label className="block text-gray-400 text-xs mb-1">ราคาต้นทุน/หน่วย (฿)</label>
                                  <input
                                    type="number"
                                    value={item.unitCost}
                                    onChange={e => updateReceiveItem(item.sku, 'unitCost', e.target.value)}
                                    placeholder="0.00"
                                    min="0" step="0.01"
                                    className="w-full bg-gray-600 text-white text-sm px-3 py-2 rounded-lg border border-gray-500 focus:outline-none focus:border-green-500"
                                  />
                                </div>
                              </div>
                              <div className="mt-2">
                                <div className="text-gray-400 text-xs mb-1">ราคานี้</div>
                                <div className="flex gap-1.5">
                                  {['ไม่มี VAT', 'รวม VAT แล้ว', 'ไม่รวม VAT'].map(v => (
                                    <button key={v} type="button"
                                      onClick={() => updateReceiveItem(item.sku, 'vatType', v)}
                                      className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                                        (item.vatType || 'ไม่มี VAT') === v
                                          ? 'bg-blue-700 border-blue-600 text-white'
                                          : 'bg-gray-600 border-gray-500 text-gray-300 hover:bg-gray-500'
                                      }`}>
                                      {v}
                                    </button>
                                  ))}
                                </div>
                              </div>
                              {item.qty && item.unitCost && (() => {
                                const { base, vat: unitVat } = splitVatAmount(parseFloat(item.unitCost) || 0, item.vatType);
                                const qty = parseFloat(item.qty) || 0;
                                const lineSub = qty * base;
                                const lineVat = qty * unitVat;
                                return (
                                  <div className="text-green-400 text-xs mt-1.5">
                                    รวม ฿{(lineSub + lineVat).toLocaleString(undefined, {minimumFractionDigits:2})}
                                    {lineVat > 0 && <span className="text-gray-500"> (ก่อน VAT ฿{lineSub.toLocaleString(undefined, {minimumFractionDigits:2})} + VAT ฿{lineVat.toLocaleString(undefined, {minimumFractionDigits:2})})</span>}
                                  </div>
                                );
                              })()}
                            </div>
                          ))}

                          {/* สรุปยอด — แบบใบกำกับภาษี */}
                          <div className="bg-gray-700 rounded-xl p-3 space-y-1.5">
                            <div className="flex justify-between items-center text-sm">
                              <span className="text-gray-400">ยอดก่อน VAT</span>
                              <span className="text-gray-200">฿{receiveSubtotal.toLocaleString(undefined, {minimumFractionDigits:2})}</span>
                            </div>
                            <div className="flex justify-between items-center text-sm">
                              <span className="text-gray-400">VAT รวม</span>
                              <span className="text-gray-200">฿{receiveVatTotal.toLocaleString(undefined, {minimumFractionDigits:2})}</span>
                            </div>
                            <div className="flex justify-between items-center border-t border-gray-600 pt-1.5">
                              <span className="text-gray-300 text-sm font-medium">ยอดสุทธิ</span>
                              <span className="text-green-400 font-bold text-lg">฿{receiveTotalCost.toLocaleString(undefined, {minimumFractionDigits:2})}</span>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="text-center text-gray-600 text-sm py-4">ค้นหาสินค้าด้านบนเพื่อเพิ่มในใบรับสินค้า</div>
                      )}
                    </div>

                    {/* แนบรูปบิล/ใบส่งของ */}
                    <div className="bg-gray-800 rounded-xl p-4 mb-4">
                      <label className="block text-gray-400 text-xs mb-2 font-medium">แนบรูปบิล/ใบส่งของ (ไม่บังคับ — แต่แนะนำให้แนบเพื่อความน่าเชื่อถือของข้อมูล)</label>
                      <label className="flex items-center justify-center gap-2 border border-dashed border-gray-600 rounded-xl py-3 cursor-pointer hover:border-gray-500 transition-colors">
                        <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleReceivePhoto} disabled={receivePhotoUploading} />
                        {receivePhotoUploading ? (
                          <span className="text-gray-400 text-xs animate-pulse">กำลังอัปโหลด...</span>
                        ) : receivePhotoUrl ? (
                          <span className="text-green-400 text-xs">✅ แนบรูปแล้ว — แตะเพื่อเปลี่ยน</span>
                        ) : (
                          <span className="text-gray-500 text-xs">📷 แตะเพื่อถ่ายรูป/เลือกรูปบิล-ใบส่งของ</span>
                        )}
                      </label>
                    </div>

                    {/* วันที่รับสินค้า — ปกติเป็นวันนี้ แก้ย้อนหลังได้ถ้าเอกสารมาช้า */}
                    <div className="bg-gray-800 rounded-xl p-4 mb-4">
                      <label className="block text-gray-400 text-xs mb-2 font-medium">📅 วันที่รับสินค้า</label>
                      <input type="date" value={receiveDate || getTodayISO()} max={getTodayISO()}
                        onChange={e => setReceiveDate(e.target.value)}
                        className="w-full bg-gray-700 text-white text-sm px-4 py-2.5 rounded-xl border border-gray-600 focus:outline-none focus:border-green-500"/>
                      {receiveDate && receiveDate !== getTodayISO() && (
                        <div className="text-amber-400 text-[11px] mt-1">⚠️ กำลังบันทึกย้อนหลัง — ไม่ใช่วันนี้</div>
                      )}
                    </div>

                    {/* หมายเหตุ */}
                    <div className="bg-gray-800 rounded-xl p-4 mb-4">
                      <label className="block text-gray-400 text-xs mb-2 font-medium">หมายเหตุ (ไม่บังคับ)</label>
                      <input
                        value={receiveNotes}
                        onChange={e => setReceiveNotes(e.target.value)}
                        placeholder="เช่น เลขบิล, เงื่อนไขการชำระ"
                        className="w-full bg-gray-700 text-white text-sm px-4 py-2.5 rounded-xl border border-gray-600 focus:outline-none focus:border-green-500"
                      />
                    </div>

                    <button
                      onClick={handleReceive}
                      disabled={!receiveItems.length || receiveSaving}
                      className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-bold py-3.5 rounded-xl transition-colors"
                    >
                      {receiveSaving ? 'กำลังบันทึก...' : `✅ ยืนยันรับสินค้า ${receiveItems.length} รายการ`}
                    </button>
                  </>
                ) : receiveView === 'pending' ? (
                  /* รอยืนยันจาก LINE (#รับสินค้า → ถ่ายรูปใบส่งของ → OCR) */
                  pendingReceivesLoading ? (
                    <div className="text-center text-gray-500 py-12 animate-pulse">กำลังโหลด...</div>
                  ) : pendingReceives.length === 0 ? (
                    <div className="text-center py-16 text-gray-500">
                      <div className="text-4xl mb-3">🔔</div>
                      <p className="text-sm">ไม่มีรายการรอยืนยัน</p>
                      <p className="text-xs mt-1 text-gray-600">พิมพ์ <span className="text-gray-400">#รับสินค้า</span> ในกลุ่ม LINE แล้วส่งรูปใบส่งของ ระบบจะมาโผล่ที่นี่</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {pendingReceives.map(p => (
                        <div key={p.pending_no} className="bg-gray-800 rounded-xl p-4">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-gray-400 text-xs font-mono">{p.pending_no}</span>
                            <span className="text-gray-500 text-xs">{p.created_at}</span>
                          </div>
                          <div className="text-white text-sm font-medium mb-1">🏢 {p.supplier}</div>
                          <div className="text-gray-500 text-xs mb-2">เลขที่ {p.invoice_no} · วันที่ {p.invoice_date}{p.branch ? ` · ${p.branch}` : ''}</div>
                          {Array.isArray(p.items) && p.items.map((item, j) => (
                            <div key={j} className="text-gray-400 text-xs flex justify-between">
                              <span>{item.name} ×{item.qty}</span>
                              <span>฿{(item.unitPrice || 0).toLocaleString()}/หน่วย</span>
                            </div>
                          ))}
                          {p.image_url && (
                            <a href={p.image_url} target="_blank" rel="noreferrer" className="text-blue-400 underline text-xs mt-2 inline-block">🖼️ ดูรูปใบส่งของ</a>
                          )}
                          <div className="flex gap-2 mt-3">
                            <button onClick={() => rejectPendingReceive(p)}
                              className="flex-1 bg-gray-700 hover:bg-red-800 text-gray-300 hover:text-white text-xs font-medium py-2 rounded-lg transition-colors">
                              ❌ ปฏิเสธ
                            </button>
                            <button onClick={() => loadPendingIntoForm(p)}
                              className="flex-[2] bg-green-700 hover:bg-green-600 text-white text-xs font-bold py-2 rounded-lg transition-colors">
                              ✅ ตรวจสอบ/ยืนยัน
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                ) : (
                  /* ประวัติรับสินค้า */
                  receiveHistoryLoading ? (
                    <div className="text-center text-gray-500 py-12 animate-pulse">กำลังโหลด...</div>
                  ) : receiveHistory.length === 0 ? (
                    <div className="text-center py-16 text-gray-500">
                      <div className="text-4xl mb-3">📋</div>
                      <p className="text-sm">ยังไม่มีประวัติรับสินค้า</p>
                    </div>
                  ) : (() => {
                    const THAI_MONTHS = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
                    const withDate = receiveHistory.map(r => ({ ...r, _d: parseThaiOrderDate(r.created_at) }));
                    const monthKeys = [...new Set(withDate.filter(r => r._d).map(r => `${r._d.getFullYear()}-${String(r._d.getMonth()+1).padStart(2,'0')}`))]
                      .sort((a, b) => b.localeCompare(a));
                    const filtered = receiveHistoryMonth === 'all' ? withDate
                      : withDate.filter(r => r._d && `${r._d.getFullYear()}-${String(r._d.getMonth()+1).padStart(2,'0')}` === receiveHistoryMonth);
                    const PAGE_SIZE = 20;
                    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
                    const page = Math.min(receiveHistoryPage, totalPages - 1);
                    const pageItems = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
                    return (
                      <>
                        {monthKeys.length > 0 && (
                          <div className="flex items-center gap-2 mb-3 flex-wrap">
                            <select value={receiveHistoryMonth}
                              onChange={e => { setReceiveHistoryMonth(e.target.value); setReceiveHistoryPage(0); }}
                              className="bg-gray-800 text-white text-xs px-3 py-2 rounded-lg border border-gray-700 focus:outline-none">
                              <option value="all">ทุกเดือน ({receiveHistory.length} รายการ)</option>
                              {monthKeys.map(k => {
                                const [y, m] = k.split('-');
                                const count = withDate.filter(r => r._d && `${r._d.getFullYear()}-${String(r._d.getMonth()+1).padStart(2,'0')}` === k).length;
                                return <option key={k} value={k}>{THAI_MONTHS[Number(m)-1]} {Number(y)+543} ({count} รายการ)</option>;
                              })}
                            </select>
                          </div>
                        )}
                        {filtered.length === 0 ? (
                          <div className="text-center py-16 text-gray-500">
                            <div className="text-4xl mb-3">📋</div>
                            <p className="text-sm">ไม่มีรายการในเดือนที่เลือก</p>
                          </div>
                        ) : (
                          <>
                            <div className="space-y-3">
                              {pageItems.map((r, i) => (
                                <div key={r.receive_no || i} className="bg-gray-800 rounded-xl p-4">
                                  <div className="flex items-center justify-between mb-2">
                                    <span className="text-gray-400 text-xs font-mono">{r.receive_no}</span>
                                    <span className="text-green-400 font-bold text-sm">฿{(r.total_cost || 0).toLocaleString()}</span>
                                  </div>
                                  {r.supplier && <div className="text-white text-sm font-medium mb-1">🏢 {r.supplier}</div>}
                                  <div className="text-gray-500 text-xs mb-2">{r.created_at}</div>
                                  {Array.isArray(r.items) && r.items.map((item, j) => (
                                    <div key={j} className="text-gray-400 text-xs flex justify-between">
                                      <span>{item.name} ×{item.qty} {item.unit}</span>
                                      <span>฿{(item.unitCost || 0).toLocaleString()}/หน่วย</span>
                                    </div>
                                  ))}
                                  {r.notes && <div className="text-gray-600 text-xs mt-1.5">{r.notes}</div>}
                                </div>
                              ))}
                            </div>
                            {totalPages > 1 && (
                              <div className="flex items-center justify-center gap-3 mt-4">
                                <button onClick={() => setReceiveHistoryPage(p => Math.max(0, p - 1))} disabled={page === 0}
                                  className="text-xs px-3 py-1.5 rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed">
                                  ← ก่อนหน้า
                                </button>
                                <span className="text-xs text-gray-500">หน้า {page + 1}/{totalPages}</span>
                                <button onClick={() => setReceiveHistoryPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                                  className="text-xs px-3 py-1.5 rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed">
                                  ถัดไป →
                                </button>
                              </div>
                            )}
                          </>
                        )}
                      </>
                    );
                  })()
                )}
              </div>
            </div>
          )}

          {/* ══ TAB: รายจ่าย ══════════════════════════════════════════════ */}
          {tab === 'expenses' && (
            <div className="h-full overflow-y-auto">
              <div className="p-4 max-w-xl mx-auto space-y-4">
                {/* รอยืนยันจาก LINE (#รายจ่าย → ถ่ายรูปบิล → OCR) */}
                {(pendingExpensesLoading || pendingExpenses.length > 0) && (
                  <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
                    <div className="px-5 py-3 border-b border-gray-800">
                      <h3 className="text-white font-bold text-sm">🔔 รอยืนยันจาก LINE{pendingExpenses.length ? ` (${pendingExpenses.length})` : ''}</h3>
                      <p className="text-gray-500 text-xs mt-0.5">พิมพ์ <span className="text-gray-400">#รายจ่าย</span> ในกลุ่ม LINE แล้วส่งรูปบิล ระบบจะมาโผล่ที่นี่</p>
                    </div>
                    {pendingExpensesLoading ? (
                      <div className="text-center text-gray-500 py-8 animate-pulse">กำลังโหลด...</div>
                    ) : (
                      <div className="p-4 space-y-3">
                        {pendingExpenses.map(p => (
                          <div key={p.pending_no} className="bg-gray-800 rounded-xl p-4">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-gray-400 text-xs font-mono">{p.pending_no}</span>
                              <span className="text-gray-500 text-xs">{p.created_at}</span>
                            </div>
                            <div className="text-white text-sm font-medium mb-1">📝 {p.label}</div>
                            <div className="text-gray-500 text-xs mb-1">ผู้รับเงิน: {p.vendor} · {p.vat_type}</div>
                            <div className="text-green-400 text-sm font-bold mb-2">฿{p.amount.toLocaleString(undefined,{minimumFractionDigits:2})}</div>
                            {p.image_url && (
                              <a href={p.image_url} target="_blank" rel="noreferrer" className="text-blue-400 underline text-xs mb-2 inline-block">🖼️ ดูรูปบิล</a>
                            )}
                            <div className="flex gap-2 mt-1">
                              <button onClick={() => rejectPendingExpense(p)}
                                className="flex-1 bg-gray-700 hover:bg-red-800 text-gray-300 hover:text-white text-xs font-medium py-2 rounded-lg transition-colors">
                                ❌ ปฏิเสธ
                              </button>
                              <button onClick={() => loadPendingExpenseIntoForm(p)}
                                className="flex-[2] bg-green-700 hover:bg-green-600 text-white text-xs font-bold py-2 rounded-lg transition-colors">
                                ✅ ตรวจสอบ/ยืนยัน
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800 space-y-3">
                  <h3 className="text-white font-bold">🧾 บันทึกรายจ่าย</h3>
                  <p className="text-gray-400 text-xs -mt-2">ค่าใช้จ่ายของร้านที่ไม่เกี่ยวกับสต็อคสินค้า เช่น ค่าเช่า ค่าน้ำ-ไฟ ค่าแรง ฯลฯ</p>

                  <div>
                    <label className="block text-gray-400 text-xs mb-1.5">รายการ/หมวดหมู่</label>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {EXPENSE_CATEGORIES.map(cat => (
                        <button key={cat} type="button" onClick={() => setExpenseForm(f => ({ ...f, label: cat }))}
                          className={`text-xs px-3 py-1.5 rounded-full transition-colors ${
                            expenseForm.label === cat ? 'bg-green-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                          }`}>
                          {cat}
                        </button>
                      ))}
                    </div>
                    <input type="text" value={expenseForm.label}
                      onChange={e => setExpenseForm(f => ({ ...f, label: e.target.value }))}
                      placeholder="เช่น ค่าเช่าร้าน, ค่าน้ำมันรถส่งของ หรือกดเลือกจากด้านบน"
                      className="w-full bg-gray-800 text-white text-sm px-4 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500" />
                  </div>

                  <div>
                    <label className="block text-gray-400 text-xs mb-1.5">จำนวนเงิน (฿)</label>
                    <input type="number" value={expenseForm.amount}
                      onChange={e => setExpenseForm(f => ({ ...f, amount: e.target.value }))}
                      placeholder="0.00" min="0" step="0.01"
                      className="w-full bg-gray-800 text-white text-sm px-4 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500" />
                  </div>

                  <div>
                    <label className="block text-gray-400 text-xs mb-1.5">ราคานี้</label>
                    <div className="flex gap-1.5">
                      {['ไม่มี VAT', 'รวม VAT แล้ว', 'ไม่รวม VAT'].map(v => (
                        <button key={v} type="button" onClick={() => setExpenseForm(f => ({ ...f, vatType: v }))}
                          className={`flex-1 py-2 rounded-xl text-xs font-medium transition-colors border ${
                            expenseForm.vatType === v ? 'bg-blue-700 border-blue-600 text-white' : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
                          }`}>
                          {v}
                        </button>
                      ))}
                    </div>
                    {expenseForm.amount && parseFloat(expenseForm.amount) > 0 && (() => {
                      const { base, vat } = splitVatAmount(parseFloat(expenseForm.amount) || 0, expenseForm.vatType);
                      return vat > 0 ? (
                        <div className="text-gray-500 text-xs mt-1.5">ก่อน VAT ฿{base.toLocaleString(undefined,{minimumFractionDigits:2})} + VAT ฿{vat.toLocaleString(undefined,{minimumFractionDigits:2})}</div>
                      ) : null;
                    })()}
                  </div>

                  <div>
                    <label className="block text-gray-400 text-xs mb-1.5">วิธีชำระ</label>
                    <div className="flex gap-1.5">
                      {['เงินสด', 'โอน'].map(v => (
                        <button key={v} type="button" onClick={() => setExpenseForm(f => ({ ...f, payment_method: v }))}
                          className={`flex-1 py-2 rounded-xl text-xs font-medium transition-colors ${
                            expenseForm.payment_method === v ? 'bg-green-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                          }`}>
                          {v}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-gray-400 text-xs mb-1.5">แนบรูปบิล/สลิป (ไม่บังคับ)</label>
                    <label className="flex items-center justify-center gap-2 border border-dashed border-gray-700 rounded-xl py-4 cursor-pointer hover:border-gray-500 transition-colors">
                      <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleExpensePhoto} disabled={expensePhotoUploading} />
                      {expensePhotoUploading ? (
                        <span className="text-gray-400 text-xs animate-pulse">กำลังอัปโหลด...</span>
                      ) : expensePhotoUrl ? (
                        <span className="text-green-400 text-xs">✅ แนบรูปแล้ว — แตะเพื่อเปลี่ยน</span>
                      ) : (
                        <span className="text-gray-500 text-xs">📷 แตะเพื่อถ่ายรูป/เลือกรูปบิล-สลิป</span>
                      )}
                    </label>
                  </div>

                  <div>
                    <label className="block text-gray-400 text-xs mb-1.5">📅 วันที่รายจ่าย</label>
                    <input type="date" value={expenseForm.transactionDate || getTodayISO()} max={getTodayISO()}
                      onChange={e => setExpenseForm(f => ({ ...f, transactionDate: e.target.value }))}
                      className="w-full bg-gray-800 text-white text-sm px-4 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500" />
                    {expenseForm.transactionDate && expenseForm.transactionDate !== getTodayISO() && (
                      <div className="text-amber-400 text-[11px] mt-1">⚠️ กำลังบันทึกย้อนหลัง — ไม่ใช่วันนี้</div>
                    )}
                  </div>

                  <div>
                    <label className="block text-gray-400 text-xs mb-1.5">หมายเหตุ (ไม่บังคับ)</label>
                    <input type="text" value={expenseForm.notes}
                      onChange={e => setExpenseForm(f => ({ ...f, notes: e.target.value }))}
                      className="w-full bg-gray-800 text-white text-sm px-4 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500" />
                  </div>

                  <button onClick={submitExpense} disabled={expenseSaving}
                    className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-colors">
                    {expenseSaving ? 'กำลังบันทึก...' : '✅ บันทึกรายจ่าย'}
                  </button>
                </div>

                {/* ประวัติรายจ่าย */}
                <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
                  <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
                    <h3 className="text-white font-bold text-sm">ประวัติรายจ่าย</h3>
                    {expenseSummary && (
                      <span className="text-gray-400 text-xs">รวม ฿{expenseSummary.total.toLocaleString(undefined,{minimumFractionDigits:2})} ({expenseSummary.count} รายการ)</span>
                    )}
                  </div>
                  {expenseHistoryLoading && <div className="text-center text-gray-500 py-8 text-sm animate-pulse">กำลังโหลด...</div>}
                  {!expenseHistoryLoading && (
                    <div className="divide-y divide-gray-800">
                      {expenseHistory.map(e => (
                        <div key={e.expense_no} className="px-5 py-3 flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-white text-sm truncate">{e.label}</div>
                            <div className="text-gray-500 text-xs">{e.created_at} · {e.payment_method}{e.vat_amount > 0 ? ` · VAT ฿${e.vat_amount.toLocaleString(undefined,{minimumFractionDigits:2})}` : ''}</div>
                            {e.photo_url && <a href={e.photo_url} target="_blank" rel="noopener noreferrer" className="text-blue-400 text-xs underline">📎 ดูรูปบิล/สลิป</a>}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-red-400 font-bold text-sm">฿{e.total.toLocaleString(undefined,{minimumFractionDigits:2})}</span>
                            <button onClick={() => deleteExpense(e.expense_no)} className="text-gray-500 hover:text-red-400 text-xs">🗑️</button>
                          </div>
                        </div>
                      ))}
                      {!expenseHistory.length && <div className="text-center text-gray-500 py-8 text-sm">ยังไม่มีรายจ่าย</div>}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ══ TAB: ออเดอร์จัดส่ง ══════════════════════════════════════════ */}
          {tab === 'orders' && (
            <div className="h-full overflow-y-auto">
              <div className="p-4 max-w-3xl mx-auto">
                <div className="flex items-center justify-between mb-4 gap-2">
                  <h2 className="text-white font-bold">ออเดอร์จัดส่ง ({displayOrders.length}{displayOrders.length !== orders.length ? `/${orders.length}` : ''})</h2>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button onClick={() => setShowCustomerOrders(true)}
                      className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${customerOrders.length ? 'bg-orange-900/60 text-orange-300 border-orange-700 animate-pulse' : 'bg-gray-800 text-gray-400 border-gray-700 hover:bg-gray-700'}`}>
                      🛒 รอยืนยันจากลูกค้า{customerOrders.length ? ` (${customerOrders.length})` : ''}
                    </button>
                    <button onClick={() => fetchOrders(shopId)} className="text-xs text-gray-400 hover:text-white bg-gray-800 px-3 py-1.5 rounded-lg border border-gray-700 transition-colors">
                      🔄 รีเฟรช
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 mb-3 flex-wrap">
                  {[
                    { v: 'all', label: 'ทั้งหมด' },
                    { v: 'pending', label: '🕒 ค้างจัดส่ง' },
                    { v: 'delivered', label: '✅ จัดส่งแล้ว' },
                  ].map(f => (
                    <button key={f.v} onClick={() => setOrderStatusFilter(f.v)}
                      className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${orderStatusFilter === f.v ? 'bg-green-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
                      {f.label}
                    </button>
                  ))}
                  <span className="w-px h-5 bg-gray-700 mx-0.5" />
                  {[
                    { v: 'all', label: 'ทุกวันที่' },
                    { v: 'today', label: '📅 ค้างวันนี้' },
                    { v: 'month', label: '📅 ค้างเดือนนี้' },
                  ].map(f => (
                    <button key={f.v} onClick={() => setOrderDateFilter(f.v)}
                      className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${orderDateFilter === f.v ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
                      {f.label}
                    </button>
                  ))}
                </div>

                {ordersLoading ? (
                  <div className="text-center text-gray-500 py-12 animate-pulse">กำลังโหลด...</div>
                ) : displayOrders.length === 0 ? (
                  <div className="text-center py-16">
                    <div className="text-5xl mb-3">🚚</div>
                    <p className="text-gray-400 text-sm">{orders.length === 0 ? 'ยังไม่มีออเดอร์จัดส่ง' : 'ไม่พบออเดอร์ตามตัวกรองที่เลือก'}</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {displayOrders.map(order => {
                      const statusColor = {
                        'รอจัดส่ง': 'bg-yellow-900/60 text-yellow-300',
                        'กำลังส่ง': 'bg-blue-900/60 text-blue-300',
                        'ส่งแล้ว': 'bg-green-900/60 text-green-300',
                        'ยกเลิก': 'bg-gray-700 text-gray-400',
                      }[order.status] || 'bg-gray-700 text-gray-400';
                      const nextStatuses = order.status === 'รอจัดส่ง' ? ['กำลังส่ง', 'ยกเลิก'] :
                                           order.status === 'กำลังส่ง' ? ['ส่งแล้ว', 'ยกเลิก'] : [];
                      return (
                        <div key={order.order_no} className="bg-gray-800 rounded-xl p-4">
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div>
                              <div className="text-gray-400 text-xs font-mono">{order.order_no}</div>
                              <div className="text-white font-medium">{order.customer_name}</div>
                              {order.phone && <div className="text-gray-400 text-xs">📞 {order.phone}</div>}
                              {order.address && <div className="text-gray-500 text-xs mt-0.5 max-w-xs">{order.address}</div>}
                            </div>
                            <span className={`shrink-0 text-xs px-2 py-1 rounded-full font-medium ${statusColor}`}>{order.status}</span>
                          </div>
                          <div className="flex items-center justify-between mt-2">
                            <div>
                              <div className="text-green-400 text-sm font-bold">฿{order.total?.toLocaleString()}</div>
                              <div className="text-gray-500 text-xs">{order.payment_method} · {order.staff_name}</div>
                              <div className="text-gray-600 text-xs">{order.created_at}</div>
                              {order.created_by && (
                                <div className="text-gray-600 text-xs">👤 ออกโดย {resolveCreatedBy(order.created_by)}</div>
                              )}
                            </div>
                            <div className="flex flex-col gap-1.5 items-end">
                              {order.maps_link && (
                                <a href={order.maps_link} target="_blank" rel="noreferrer" className="text-xs bg-gray-700 hover:bg-green-800 text-gray-300 hover:text-green-300 px-2.5 py-1.5 rounded-lg transition-colors">🗺️ แผนที่</a>
                              )}
                              {nextStatuses.map(s => (
                                <button key={s} disabled={orderStatusUpdating === order.order_no}
                                  onClick={() => updateOrderStatus(order.order_no, s)}
                                  className={`text-xs px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50 ${
                                    s === 'ส่งแล้ว' ? 'bg-green-700 hover:bg-green-600 text-white' :
                                    s === 'กำลังส่ง' ? 'bg-blue-700 hover:bg-blue-600 text-white' :
                                    'bg-gray-700 hover:bg-red-800 text-gray-300 hover:text-red-300'
                                  }`}>
                                  {orderStatusUpdating === order.order_no ? '...' : s}
                                </button>
                              ))}
                            </div>
                          </div>
                          {Array.isArray(order.items) && order.items.length > 0 && (
                            <div className="mt-2 pt-2 border-t border-gray-700 text-xs text-gray-500">
                              {order.items.map((item, j) => (
                                <span key={j} className="mr-2">
                                  {item.name} ×{item.qty}
                                  {item.returned_qty > 0 && <span className="text-orange-400"> (คืนเปล่า {item.returned_qty})</span>}
                                </span>
                              ))}
                            </div>
                          )}

                          {/* ยืนยันจัดส่งแล้ว — แสดงรายละเอียดการยืนยันจากพนักงาน + ปุ่มยืนยันรับเงิน/รับของ (Phase B) */}
                          {order.status === 'ส่งแล้ว' && order.confirmed_at && (
                            <div className="mt-2 pt-2 border-t border-gray-700">
                              <div className="text-gray-500 text-xs">
                                ✅ ยืนยันจัดส่งเมื่อ {order.confirmed_at}{order.confirmed_by ? ` โดย ${order.confirmed_by}` : ''}
                                {order.slip_url && (
                                  <> · <a href={order.slip_url} target="_blank" rel="noreferrer" className="text-blue-400 underline">ดูสลิป</a></>
                                )}
                              </div>
                              <div className="flex gap-1.5 mt-1.5 flex-wrap">
                                {order.payment_method !== 'ค้างจ่าย' && (
                                  order.cash_received ? (
                                    <span className="text-xs bg-green-900/60 text-green-300 px-2.5 py-1.5 rounded-lg">💰 รับเงินเข้าร้านแล้ว</span>
                                  ) : (
                                    <button onClick={() => confirmCashReceived(order)} disabled={cashConfirming === order.order_no}
                                      className="text-xs bg-yellow-700 hover:bg-yellow-600 text-white px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                                      {cashConfirming === order.order_no ? '...' : '💰 ยืนยันรับเงินเข้าร้าน'}
                                    </button>
                                  )
                                )}
                                {Array.isArray(order.items) && order.items.some(i => i.returned_qty > 0) && (
                                  order.goods_received ? (
                                    <span className="text-xs bg-green-900/60 text-green-300 px-2.5 py-1.5 rounded-lg">📦 รับของเข้าคลังแล้ว</span>
                                  ) : (
                                    <button onClick={() => confirmGoodsReceived(order)} disabled={goodsConfirming === order.order_no}
                                      className="text-xs bg-orange-700 hover:bg-orange-600 text-white px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                                      {goodsConfirming === order.order_no ? '...' : '📦 ยืนยันรับของคืนเข้าคลัง'}
                                    </button>
                                  )
                                )}
                              </div>
                            </div>
                          )}

                          <div className="flex gap-1.5 mt-2 pt-2 border-t border-gray-700">
                            <button onClick={() => openEditOrder(order)}
                              className="text-xs bg-gray-700 hover:bg-blue-700 text-gray-300 hover:text-white px-2.5 py-1.5 rounded-lg transition-colors">✏️ แก้ไข</button>
                            <button onClick={() => deleteOrder(order)} disabled={orderDeleting === order.order_no}
                              className="text-xs bg-gray-700 hover:bg-red-700 text-gray-300 hover:text-white px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                              {orderDeleting === order.order_no ? 'กำลังลบ...' : '🗑️ ลบ'}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ══ TAB: เก็บเงิน/ของ ═══════════════════════════════════════════ */}
          {tab === 'collections' && (() => {
            const now = new Date();
            const startOfWeek = new Date(now); startOfWeek.setDate(now.getDate() - now.getDay()); startOfWeek.setHours(0,0,0,0);
            const displayTasks = collectionTasks.filter(t => {
              // งานที่พนักงานยืนยัน "เก็บสำเร็จ" แล้ว ยังไม่ถือว่า "เสร็จแล้ว" จนกว่าแอดมินจะกดยืนยัน
              // รับเงิน/รับของเข้าร้านครบทุกอย่างที่เกี่ยวข้องก่อน (สองชั้นกันเงิน/ของหาย) — เดิมย้ายไปโชว์ว่า
              // "เสร็จแล้ว" ทันทีที่พนักงานตอบ ทั้งที่แอดมินยังไม่ได้กดยืนยันรับเข้าร้านเลย
              const isFullyDone = t.status === 'เก็บไม่ได้' || (
                t.status === 'เก็บสำเร็จ' &&
                (!(t.collected_amount > 0) || t.cash_received) &&
                (!(t.collected_items?.length > 0) || t.goods_received)
              );
              if (collectStatusFilter === 'pending' && isFullyDone) return false;
              if (collectStatusFilter === 'done' && !isFullyDone) return false;
              if (collectDateFilter !== 'all') {
                const d = parseThaiOrderDate(t.created_at);
                if (!d) return false;
                if (collectDateFilter === 'today') {
                  if (d.toDateString() !== now.toDateString()) return false;
                } else if (collectDateFilter === 'week') {
                  if (d < startOfWeek) return false;
                } else if (collectDateFilter === 'month') {
                  if (d.getMonth() !== now.getMonth() || d.getFullYear() !== now.getFullYear()) return false;
                }
              }
              return true;
            });
            return (
              <div className="h-full overflow-y-auto">
                <div className="p-4 max-w-3xl mx-auto">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-white font-bold">งานเก็บเงิน/ของ ({displayTasks.length}{displayTasks.length !== collectionTasks.length ? `/${collectionTasks.length}` : ''})</h2>
                    <button onClick={() => fetchCollectionTasks(shopId)} className="text-xs text-gray-400 hover:text-white bg-gray-800 px-3 py-1.5 rounded-lg border border-gray-700 transition-colors">
                      🔄 รีเฟรช
                    </button>
                  </div>

                  <div className="flex items-center gap-1.5 mb-3 flex-wrap">
                    {[
                      { v: 'all', label: 'ทั้งหมด' },
                      { v: 'pending', label: '🕒 รอดำเนินการ' },
                      { v: 'done', label: '✅ เสร็จแล้ว' },
                    ].map(f => (
                      <button key={f.v} onClick={() => setCollectStatusFilter(f.v)}
                        className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${collectStatusFilter === f.v ? 'bg-orange-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
                        {f.label}
                      </button>
                    ))}
                    <span className="w-px h-5 bg-gray-700 mx-0.5" />
                    {[
                      { v: 'all', label: 'ทุกวันที่' },
                      { v: 'today', label: '📅 วันนี้' },
                      { v: 'week', label: '📅 สัปดาห์นี้' },
                      { v: 'month', label: '📅 เดือนนี้' },
                    ].map(f => (
                      <button key={f.v} onClick={() => setCollectDateFilter(f.v)}
                        className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${collectDateFilter === f.v ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
                        {f.label}
                      </button>
                    ))}
                  </div>

                  {collectionTasksLoading ? (
                    <div className="text-center text-gray-500 py-12 animate-pulse">กำลังโหลด...</div>
                  ) : displayTasks.length === 0 ? (
                    <div className="text-center py-16">
                      <div className="text-5xl mb-3">🧾</div>
                      <p className="text-gray-400 text-sm">{collectionTasks.length === 0 ? 'ยังไม่มีงานเก็บเงิน/ของ' : 'ไม่พบงานตามตัวกรองที่เลือก'}</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {displayTasks.map(task => {
                        const statusColor = {
                          'รอดำเนินการ': 'bg-yellow-900/60 text-yellow-300',
                          'เก็บสำเร็จ': 'bg-green-900/60 text-green-300',
                          'เก็บไม่ได้': 'bg-red-900/60 text-red-300',
                        }[task.status] || 'bg-gray-700 text-gray-400';
                        return (
                          <div key={task.collection_no} className="bg-gray-800 rounded-xl p-4">
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <div>
                                <div className="text-gray-400 text-xs font-mono">{task.collection_no}</div>
                                <div className="text-white font-medium">{task.customer_name}</div>
                                {task.phone && <div className="text-gray-400 text-xs">📞 {task.phone}</div>}
                              </div>
                              <span className={`shrink-0 text-xs px-2 py-1 rounded-full font-medium ${statusColor}`}>{task.status}</span>
                            </div>
                            <div className="text-gray-500 text-xs mb-1.5">{task.task_type} · {task.staff_name} · {task.created_at}</div>
                            {task.debt_amount > 0 && <div className="text-orange-400 text-sm font-bold">💳 เงินเชื่อค้าง ฿{task.debt_amount.toLocaleString()}</div>}
                            {Array.isArray(task.items) && task.items.length > 0 && (
                              <div className="text-xs text-gray-500 mt-1">
                                {task.items.map((item, j) => <span key={j} className="mr-2">🔄 {item.name} ×{item.qty}</span>)}
                              </div>
                            )}
                            {task.notes && <div className="text-gray-500 text-xs mt-1">📝 {task.notes}</div>}

                            {task.status !== 'รอดำเนินการ' && (
                              <div className="mt-2 pt-2 border-t border-gray-700">
                                <div className="text-gray-500 text-xs">
                                  ยืนยันเมื่อ {task.confirmed_at}{task.confirmed_by ? ` โดย ${task.confirmed_by}` : ''}
                                  {task.slip_url && (<> · <a href={task.slip_url} target="_blank" rel="noreferrer" className="text-blue-400 underline">ดูสลิป</a></>)}
                                </div>
                                {task.status === 'เก็บสำเร็จ' && (
                                  <div className="text-green-400 text-xs mt-0.5">
                                    เก็บได้ ฿{task.collected_amount.toLocaleString()}
                                    {task.collected_items?.length > 0 && ` · ${task.collected_items.map(i => `${i.name} ×${i.qty}`).join(', ')}`}
                                  </div>
                                )}
                                {task.status === 'เก็บไม่ได้' && task.staff_note && (
                                  <div className="text-red-400 text-xs mt-0.5">เหตุผล: {task.staff_note}</div>
                                )}
                                {task.status === 'เก็บสำเร็จ' && (
                                  <div className="flex gap-1.5 mt-1.5 flex-wrap">
                                    {task.collected_amount > 0 && (
                                      task.cash_received ? (
                                        <span className="text-xs bg-green-900/60 text-green-300 px-2.5 py-1.5 rounded-lg">💰 รับเงินเข้าร้านแล้ว</span>
                                      ) : (
                                        <button onClick={() => confirmCollectCash(task)} disabled={collectCashConfirming === task.collection_no}
                                          className="text-xs bg-yellow-700 hover:bg-yellow-600 text-white px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                                          {collectCashConfirming === task.collection_no ? '...' : '💰 ยืนยันรับเงินเข้าร้าน'}
                                        </button>
                                      )
                                    )}
                                    {task.collected_items?.length > 0 && (
                                      task.goods_received ? (
                                        <span className="text-xs bg-green-900/60 text-green-300 px-2.5 py-1.5 rounded-lg">📦 รับของเข้าคลังแล้ว</span>
                                      ) : (
                                        <button onClick={() => confirmCollectGoods(task)} disabled={collectGoodsConfirming === task.collection_no}
                                          className="text-xs bg-orange-700 hover:bg-orange-600 text-white px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                                          {collectGoodsConfirming === task.collection_no ? '...' : '📦 ยืนยันรับของคืนเข้าคลัง'}
                                        </button>
                                      )
                                    )}
                                  </div>
                                )}
                              </div>
                            )}

                            {task.status === 'รอดำเนินการ' && (
                              <div className="flex gap-1.5 mt-2 pt-2 border-t border-gray-700">
                                <button onClick={() => deleteCollectionTask(task)}
                                  className="text-xs bg-gray-700 hover:bg-red-700 text-gray-300 hover:text-white px-2.5 py-1.5 rounded-lg transition-colors">
                                  🗑️ ยกเลิกงาน
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* ══ Modal: แก้ไขออเดอร์จัดส่ง ══════════════════════════════════════ */}
          {showOrderEditForm && editingOrder && (
            <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-gray-900 rounded-2xl w-full max-w-md border border-gray-700 shadow-2xl max-h-[90vh] overflow-y-auto">
                <div className="p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-white font-bold">✏️ แก้ไขออเดอร์ {editingOrder.order_no}</h3>
                    <button onClick={() => setShowOrderEditForm(false)} className="text-gray-400 hover:text-white text-2xl leading-none">×</button>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-gray-400 text-xs mb-1.5">ชื่อลูกค้า</label>
                      <input value={orderEditForm.customer_name}
                        onChange={e => setOrderEditForm(f => ({ ...f, customer_name: e.target.value }))}
                        className="w-full bg-gray-800 text-white text-sm px-4 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500" />
                    </div>
                    <div>
                      <label className="block text-gray-400 text-xs mb-1.5">เบอร์โทร</label>
                      <input value={orderEditForm.phone}
                        onChange={e => setOrderEditForm(f => ({ ...f, phone: e.target.value }))}
                        className="w-full bg-gray-800 text-white text-sm px-4 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500" />
                    </div>
                    <div>
                      <label className="block text-gray-400 text-xs mb-1.5">ที่อยู่จัดส่ง</label>
                      <textarea value={orderEditForm.address} rows={2}
                        onChange={e => setOrderEditForm(f => ({ ...f, address: e.target.value }))}
                        className="w-full bg-gray-800 text-white text-sm px-4 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500" />
                    </div>
                    <div>
                      <label className="block text-gray-400 text-xs mb-1.5">พนักงานส่ง</label>
                      <select value={orderEditForm.staff_id}
                        onChange={e => setOrderEditForm(f => ({ ...f, staff_id: e.target.value }))}
                        className="w-full bg-gray-800 text-white text-sm px-4 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500">
                        <option value="">— ไม่ระบุ —</option>
                        {staff.map(s => (
                          <option key={s.staff_id} value={s.staff_id}>{s.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-gray-400 text-xs mb-1.5">วิธีชำระ</label>
                      <select value={orderEditForm.payment_method}
                        onChange={e => setOrderEditForm(f => ({ ...f, payment_method: e.target.value }))}
                        className="w-full bg-gray-800 text-white text-sm px-4 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500">
                        <option value="เก็บปลายทาง">เก็บปลายทาง</option>
                        <option value="โอนแล้ว">โอนแล้ว</option>
                        <option value="ค้างจ่าย">ค้างจ่าย</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-gray-400 text-xs mb-1.5">หมายเหตุ</label>
                      <textarea value={orderEditForm.notes} rows={2}
                        onChange={e => setOrderEditForm(f => ({ ...f, notes: e.target.value }))}
                        className="w-full bg-gray-800 text-white text-sm px-4 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500" />
                    </div>
                  </div>
                  <div className="flex gap-3 mt-5">
                    <button onClick={() => setShowOrderEditForm(false)} className="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-bold py-3 rounded-xl transition-colors text-sm">ยกเลิก</button>
                    <button onClick={saveOrderEdit} disabled={orderEditSaving}
                      className="flex-[2] bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-colors text-sm">
                      {orderEditSaving ? 'กำลังบันทึก...' : '💾 บันทึก'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ══ Modal: เปิดกะเงินสด ══════════════════════════════════════════ */}
          {showOpenShiftModal && (
            <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-gray-900 rounded-2xl w-full max-w-sm border border-gray-700 shadow-2xl">
                <div className="p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-white font-bold">🔓 เปิดกะเงินสด</h3>
                    <button onClick={() => setShowOpenShiftModal(false)} className="text-gray-400 hover:text-white text-2xl leading-none">×</button>
                  </div>

                  {openShiftStep === 'pin' ? (
                    <>
                      <div className="text-gray-400 text-xs mb-3">กรอก PIN พนักงานเพื่อยืนยันตัวตนก่อนเปิดกะของตัวเอง</div>
                      <input
                        type="password" inputMode="numeric" autoFocus
                        value={openShiftPin}
                        onChange={e => { setOpenShiftPin(e.target.value.replace(/\D/g, '').slice(0, 8)); setOpenShiftPinError(''); }}
                        onKeyDown={e => { if (e.key === 'Enter') verifyOpenShiftPin(); }}
                        placeholder="PIN"
                        className="w-full bg-gray-800 text-white text-2xl font-bold text-center tracking-widest px-4 py-3 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500 mb-2"
                      />
                      {openShiftPinError && <div className="text-red-400 text-xs mb-3">{openShiftPinError}</div>}
                      <button onClick={verifyOpenShiftPin} disabled={openShiftVerifying || !openShiftPin.trim()}
                        className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-colors text-sm">
                        {openShiftVerifying ? 'กำลังตรวจสอบ...' : 'ยืนยันตัวตน'}
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="bg-gray-800 rounded-xl p-3 mb-4">
                        <div className="text-white font-medium">👋 {openShiftStaff?.name}</div>
                        {selectedBranch && <div className="text-gray-400 text-xs mt-0.5">สาขา: {selectedBranch.branch_name}</div>}
                      </div>
                      <label className="text-gray-400 text-xs block mb-1.5">เงินสดตั้งต้นในลิ้นชัก (บาท)</label>
                      <input
                        type="number" autoFocus
                        value={openShiftAmount}
                        onChange={e => setOpenShiftAmount(e.target.value)}
                        placeholder="0"
                        className="w-full bg-gray-800 text-white text-lg font-bold px-4 py-3 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500 mb-4"
                      />
                      <div className="flex gap-3">
                        <button onClick={() => setOpenShiftStep('pin')} className="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-bold py-3 rounded-xl transition-colors text-sm">← กลับ</button>
                        <button onClick={confirmOpenShift} disabled={openShiftSaving}
                          className="flex-[2] bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-colors text-sm">
                          {openShiftSaving ? 'กำลังเปิดกะ...' : '🔓 เปิดกะ'}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ══ Modal: ปิดกะเงินสด ══════════════════════════════════════════ */}
          {showCloseShiftModal && activeShift && (
            <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-gray-900 rounded-2xl w-full max-w-sm border border-gray-700 shadow-2xl max-h-[90vh] overflow-y-auto">
                <div className="p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-white font-bold">🔒 ปิดกะเงินสด</h3>
                    <button onClick={() => setShowCloseShiftModal(false)} className="text-gray-400 hover:text-white text-2xl leading-none">×</button>
                  </div>

                  {closeShiftResult ? (
                    <>
                      <div className={`rounded-xl p-4 mb-4 ${closeShiftResult.variance === 0 ? 'bg-green-950 border border-green-800' : 'bg-yellow-950 border border-yellow-800'}`}>
                        <div className={`font-bold mb-2 ${closeShiftResult.variance === 0 ? 'text-green-300' : 'text-yellow-300'}`}>
                          {closeShiftResult.variance === 0 ? '✅ ปิดกะสำเร็จ ยอดตรงพอดี' : `⚠️ ปิดกะสำเร็จ — ${closeShiftResult.variance > 0 ? 'เงินเกิน' : 'เงินขาด'} ฿${Math.abs(closeShiftResult.variance).toLocaleString()}`}
                        </div>
                        <div className="text-gray-300 text-sm space-y-1">
                          <div>เงินที่ควรมี: ฿{closeShiftResult.expected_cash.toLocaleString()}</div>
                          <div>นับได้จริง: ฿{closeShiftResult.counted_cash.toLocaleString()}</div>
                          <div>เก็บออกไป: ฿{closeShiftResult.withdrawn_amount.toLocaleString()}</div>
                          <div>ยกไปกะถัดไป: ฿{closeShiftResult.carried_forward.toLocaleString()}</div>
                        </div>
                        {closeShiftResult.notified_owner && (
                          <div className="text-yellow-400 text-xs mt-2">📲 แจ้งเจ้าของร้านทาง LINE แล้ว</div>
                        )}
                      </div>
                      <button onClick={() => setShowCloseShiftModal(false)} className="w-full bg-gray-700 hover:bg-gray-600 text-white font-bold py-3 rounded-xl transition-colors text-sm">ปิดหน้าต่าง</button>
                    </>
                  ) : closeShiftLoading || !closeShiftPreview ? (
                    <div className="text-center text-gray-500 py-8 animate-pulse text-sm">กำลังคำนวณยอด...</div>
                  ) : (
                    <>
                      <div className="bg-gray-800 rounded-xl p-3 mb-4 space-y-1">
                        <div className="text-white font-medium">{activeShift.staff_name}</div>
                        <div className="text-gray-400 text-xs">เปิดกะเมื่อ {closeShiftPreview.opened_at}</div>
                        <div className="text-gray-400 text-xs">เงินสดตั้งต้น ฿{(closeShiftPreview.opening_cash || 0).toLocaleString()}</div>
                        <div className="text-green-400 text-sm font-bold mt-1">เงินสดที่ควรมีตอนนี้: ฿{closeShiftPreview.expected_cash.toLocaleString()}</div>
                      </div>

                      <label className="text-gray-400 text-xs block mb-1.5">เงินสดที่นับได้จริง (บาท)</label>
                      <input
                        type="number" autoFocus
                        value={closeShiftCounted}
                        onChange={e => setCloseShiftCounted(e.target.value)}
                        placeholder="0"
                        className="w-full bg-gray-800 text-white text-lg font-bold px-4 py-3 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500 mb-2"
                      />
                      {closeShiftCounted !== '' && (
                        <div className={`text-xs mb-3 font-medium ${closeShiftVariance === 0 ? 'text-green-400' : closeShiftVariance > 0 ? 'text-blue-400' : 'text-red-400'}`}>
                          {closeShiftVariance === 0 ? '✅ ยอดตรงพอดี' : closeShiftVariance > 0 ? `เงินเกิน ฿${closeShiftVariance.toLocaleString()}` : `เงินขาด ฿${Math.abs(closeShiftVariance).toLocaleString()}`}
                        </div>
                      )}

                      {closeShiftVariance !== 0 && closeShiftCounted !== '' && (
                        <div className="mb-3">
                          <label className="text-yellow-400 text-xs block mb-1.5">⚠️ หมายเหตุ (บังคับ — ยอดไม่ตรง ต้องระบุสาเหตุ)</label>
                          <textarea
                            value={closeShiftNotes}
                            onChange={e => setCloseShiftNotes(e.target.value)}
                            placeholder="เช่น ทอนผิด, ลืมคีย์รายจ่าย ฯลฯ"
                            rows={2}
                            className="w-full bg-gray-800 text-white text-sm px-3 py-2 rounded-xl border border-yellow-800 focus:outline-none focus:border-yellow-500"
                          />
                        </div>
                      )}

                      <label className="text-gray-400 text-xs block mb-1.5">ยอดเก็บออกไป (ฝากธนาคาร/เข้าตู้เซฟ — เว้นว่างได้)</label>
                      <input
                        type="number"
                        value={closeShiftWithdrawn}
                        onChange={e => setCloseShiftWithdrawn(e.target.value)}
                        placeholder="0"
                        className="w-full bg-gray-800 text-white px-3 py-2 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500 mb-2 text-sm"
                      />
                      {closeShiftCounted !== '' && (
                        <div className="text-gray-400 text-xs mb-4">
                          ยกไปกะถัดไป: ฿{Math.max(0, (parseFloat(closeShiftCounted) || 0) - Math.min(parseFloat(closeShiftCounted) || 0, Math.max(0, parseFloat(closeShiftWithdrawn) || 0))).toLocaleString()}
                        </div>
                      )}

                      <div className="flex gap-3">
                        <button onClick={() => setShowCloseShiftModal(false)} className="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-bold py-3 rounded-xl transition-colors text-sm">ยกเลิก</button>
                        <button onClick={confirmCloseShift} disabled={closeShiftSaving || closeShiftCounted === ''}
                          className="flex-[2] bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-colors text-sm">
                          {closeShiftSaving ? 'กำลังปิดกะ...' : '🔒 ปิดกะ'}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ══ Modal: รับเงินหนี้ลูกค้า ══════════════════════════════════════ */}
          {showDebtModal && debtCust && (
            <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-gray-900 rounded-2xl w-full max-w-sm border border-gray-700 shadow-2xl">
                <div className="p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-white font-bold">💵 รับชำระหนี้</h3>
                    <button onClick={() => setShowDebtModal(false)} className="text-gray-400 hover:text-white text-2xl leading-none">×</button>
                  </div>
                  <div className="bg-gray-800 rounded-xl p-3 mb-4">
                    <div className="text-white font-medium">{debtCust.name}</div>
                    <div className="text-red-400 text-sm mt-0.5">ยอดค้างชำระทั้งหมด ฿{(debtCust.debt || 0).toLocaleString()}</div>
                  </div>
                  <div className="mb-4">
                    <label className="text-gray-400 text-xs block mb-1.5">จำนวนเงินที่รับ (บาท)</label>
                    <input
                      type="number"
                      value={debtAmount}
                      onChange={e => setDebtAmount(e.target.value)}
                      className="w-full bg-gray-800 text-white text-lg font-bold px-4 py-3 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500"
                      placeholder="0"
                      autoFocus
                    />
                    {debtAmount && parseFloat(debtAmount) > 0 && (
                      <div className="text-gray-400 text-xs mt-1.5">
                        ยอดที่เหลือ: ฿{Math.max(0, (debtCust.debt || 0) - parseFloat(debtAmount)).toLocaleString()}
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-2 mb-4">
                    {[debtCust.debt, Math.round(debtCust.debt / 2), 100].filter(v => v > 0).map(v => (
                      <button key={v} onClick={() => setDebtAmount(String(v))}
                        className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 py-2 rounded-lg border border-gray-700 transition-colors">
                        ฿{v.toLocaleString()}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-3">
                    <button onClick={() => setShowDebtModal(false)} className="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-bold py-3 rounded-xl transition-colors text-sm">ยกเลิก</button>
                    <button onClick={payDebt} disabled={debtSaving || !debtAmount || parseFloat(debtAmount) <= 0}
                      className="flex-[2] bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-colors text-sm">
                      {debtSaving ? 'กำลังบันทึก...' : `รับ ฿${parseFloat(debtAmount || 0).toLocaleString()}`}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ══ MODAL: คำสั่งซื้อจากลูกค้ารอยืนยัน (หน้าเว็บสาธารณะ /order) ══════════ */}
          {showCustomerOrders && (
            <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-4" onClick={() => setShowCustomerOrders(false)}>
              <div className="bg-gray-900 rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto border border-gray-700" onClick={e => e.stopPropagation()}>
                <div className="p-4 border-b border-gray-800 flex items-center justify-between sticky top-0 bg-gray-900">
                  <h3 className="text-white font-bold">🛒 คำสั่งซื้อจากลูกค้ารอยืนยัน</h3>
                  <button onClick={() => setShowCustomerOrders(false)} className="text-gray-400 hover:text-white text-xl leading-none">✕</button>
                </div>
                <div className="p-4">
                  {customerOrdersLoading ? (
                    <div className="text-center text-gray-500 py-8 animate-pulse">กำลังโหลด...</div>
                  ) : customerOrders.length === 0 ? (
                    <div className="text-center text-gray-500 py-12 text-sm">
                      <div className="text-3xl mb-2">📭</div>
                      ยังไม่มีคำสั่งซื้อจากลูกค้ารอยืนยัน
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {customerOrders.map(order => (
                        <div key={order.order_no} className="bg-gray-800 rounded-xl p-3">
                          <div className="flex items-start justify-between gap-2 mb-1.5">
                            <div className="min-w-0">
                              <div className="text-white font-medium text-sm">{order.customer_name}</div>
                              <div className="text-gray-400 text-xs">📞 {order.phone}</div>
                              <div className="text-gray-500 text-xs mt-0.5">📍 {order.address}{order.branch ? ` (${order.branch})` : ''}</div>
                            </div>
                            <div className="text-green-400 font-bold text-sm shrink-0">฿{order.total.toLocaleString()}</div>
                          </div>
                          <div className="text-gray-500 text-xs mt-1">{(order.items || []).map(i => `${i.name}×${i.qty}`).join(', ')}</div>
                          <div className="text-gray-500 text-xs mt-0.5">💳 {order.payment_method}{order.notes ? ` — ${order.notes}` : ''}</div>
                          <div className="flex gap-2 mt-2.5">
                            <button onClick={() => rejectCustomerOrder(order)}
                              className="flex-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 py-2 rounded-lg transition-colors">ปฏิเสธ</button>
                            <button onClick={() => { setConfirmingCustomerOrder(order); setConfirmOrderStaffId(''); }}
                              className="flex-[2] text-xs bg-green-700 hover:bg-green-600 text-white font-bold py-2 rounded-lg transition-colors">✅ ยืนยันเป็นออเดอร์จัดส่ง</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ══ MODAL: เลือกพนักงานส่ง เพื่อยืนยันคำสั่งซื้อจากลูกค้า ══════════════ */}
          {confirmingCustomerOrder && (
            <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-4" onClick={() => setConfirmingCustomerOrder(null)}>
              <div className="bg-gray-900 rounded-2xl w-full max-w-sm border border-gray-700" onClick={e => e.stopPropagation()}>
                <div className="p-4 border-b border-gray-800 flex items-center justify-between">
                  <h3 className="text-white font-bold text-sm">เลือกพนักงานส่ง</h3>
                  <button onClick={() => setConfirmingCustomerOrder(null)} className="text-gray-400 hover:text-white text-xl leading-none">✕</button>
                </div>
                <div className="p-4">
                  <div className="grid grid-cols-2 gap-2 mb-4">
                    {staff.map(s => (
                      <button key={s.staff_id} onClick={() => setConfirmOrderStaffId(s.staff_id)}
                        className={`py-3 rounded-xl text-sm font-medium border transition-colors ${confirmOrderStaffId === s.staff_id ? 'bg-green-700 border-green-600 text-white' : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'}`}>
                        {s.name}
                        {!s.line_id && <div className="text-[10px] text-yellow-500 mt-0.5">⚠️ ไม่มี LINE ID</div>}
                      </button>
                    ))}
                    {!staff.length && <div className="col-span-2 text-gray-500 text-xs text-center py-4">ยังไม่มีพนักงานในระบบ — เพิ่มได้ที่แท็บตั้งค่า</div>}
                  </div>
                  <button onClick={submitCustomerOrderConfirm} disabled={!confirmOrderStaffId || confirmOrderSubmitting}
                    className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-colors">
                    {confirmOrderSubmitting ? 'กำลังสร้างออเดอร์...' : '✅ ยืนยันสร้างออเดอร์จัดส่ง'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ══ MODAL: ส่งพนักงานไปเก็บเงินเชื่อ/สินค้ายืม ══════════════════════ */}
          {showCollectDispatch && collectDispatchCust && (
            <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-gray-900 rounded-2xl w-full max-w-sm border border-gray-700 shadow-2xl max-h-[90vh] overflow-y-auto">
                <div className="p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-white font-bold">📤 ส่งพนักงานไปเก็บ</h3>
                    <button onClick={() => setShowCollectDispatch(false)} className="text-gray-400 hover:text-white text-2xl leading-none">×</button>
                  </div>
                  <div className="bg-gray-800 rounded-xl p-3 mb-4">
                    <div className="text-white font-medium">{collectDispatchCust.name}</div>
                    {collectDispatchCust.phone && <div className="text-gray-400 text-xs">{collectDispatchCust.phone}</div>}
                  </div>

                  <label className="block text-gray-400 text-xs mb-1.5">ประเภทงาน</label>
                  <div className="grid grid-cols-3 gap-2 mb-4">
                    {['เงินเชื่อ', 'สินค้ายืม', 'ทั้งคู่'].map(t => (
                      <button key={t} onClick={() => setCollectDispatchForm(f => ({ ...f, task_type: t }))}
                        className={`py-2 rounded-xl text-xs font-medium transition-colors ${collectDispatchForm.task_type === t ? 'bg-orange-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}>
                        {t}
                      </button>
                    ))}
                  </div>

                  {collectDispatchForm.task_type !== 'สินค้ายืม' && (
                    <div className="mb-4">
                      <label className="block text-gray-400 text-xs mb-1.5">ยอดเงินเชื่อที่ต้องเก็บ (บาท)</label>
                      <input type="number" min="0" value={collectDispatchForm.debt_amount}
                        onChange={e => setCollectDispatchForm(f => ({ ...f, debt_amount: e.target.value }))}
                        className="w-full bg-gray-800 text-white text-sm px-4 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500" />
                    </div>
                  )}

                  {collectDispatchForm.task_type !== 'เงินเชื่อ' && (
                    <div className="mb-4">
                      <label className="block text-gray-400 text-xs mb-1.5">สินค้าหมุนเวียนที่ต้องเก็บคืน (ตรวจสอบให้ตรงกับที่ลูกค้าถืออยู่จริง)</label>
                      {collectDispatchForm.itemsUnreconciled && (
                        <div className="text-amber-400 text-[11px] mb-2">
                          ⚠️ ระบบแยกไม่ได้ว่าลูกค้าถือสินค้าชนิดไหนกี่ชิ้น — รวมทั้งหมด {collectDispatchCust.cylinders} ชิ้น กรุณาระบุแยกตามชนิดสินค้าด้านล่างให้ครบ
                        </div>
                      )}
                      <div className="space-y-2">
                        {products.filter(p => p.type === 'หมุนเวียน').map(p => (
                          <div key={p.sku} className="flex items-center justify-between gap-2 bg-gray-800 rounded-xl px-3 py-2">
                            <span className="text-gray-300 text-sm flex-1 truncate">{p.name}</span>
                            <input type="number" min="0" value={collectDispatchForm.itemsQty[p.sku] || ''}
                              onChange={e => setCollectDispatchForm(f => ({ ...f, itemsQty: { ...f.itemsQty, [p.sku]: e.target.value } }))}
                              placeholder="0"
                              className="w-16 bg-gray-900 text-white text-sm text-center px-2 py-1.5 rounded-lg border border-gray-700 focus:outline-none focus:border-green-500" />
                          </div>
                        ))}
                        {products.filter(p => p.type === 'หมุนเวียน').length === 0 && (
                          <div className="text-gray-500 text-xs">ยังไม่มีสินค้าประเภทหมุนเวียนในร้าน</div>
                        )}
                      </div>
                    </div>
                  )}

                  <label className="block text-gray-400 text-xs mb-1.5">พนักงานที่จะไปเก็บ</label>
                  <div className="grid grid-cols-2 gap-2 mb-4">
                    {staff.map(s => (
                      <button key={s.staff_id}
                        onClick={() => setCollectDispatchForm(f => ({ ...f, staff_id: s.staff_id, staff_name: s.name, staff_line_id: s.line_id || '' }))}
                        className={`p-3 rounded-xl border text-sm text-left transition-colors ${collectDispatchForm.staff_id === s.staff_id ? 'bg-orange-900/40 border-orange-600 text-orange-200' : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'}`}>
                        <div className="font-medium">{s.name}</div>
                        <div className="text-xs mt-0.5 text-gray-500">{s.role}</div>
                        {!s.line_id && <div className="text-xs text-yellow-500 mt-0.5">⚠️ ไม่มี LINE ID</div>}
                      </button>
                    ))}
                    {staff.length === 0 && (
                      <div className="col-span-2 bg-gray-800 rounded-xl p-3 text-center text-sm text-yellow-400">
                        ยังไม่มีพนักงาน —{' '}
                        <button onClick={() => { setShowCollectDispatch(false); setTab('settings'); }} className="underline">เพิ่มพนักงาน</button>
                      </div>
                    )}
                  </div>

                  <label className="block text-gray-400 text-xs mb-1.5">หมายเหตุ (ไม่บังคับ)</label>
                  <input value={collectDispatchForm.notes}
                    onChange={e => setCollectDispatchForm(f => ({ ...f, notes: e.target.value }))}
                    placeholder="เช่น นัดลูกค้าไว้ช่วงบ่าย"
                    className="w-full bg-gray-800 text-white text-sm px-4 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500 mb-4" />

                  <div className="flex gap-3">
                    <button onClick={() => setShowCollectDispatch(false)} className="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-bold py-3 rounded-xl transition-colors text-sm">ยกเลิก</button>
                    <button onClick={submitCollectDispatch} disabled={collectDispatching || !collectDispatchForm.staff_id}
                      className="flex-[2] bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-colors text-sm">
                      {collectDispatching ? 'กำลังส่งงาน...' : '📤 ส่งงาน'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ══ TAB: ผู้ติดต่อ ════════════════════════════════════════════ */}
          {tab === 'contacts' && (
            <div className="h-full overflow-y-auto">
              <div className="p-4 max-w-2xl mx-auto">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-white font-bold">ผู้ติดต่อ ({contacts.length})</h2>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setShowImportModal(true)}
                      className="bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm px-3 py-2 rounded-xl transition-colors">
                      📥 นำเข้า
                    </button>
                    <button onClick={exportContactsCsv}
                      className="bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm px-3 py-2 rounded-xl transition-colors">
                      📤 ส่งออก
                    </button>
                    <button onClick={openAddContact} className="bg-green-600 hover:bg-green-500 text-white text-sm font-bold px-4 py-2 rounded-xl transition-colors">
                      + เพิ่ม
                    </button>
                  </div>
                </div>

                {/* search */}
                <div className="relative mb-3">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">🔍</span>
                  <input
                    type="text"
                    value={contactSearch}
                    onChange={e => setContactSearch(e.target.value)}
                    placeholder="ค้นหาชื่อ เบอร์ บริษัท..."
                    className="w-full bg-gray-800 text-white text-sm pl-9 pr-4 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500 placeholder-gray-600"
                  />
                  {contactSearch && (
                    <button onClick={() => setContactSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">✕</button>
                  )}
                </div>

                {/* filter */}
                <div className="flex gap-2 mb-4 flex-wrap">
                  {['ทั้งหมด', 'ผู้จำหน่าย', 'ลูกค้า', 'ทั้งคู่'].map(f => (
                    <button key={f} onClick={() => setContactFilter(f)}
                      className={`px-4 py-1.5 rounded-full text-xs font-medium transition-colors ${
                        contactFilter === f ? 'bg-green-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                      }`}
                    >{f}</button>
                  ))}
                  <button onClick={() => setContactOutstandingOnly(v => !v)}
                    className={`px-4 py-1.5 rounded-full text-xs font-medium transition-colors ${
                      contactOutstandingOnly ? 'bg-red-700 text-white' : 'bg-gray-800 text-red-300 hover:bg-gray-700'
                    }`}
                  >🧾 ยอดค้างชำระ/ค้างสินค้า</button>
                  {contactSearch && (
                    <span className="px-3 py-1.5 bg-blue-900/40 text-blue-400 text-xs rounded-full">
                      {displayContacts.length} รายการ
                    </span>
                  )}
                </div>

                {contactOutstandingOnly && !contactsLoading && (
                  <div className="bg-gray-900 rounded-xl p-3 mb-4 flex flex-wrap gap-4 border border-gray-800">
                    <div>
                      <div className="text-red-400 font-bold">฿{displayContacts.reduce((s, c) => s + (c.debt || 0), 0).toLocaleString()}</div>
                      <div className="text-gray-500 text-xs">ยอดค้างชำระรวม ({displayContacts.filter(c => c.debt > 0).length} ราย)</div>
                    </div>
                    <div>
                      <div className="text-orange-400 font-bold">{displayContacts.reduce((s, c) => s + (c.cylinders || 0), 0).toLocaleString()} ถัง</div>
                      <div className="text-gray-500 text-xs">ถังค้างที่ลูกค้ารวม ({displayContacts.filter(c => c.cylinders > 0).length} ราย)</div>
                    </div>
                  </div>
                )}

                {contactsLoading ? (
                  <div className="text-center text-gray-500 py-12 animate-pulse">กำลังโหลด...</div>
                ) : displayContacts.length === 0 ? (
                  <div className="text-center py-16">
                    <div className="text-5xl mb-3">👥</div>
                    <p className="text-gray-400 text-sm mb-4">ยังไม่มีผู้ติดต่อ</p>
                    <button onClick={openAddContact} className="bg-green-600 text-white text-sm font-bold px-6 py-2.5 rounded-xl hover:bg-green-500 transition-colors">
                      + เพิ่มผู้ติดต่อแรก
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {pagedContacts.map(c => (
                      <div key={c.contact_id} className="bg-gray-800 rounded-xl p-4">
                        <div className="flex items-start gap-3">
                          <div className="text-xl mt-0.5 shrink-0">
                            {c.contact_type === 'ผู้จำหน่าย' ? '🏢' : c.contact_type === 'ทั้งคู่' ? '🤝' : '👤'}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-white font-medium text-sm">{c.name}</span>
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                c.contact_type === 'ผู้จำหน่าย' ? 'bg-blue-900 text-blue-300'
                                : c.contact_type === 'ทั้งคู่' ? 'bg-teal-900 text-teal-300'
                                : 'bg-purple-900 text-purple-300'
                              }`}>{c.contact_type}</span>
                              {c.person_type === 'นิติบุคคล' && <span className="text-xs bg-blue-900/60 text-blue-300 px-2 py-0.5 rounded-full">🏢 นิติบุคคล</span>}
                              {c.debt > 0 && <span className="text-xs bg-red-900/60 text-red-300 px-2 py-0.5 rounded-full">ค้าง ฿{c.debt.toLocaleString()}</span>}
                              {c.cylinders > 0 && <span className="text-xs bg-orange-900/60 text-orange-300 px-2 py-0.5 rounded-full">ถัง {c.cylinders}</span>}
                            </div>
                            {c.company_name && <div className="text-gray-400 text-xs mt-0.5">🏛️ {c.company_name}</div>}
                            {c.shop_name && <div className="text-gray-400 text-xs mt-0.5">🏪 {c.shop_name}</div>}
                            {c.phone && <div className="text-gray-400 text-xs mt-0.5">📞 {c.phone}</div>}
                            {c.person_type === 'นิติบุคคล' && c.contact_person_name && (
                              <div className="text-gray-500 text-xs mt-0.5">👤 ผู้ติดต่อ: {c.contact_person_name}{c.contact_person_phone ? ` · ${c.contact_person_phone}` : ''}</div>
                            )}
                            {c.address_1 && <div className="text-gray-500 text-xs mt-0.5 truncate">📍 {c.address_1}</div>}
                            {c.aliases && <div className="text-gray-600 text-xs mt-0.5">🔍 {c.aliases}</div>}
                          </div>
                          <div className="flex flex-col gap-1.5 shrink-0">
                            <button onClick={() => openEditContact(c)} className="text-xs bg-gray-700 hover:bg-blue-700 text-gray-300 hover:text-white px-3 py-1.5 rounded-lg transition-colors">แก้ไข</button>
                            <button onClick={() => { setQrContact(c); setShowQrModal(true); }} className="text-xs bg-gray-700 hover:bg-purple-800 text-gray-300 hover:text-purple-300 px-3 py-1.5 rounded-lg transition-colors">QR</button>
                            <button onClick={() => deleteContact(c)} className="text-xs bg-gray-700 hover:bg-red-700 text-gray-300 hover:text-white px-3 py-1.5 rounded-lg transition-colors">ลบ</button>
                          </div>
                        </div>
                        {(c.maps_1 || c.maps_2 || c.debt > 0 || c.cylinders > 0) && (
                          <div className="flex gap-2 mt-2.5 ml-9 flex-wrap">
                            {c.maps_1 && <a href={c.maps_1} target="_blank" rel="noreferrer" className="text-xs bg-gray-700 hover:bg-green-800 text-gray-300 hover:text-green-300 px-3 py-1.5 rounded-lg transition-colors">🗺️ ที่อยู่ 1</a>}
                            {c.maps_2 && <a href={c.maps_2} target="_blank" rel="noreferrer" className="text-xs bg-gray-700 hover:bg-green-800 text-gray-300 hover:text-green-300 px-3 py-1.5 rounded-lg transition-colors">🗺️ ที่อยู่ 2</a>}
                            {c.debt > 0 && (
                              <>
                                <button onClick={() => openDebtHistory(c)} className="text-xs bg-orange-900/50 hover:bg-orange-900 text-orange-400 hover:text-orange-300 px-3 py-1.5 rounded-lg transition-colors">📋 ประวัติหนี้</button>
                                <button onClick={() => { setDebtCust(c); setDebtAmount(''); setShowDebtModal(true); }} className="text-xs bg-green-800 hover:bg-green-700 text-green-300 hover:text-green-200 px-3 py-1.5 rounded-lg transition-colors">💰 รับชำระ</button>
                              </>
                            )}
                            {(c.debt > 0 || c.cylinders > 0) && hasFeature(shopInfo?.subscription_tier, 'credit_ar') && (
                              <button onClick={() => openCollectDispatch(c)} className="text-xs bg-orange-800 hover:bg-orange-700 text-orange-200 hover:text-white px-3 py-1.5 rounded-lg transition-colors">📤 ส่งพนักงานไปเก็บ</button>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* pagination — 20 รายชื่อต่อหน้า */}
                {displayContacts.length > CONTACTS_PER_PAGE && (
                  <div className="flex items-center justify-between mt-4">
                    <button onClick={() => setContactPage(p => Math.max(1, p - 1))} disabled={contactPage <= 1}
                      className="text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-30 disabled:hover:bg-gray-800 text-gray-300 px-3 py-2 rounded-lg transition-colors">← ก่อนหน้า</button>
                    <span className="text-gray-500 text-xs">หน้า {contactPage} / {contactTotalPages} ({displayContacts.length} รายการ)</span>
                    <button onClick={() => setContactPage(p => Math.min(contactTotalPages, p + 1))} disabled={contactPage >= contactTotalPages}
                      className="text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-30 disabled:hover:bg-gray-800 text-gray-300 px-3 py-2 rounded-lg transition-colors">ถัดไป →</button>
                  </div>
                )}

                {/* hint for LINE bot */}
                <div className="mt-6 bg-blue-900/20 border border-blue-800 rounded-xl p-4">
                  <p className="text-blue-300 text-xs font-medium mb-1">💡 เชื่อมกับ LINE Bot</p>
                  <p className="text-blue-400 text-xs">
                    ใส่ "คำค้น/aliases" ของผู้จำหน่าย เช่น ชื่อย่อ ชื่อบริษัทบนบิล — บอท LINE จะจับคู่สลิปซื้อของอัตโนมัติ
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ══ TAB: รายงาน ════════════════════════════════════════════════ */}
          {tab === 'report' && (
            <div className="h-full overflow-y-auto">
              <div className="p-4 max-w-4xl mx-auto space-y-4">

                {/* ── ตัวกรองวันที่ + shortcuts ── */}
                <div className="bg-gray-900 rounded-2xl p-4 space-y-3">
                  <div className="flex flex-wrap gap-2 items-end">
                    <div>
                      <label className="block text-gray-400 text-xs mb-1">ตั้งแต่วันที่</label>
                      <input type="date" value={reportDateFrom}
                        onChange={e => setReportDateFrom(e.target.value)}
                        className="bg-gray-800 text-white text-sm px-3 py-2 rounded-lg border border-gray-700 focus:outline-none focus:border-green-500"/>
                    </div>
                    <div>
                      <label className="block text-gray-400 text-xs mb-1">ถึงวันที่</label>
                      <input type="date" value={reportDateTo}
                        onChange={e => setReportDateTo(e.target.value)}
                        className="bg-gray-800 text-white text-sm px-3 py-2 rounded-lg border border-gray-700 focus:outline-none focus:border-green-500"/>
                    </div>
                    <button onClick={() => fetchReport(reportType, reportDateFrom, reportDateTo)}
                      className="bg-green-700 hover:bg-green-600 text-white text-sm font-bold px-4 py-2 rounded-lg transition-colors">
                      🔍 โหลด
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { label: 'วันนี้', fn: () => { const t = today; setReportDateFrom(t); setReportDateTo(t); fetchReport(reportType, t, t); } },
                      { label: '7 วัน', fn: () => { const f = new Date(); f.setDate(f.getDate()-6); const fs = f.toISOString().slice(0,10); setReportDateFrom(fs); setReportDateTo(today); fetchReport(reportType, fs, today); } },
                      { label: 'เดือนนี้', fn: () => { const f = new Date(); f.setDate(1); const fs = f.toISOString().slice(0,10); setReportDateFrom(fs); setReportDateTo(today); fetchReport(reportType, fs, today); } },
                      { label: 'ปีนี้', fn: () => { const f = `${new Date().getFullYear()}-01-01`; setReportDateFrom(f); setReportDateTo(today); fetchReport(reportType, f, today); } },
                      { label: 'ทั้งหมด', fn: () => { setReportDateFrom(''); setReportDateTo(''); fetchReport(reportType, '', ''); } },
                    ].map(b => (
                      <button key={b.label} onClick={b.fn}
                        className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded-lg border border-gray-700 transition-colors">
                        {b.label}
                      </button>
                    ))}
                    <button onClick={() => setShowExportModal(true)}
                      className="ml-auto text-xs bg-blue-800 hover:bg-blue-700 text-blue-200 px-3 py-1.5 rounded-lg border border-blue-700 transition-colors flex items-center gap-1">
                      📤 Export Excel
                    </button>
                  </div>
                </div>

                {/* ── ประเภทรายงาน ── */}
                <div className="flex flex-wrap gap-2">
                  {[
                    { key: 'sales',      label: '💰 ยอดขาย' },
                    { key: 'inventory',  label: '📦 สินค้าคงเหลือ' },
                    { key: 'credit',     label: '💳 เงินเชื่อ' },
                    { key: 'loans',      label: '🏷️ ยืมสินค้า' },
                    { key: 'topsellers', label: '🏆 สินค้าขายดี' },
                    { key: 'pl',         label: '📈 กำไร-ขาดทุน' },
                    { key: 'cyclical',   label: '🔄 สินค้าหมุนเวียน' },
                    { key: 'vat',        label: '🧾 ภาษี VAT' },
                    { key: 'expenses',   label: '💸 รายจ่าย' },
                    // ซ่อนแท็บนี้จนกว่าทนายจะยืนยันเรื่อง anti-trust/price-signaling (ดู CLAUDE.md ข้อ 30)
                    // — ข้อมูลเบื้องหลังยังสะสมอยู่ปกติ แค่ไม่โชว์ให้ร้านเห็นจนกว่า MARKET_PRICE_FEATURE_LIVE เป็น true
                    ...(MARKET_PRICE_FEATURE_LIVE ? [{ key: 'fraud', label: '🚩 ราคาผิดปกติ' }] : []),
                  ].map(r => (
                    <button key={r.key}
                      onClick={() => { setReportType(r.key); fetchReport(r.key, reportDateFrom, reportDateTo); }}
                      className={`text-sm px-4 py-2 rounded-xl font-medium transition-colors ${reportType === r.key ? 'bg-green-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}>
                      {r.label}
                    </button>
                  ))}
                </div>

                {reportLoading && <div className="text-center text-gray-500 py-12 animate-pulse">กำลังโหลดรายงาน...</div>}

                {/* ── ยอดขาย (bank-statement) ── */}
                {!reportLoading && reportData?.type === 'sales' && (() => {
                  const s = reportData.summary;
                  return (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {[
                          { label: 'รายรับรวม', value: `฿${(s.total_income||0).toLocaleString()}`, color: 'text-green-400' },
                          { label: 'เงินสด', value: `฿${(s.cash||0).toLocaleString()}`, color: 'text-yellow-400' },
                          { label: 'โอน', value: `฿${(s.transfer||0).toLocaleString()}`, color: 'text-blue-400' },
                          { label: 'เชื่อ', value: `฿${(s.credit||0).toLocaleString()}`, color: 'text-orange-400' },
                          { label: 'ค้างรับ', value: `฿${(s.pending||0).toLocaleString()}`, color: 'text-red-400' },
                          { label: 'บิลทั้งหมด', value: `${s.count} บิล`, color: 'text-gray-300' },
                        ].map(c => (
                          <div key={c.label} className="bg-gray-800 rounded-xl p-3 text-center">
                            <div className={`text-lg font-bold ${c.color}`}>{c.value}</div>
                            <div className="text-gray-400 text-xs mt-1">{c.label}</div>
                          </div>
                        ))}
                      </div>
                      <div className="bg-gray-900 rounded-xl overflow-hidden">
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead><tr className="border-b border-gray-800">
                              <th className="text-left text-gray-400 px-3 py-2">วันที่</th>
                              <th className="text-left text-gray-400 px-3 py-2">เลขบิล</th>
                              <th className="text-left text-gray-400 px-3 py-2">รายการ</th>
                              <th className="text-left text-gray-400 px-3 py-2">ลูกค้า</th>
                              <th className="text-right text-gray-400 px-3 py-2">รายรับ</th>
                              <th className="text-left text-gray-400 px-3 py-2">ชำระ</th>
                              <th className="text-right text-gray-400 px-3 py-2">ยอดสะสม</th>
                              <th className="text-center text-gray-400 px-3 py-2"></th>
                            </tr></thead>
                            <tbody>
                              {(reportData.statement || []).map((s, i) => (
                                <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                                  <td className="px-3 py-2 text-gray-400 whitespace-nowrap">{s.created_at?.split(',')[0]}</td>
                                  <td className="px-3 py-2 text-gray-300 font-mono text-[10px]">{s.bill_no}</td>
                                  <td className="px-3 py-2 text-gray-400">{(s.items||[]).map(i=>i.name+'×'+i.qty).join(', ').slice(0,30)}</td>
                                  <td className="px-3 py-2 text-gray-400">{s.customer_name || '—'}</td>
                                  <td className="px-3 py-2 text-right text-green-400 font-medium">{s.income > 0 ? `฿${s.income.toLocaleString()}` : <span className="text-gray-600">—</span>}</td>
                                  <td className="px-3 py-2">
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${s.payment_method === 'เชื่อ' ? 'bg-orange-900/60 text-orange-300' : s.payment_method === 'โอน' ? 'bg-blue-900/60 text-blue-300' : 'bg-yellow-900/60 text-yellow-300'}`}>{s.payment_method}</span>
                                  </td>
                                  <td className="px-3 py-2 text-right text-white font-mono">฿{(s.balance||0).toLocaleString()}</td>
                                  <td className="px-3 py-2 text-center">
                                    <button onClick={() => cancelBill(s.bill_no)}
                                      className="text-red-400 hover:text-red-300 text-[10px] border border-red-900 px-2 py-1 rounded-lg transition-colors">
                                      ยกเลิก
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {!reportData.statement?.length && <div className="text-center text-gray-500 py-8 text-sm">ไม่มีข้อมูลในช่วงเวลานี้</div>}
                      </div>
                    </div>
                  );
                })()}

                {/* ── สินค้าคงเหลือ ── */}
                {!reportLoading && reportData?.type === 'inventory' && (() => {
                  const s = reportData.summary;
                  return (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {[
                          { label: 'สินค้าทั้งหมด', value: s.total_products + ' รายการ', color: 'text-blue-400' },
                          { label: 'มูลค่าสต็อค (ทุน)', value: `฿${(s.total_cost_value||0).toLocaleString()}`, color: 'text-green-400' },
                          { label: 'มูลค่าขาย', value: `฿${(s.total_retail_value||0).toLocaleString()}`, color: 'text-purple-400' },
                          { label: 'ใกล้หมด/หมด', value: `${s.low_stock_count}/${s.out_of_stock}`, color: 'text-red-400' },
                        ].map(c => (
                          <div key={c.label} className="bg-gray-800 rounded-xl p-3 text-center">
                            <div className={`text-lg font-bold ${c.color}`}>{c.value}</div>
                            <div className="text-gray-400 text-xs mt-1">{c.label}</div>
                          </div>
                        ))}
                      </div>
                      {reportData.low_stock?.length > 0 && (
                        <div className="bg-red-900/20 border border-red-800/50 rounded-xl p-3">
                          <p className="text-red-400 text-xs font-bold mb-2">⚠️ สินค้าใกล้หมด/หมด</p>
                          <div className="flex flex-wrap gap-2">
                            {reportData.low_stock.map(p => (
                              <span key={p.sku} className="text-xs bg-red-900/40 text-red-300 px-2 py-1 rounded-lg">
                                {p.name} ({p.stock} {p.unit})
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="bg-gray-900 rounded-xl overflow-hidden">
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead><tr className="border-b border-gray-800">
                              <th className="text-left text-gray-400 px-3 py-2">ชื่อสินค้า</th>
                              <th className="text-left text-gray-400 px-3 py-2">หมวด</th>
                              <th className="text-right text-gray-400 px-3 py-2">สต็อค</th>
                              <th className="text-right text-gray-400 px-3 py-2">ราคาทุน</th>
                              <th className="text-right text-gray-400 px-3 py-2">ราคาขาย</th>
                              <th className="text-right text-gray-400 px-3 py-2">มูลค่า</th>
                            </tr></thead>
                            <tbody>
                              {(reportData.products||[]).map((p, i) => (
                                <tr key={i} className={`border-b border-gray-800/50 ${p.stock <= 0 ? 'bg-red-900/10' : p.stock <= 5 ? 'bg-yellow-900/10' : ''}`}>
                                  <td className="px-3 py-2 text-white font-medium">{p.name}</td>
                                  <td className="px-3 py-2 text-gray-400">{p.category || '—'}</td>
                                  <td className={`px-3 py-2 text-right font-bold ${p.stock <= 0 ? 'text-red-400' : p.stock <= 5 ? 'text-yellow-400' : 'text-green-400'}`}>{p.stock} {p.unit}</td>
                                  <td className="px-3 py-2 text-right text-gray-400">฿{p.cost.toLocaleString()}</td>
                                  <td className="px-3 py-2 text-right text-gray-300">฿{p.price.toLocaleString()}</td>
                                  <td className="px-3 py-2 text-right text-blue-400">฿{(p.cost*p.stock).toLocaleString()}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* ── เงินเชื่อ ── */}
                {!reportLoading && reportData?.type === 'credit' && (() => {
                  const s = reportData.summary;
                  return (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {[
                          { label: 'ยอดค้างชำระ', value: `฿${(s.outstanding||0).toLocaleString()}`, color: 'text-red-400' },
                          { label: 'ชำระแล้ว', value: `฿${(s.paid||0).toLocaleString()}`, color: 'text-green-400' },
                          { label: 'บิลทั้งหมด', value: s.total_bills + ' บิล', color: 'text-blue-400' },
                          { label: 'จำนวนลูกค้า', value: s.customer_count + ' ราย', color: 'text-purple-400' },
                        ].map(c => (
                          <div key={c.label} className="bg-gray-800 rounded-xl p-3 text-center">
                            <div className={`text-lg font-bold ${c.color}`}>{c.value}</div>
                            <div className="text-gray-400 text-xs mt-1">{c.label}</div>
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        {['ทั้งหมด','ค้างชำระ','ชำระแล้ว'].map(st => (
                          <button key={st} onClick={() => { setReportStatusFilter(st); fetchReport('credit', reportDateFrom, reportDateTo, reportBranch, st); }}
                            className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${reportStatusFilter===st ? 'bg-green-700 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>{st}</button>
                        ))}
                      </div>
                      <div className="space-y-3">
                        {(reportData.customers||[]).map((cust, i) => (
                          <div key={i} className="bg-gray-900 rounded-xl overflow-hidden border border-gray-800">
                            <button className="w-full p-4 flex items-center justify-between text-left"
                              onClick={() => setExpandedCredit(expandedCredit === cust.customer_name ? null : cust.customer_name)}>
                              <div>
                                <div className="text-white font-bold text-sm">{cust.customer_name}</div>
                                <div className="text-gray-500 text-xs">{cust.bills?.length} บิล</div>
                              </div>
                              <div className="text-right">
                                {cust.outstanding > 0 && <div className="text-red-400 font-bold text-sm">ค้าง ฿{cust.outstanding.toLocaleString()}</div>}
                                {cust.paid > 0 && <div className="text-green-400 text-xs">ชำระแล้ว ฿{cust.paid.toLocaleString()}</div>}
                              </div>
                            </button>
                            {expandedCredit === cust.customer_name && (
                              <div className="border-t border-gray-800 divide-y divide-gray-800/50">
                                {(cust.bills||[]).map((bill, j) => (
                                  <div key={j} className="px-4 py-3 flex items-center justify-between">
                                    <div>
                                      <div className="text-gray-300 text-xs font-mono">
                                        {bill.bill_no}{' '}
                                        <span className={`px-1.5 py-0.5 rounded-full ${bill.source === 'delivery' ? 'bg-orange-900/60 text-orange-300' : 'bg-blue-900/60 text-blue-300'}`}>
                                          {bill.source === 'delivery' ? '🚚 จัดส่ง' : '🏪 หน้าร้าน'}
                                        </span>
                                      </div>
                                      <div className="text-gray-500 text-xs">{bill.created_at?.split(',')[0]}</div>
                                      <div className="text-gray-500 text-xs">{(bill.items||[]).map(i=>i.name+'×'+i.qty).join(', ')}</div>
                                    </div>
                                    <div className="text-right flex flex-col items-end gap-1">
                                      <div className="text-white font-bold text-sm">฿{bill.total.toLocaleString()}</div>
                                      <span className={`text-xs px-2 py-0.5 rounded-full ${bill.status==='ค้างชำระ' ? 'bg-red-900/60 text-red-300' : 'bg-green-900/60 text-green-300'}`}>{bill.status}</span>
                                      {bill.status === 'ค้างชำระ' && (
                                        <button onClick={() => markCreditPaid(bill.bill_no, bill.source)}
                                          className="text-xs bg-green-700 hover:bg-green-600 text-white px-2 py-0.5 rounded-lg transition-colors">
                                          ✅ รับชำระ
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                        {!reportData.customers?.length && <div className="text-center text-gray-500 py-8 text-sm">ไม่มีรายการเงินเชื่อในช่วงเวลานี้</div>}
                      </div>
                    </div>
                  );
                })()}

                {/* ── ยืมสินค้า ── */}
                {!reportLoading && reportData?.type === 'loans' && (() => {
                  const s = reportData.summary;
                  return (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 flex-1 mr-3">
                          {[
                            { label: 'ยืมอยู่', value: s.active + ' รายการ', color: 'text-orange-400' },
                            { label: 'เกินกำหนด', value: s.overdue + ' รายการ', color: 'text-red-400' },
                            { label: 'คืนแล้ว', value: s.returned + ' รายการ', color: 'text-green-400' },
                            { label: 'ทั้งหมด', value: s.total + ' รายการ', color: 'text-gray-300' },
                          ].map(c => (
                            <div key={c.label} className="bg-gray-800 rounded-xl p-3 text-center">
                              <div className={`text-lg font-bold ${c.color}`}>{c.value}</div>
                              <div className="text-gray-400 text-xs mt-1">{c.label}</div>
                            </div>
                          ))}
                        </div>
                        <button onClick={() => setShowLoanForm(true)}
                          className="shrink-0 bg-green-700 hover:bg-green-600 text-white text-sm font-bold px-4 py-3 rounded-xl transition-colors whitespace-nowrap">
                          + บันทึกยืม
                        </button>
                      </div>
                      <div className="flex gap-2">
                        {['ทั้งหมด','ยืมอยู่','คืนแล้ว'].map(st => (
                          <button key={st} onClick={() => { setReportStatusFilter(st); fetchReport('loans', reportDateFrom, reportDateTo, reportBranch, st === 'ทั้งหมด' ? '' : st); }}
                            className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${reportStatusFilter===st ? 'bg-green-700 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>{st}</button>
                        ))}
                      </div>
                      <div className="space-y-3">
                        {(reportData.loans||[]).map((loan, i) => {
                          const isOverdue = loan.status === 'ยืมอยู่' && loan.due_date && new Date(loan.due_date) < new Date();
                          return (
                            <div key={i} className={`bg-gray-900 rounded-xl overflow-hidden border ${isOverdue ? 'border-red-800' : 'border-gray-800'}`}>
                              <button className="w-full p-4 flex items-center justify-between text-left"
                                onClick={() => setExpandedLoan(expandedLoan === loan.loan_no ? null : loan.loan_no)}>
                                <div>
                                  <div className="text-white font-bold text-sm">{loan.contact_name}</div>
                                  <div className="text-gray-500 text-xs">{loan.contact_phone} · {loan.created_at?.split(',')[0]}</div>
                                  <div className="text-gray-400 text-xs mt-0.5">{(loan.items||[]).map(i=>i.name+'×'+i.qty+(i.unit||'')).join(', ')}</div>
                                </div>
                                <div className="text-right">
                                  <span className={`text-xs px-2 py-0.5 rounded-full ${isOverdue ? 'bg-red-900/60 text-red-300' : loan.status==='คืนแล้ว' ? 'bg-green-900/60 text-green-300' : 'bg-orange-900/60 text-orange-300'}`}>
                                    {isOverdue ? '⚠️ เกินกำหนด' : loan.status}
                                  </span>
                                  {loan.due_date && <div className="text-gray-500 text-xs mt-1">คืน: {loan.due_date}</div>}
                                </div>
                              </button>
                              {expandedLoan === loan.loan_no && (
                                <div className="border-t border-gray-800 px-4 py-3 space-y-2">
                                  <div className="text-gray-400 text-xs">เลขที่: {loan.loan_no}</div>
                                  {loan.notes && <div className="text-gray-500 text-xs">หมายเหตุ: {loan.notes}</div>}
                                  {loan.returned_at && <div className="text-green-400 text-xs">คืนวันที่: {loan.returned_at}</div>}
                                  {loan.status === 'ยืมอยู่' && (
                                    <button onClick={() => returnLoan(loan.loan_no)}
                                      className="text-xs bg-green-700 hover:bg-green-600 text-white px-3 py-1.5 rounded-lg transition-colors">
                                      ✅ บันทึกคืนสินค้า
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                        {!reportData.loans?.length && <div className="text-center text-gray-500 py-8 text-sm">ไม่มีรายการยืมในช่วงเวลานี้</div>}
                      </div>
                    </div>
                  );
                })()}

                {/* ── สินค้าขายดี ── */}
                {!reportLoading && reportData?.type === 'topsellers' && (() => {
                  const s = reportData.summary;
                  return (
                    <div className="space-y-4">
                      <div className="grid grid-cols-3 gap-3">
                        {[
                          { label: 'ยอดขายรวม', value: `฿${(s.total_revenue||0).toLocaleString()}`, color: 'text-green-400' },
                          { label: 'บิลทั้งหมด', value: `${s.total_bills} บิล`, color: 'text-blue-400' },
                          { label: 'สินค้าที่ขาย', value: `${s.unique_products} รายการ`, color: 'text-purple-400' },
                        ].map(c => (
                          <div key={c.label} className="bg-gray-800 rounded-xl p-3 text-center">
                            <div className={`text-lg font-bold ${c.color}`}>{c.value}</div>
                            <div className="text-gray-400 text-xs mt-1">{c.label}</div>
                          </div>
                        ))}
                      </div>
                      <div className="bg-gray-900 rounded-xl overflow-hidden">
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead><tr className="border-b border-gray-800">
                              <th className="text-center text-gray-400 px-2 py-2 w-8">#</th>
                              <th className="text-left text-gray-400 px-3 py-2">สินค้า</th>
                              <th className="text-right text-gray-400 px-3 py-2">จำนวน</th>
                              <th className="text-right text-gray-400 px-3 py-2">ยอดขาย</th>
                              <th className="text-right text-gray-400 px-3 py-2">กำไร</th>
                              <th className="text-right text-gray-400 px-3 py-2">%กำไร</th>
                            </tr></thead>
                            <tbody>
                              {(reportData.top_sellers||[]).map((p, i) => (
                                <tr key={i} className="border-b border-gray-800/50">
                                  <td className="px-2 py-2 text-center text-gray-500">{p.rank}</td>
                                  <td className="px-3 py-2 text-white font-medium">{p.name}</td>
                                  <td className="px-3 py-2 text-right text-yellow-400 font-bold">{p.qty}</td>
                                  <td className="px-3 py-2 text-right text-green-400">฿{p.revenue.toLocaleString()}</td>
                                  <td className="px-3 py-2 text-right text-blue-400">฿{p.profit.toLocaleString()}</td>
                                  <td className={`px-3 py-2 text-right font-bold ${p.margin >= 30 ? 'text-green-400' : p.margin >= 10 ? 'text-yellow-400' : 'text-red-400'}`}>{p.margin}%</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {!reportData.top_sellers?.length && <div className="text-center text-gray-500 py-8 text-sm">ไม่มีข้อมูลในช่วงเวลานี้</div>}
                      </div>
                    </div>
                  );
                })()}

                {/* ── กำไรขาดทุน ── */}
                {!reportLoading && reportData?.type === 'pl' && (() => {
                  const s = reportData.summary;
                  return (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {[
                          { label: 'ยอดขายรวม', value: `฿${(s.total_revenue||0).toLocaleString()}`, color: 'text-green-400' },
                          { label: 'ต้นทุนรวม', value: `฿${(s.total_cost||0).toLocaleString()}`, color: 'text-red-400' },
                          { label: 'กำไรขั้นต้น', value: `฿${(s.gross_profit||0).toLocaleString()}`, color: s.gross_profit >= 0 ? 'text-blue-400' : 'text-red-400' },
                          { label: 'อัตรากำไร', value: `${s.gross_margin||0}%`, color: s.gross_margin >= 20 ? 'text-green-400' : 'text-yellow-400' },
                        ].map(c => (
                          <div key={c.label} className="bg-gray-800 rounded-xl p-3 text-center">
                            <div className={`text-lg font-bold ${c.color}`}>{c.value}</div>
                            <div className="text-gray-400 text-xs mt-1">{c.label}</div>
                          </div>
                        ))}
                      </div>
                      <div className="bg-gray-900 rounded-xl overflow-hidden">
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead><tr className="border-b border-gray-800">
                              <th className="text-left text-gray-400 px-3 py-2">หมวดหมู่</th>
                              <th className="text-right text-gray-400 px-3 py-2">ยอดขาย</th>
                              <th className="text-right text-gray-400 px-3 py-2">ต้นทุน</th>
                              <th className="text-right text-gray-400 px-3 py-2">กำไร</th>
                              <th className="text-right text-gray-400 px-3 py-2">%กำไร</th>
                            </tr></thead>
                            <tbody>
                              {(reportData.categories||[]).map((c, i) => (
                                <tr key={i} className="border-b border-gray-800/50">
                                  <td className="px-3 py-2 text-white font-medium">{c.category}</td>
                                  <td className="px-3 py-2 text-right text-green-400">฿{c.revenue.toLocaleString()}</td>
                                  <td className="px-3 py-2 text-right text-red-400">฿{c.cost.toLocaleString()}</td>
                                  <td className="px-3 py-2 text-right text-blue-400">฿{c.profit.toLocaleString()}</td>
                                  <td className={`px-3 py-2 text-right font-bold ${c.margin >= 30 ? 'text-green-400' : c.margin >= 10 ? 'text-yellow-400' : 'text-red-400'}`}>{c.margin}%</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {!reportData.categories?.length && <div className="text-center text-gray-500 py-8 text-sm">ไม่มีข้อมูล (ต้องใส่ราคาทุนในสินค้าก่อน)</div>}
                      </div>

                      {/* กำไรสุทธิ หลังหักรายจ่ายร้าน (ไม่เกี่ยวกับสต็อค) */}
                      <div className="bg-gray-900 rounded-xl p-4 flex items-center justify-between">
                        <div>
                          <div className="text-white font-bold text-sm">กำไรสุทธิ (หักรายจ่ายร้านแล้ว)</div>
                          <div className="text-gray-500 text-xs mt-0.5">กำไรขั้นต้น ฿{(s.gross_profit||0).toLocaleString()} − รายจ่าย ฿{(s.total_expenses||0).toLocaleString()}</div>
                        </div>
                        <div className={`text-xl font-bold ${(s.net_profit||0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          ฿{(s.net_profit||0).toLocaleString()} <span className="text-xs text-gray-500">({s.net_margin||0}%)</span>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {!reportLoading && reportData?.type === 'cyclical' && (() => {
                  const s = reportData.summary || {};
                  return (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {[
                          { label: 'เต็มพร้อมขาย', value: s.total_stock || 0, color: 'text-green-400' },
                          { label: 'อยู่กับลูกค้ารวม', value: s.total_at_customer || 0, color: 'text-orange-400' },
                          { label: 'เปล่ารอรีฟิล', value: s.total_empty_waiting || 0, color: 'text-gray-300' },
                          { label: 'ลูกค้าที่ถืออยู่', value: s.customer_count || 0, color: 'text-blue-400' },
                        ].map(c => (
                          <div key={c.label} className="bg-gray-800 rounded-xl p-3 text-center">
                            <div className={`text-lg font-bold ${c.color}`}>{c.value.toLocaleString()}</div>
                            <div className="text-gray-400 text-xs mt-1">{c.label}</div>
                          </div>
                        ))}
                      </div>

                      {/* ภาพรวมสต็อคต่อสินค้าหมุนเวียน */}
                      <div className="bg-gray-900 rounded-xl overflow-hidden">
                        <div className="px-3 py-2 border-b border-gray-800 text-gray-400 text-xs font-medium">📦 สต็อคต่อสินค้า</div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead><tr className="border-b border-gray-800">
                              <th className="text-left text-gray-400 px-3 py-2">สินค้า</th>
                              <th className="text-right text-gray-400 px-3 py-2">เต็ม</th>
                              <th className="text-right text-gray-400 px-3 py-2">กับลูกค้า</th>
                              <th className="text-right text-gray-400 px-3 py-2">เปล่ารอรีฟิล</th>
                            </tr></thead>
                            <tbody>
                              {(reportData.products || []).map(p => (
                                <tr key={p.sku} className="border-b border-gray-800/50">
                                  <td className="px-3 py-2 text-white font-medium">{p.name} <span className="text-gray-600">({p.unit})</span></td>
                                  <td className="px-3 py-2 text-right text-green-400">{p.stock}</td>
                                  <td className="px-3 py-2 text-right text-orange-400">{p.at_customer}</td>
                                  <td className={`px-3 py-2 text-right ${p.over_ceiling ? 'text-red-400 font-bold' : 'text-gray-300'}`}>
                                    {p.empty_waiting}{p.empty_ceiling > 0 ? ` / ${p.empty_ceiling}` : ''}
                                    {p.over_ceiling && ' ⚠️'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {!reportData.products?.length && <div className="text-center text-gray-500 py-8 text-sm">ยังไม่มีสินค้าประเภทหมุนเวียน</div>}
                      </div>

                      {s.over_ceiling_count > 0 && (
                        <div className="bg-red-900/20 border border-red-800 rounded-xl p-3 text-red-300 text-xs">
                          ⚠️ มีสินค้าหมุนเวียน {s.over_ceiling_count} รายการที่เปล่ารอรีฟิลเกินเพดานที่ตั้งไว้ — ควรรีบรีฟิลหรือตรวจสอบว่ามีถังตกค้างผิดปกติ
                        </div>
                      )}

                      {/* ต้นทุนรีฟิล vs ซื้อใหม่ (จากใบรับสินค้าในช่วงวันที่เลือกด้านบน) */}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-gray-800 rounded-xl p-3 text-center">
                          <div className="text-lg font-bold text-blue-400">฿{(s.refill_cost || 0).toLocaleString(undefined, {minimumFractionDigits:2})}</div>
                          <div className="text-gray-400 text-xs mt-1">ต้นทุนรีฟิล (สินค้าหมุนเวียน)</div>
                        </div>
                        <div className="bg-gray-800 rounded-xl p-3 text-center">
                          <div className="text-lg font-bold text-gray-300">฿{(s.new_purchase_cost || 0).toLocaleString(undefined, {minimumFractionDigits:2})}</div>
                          <div className="text-gray-400 text-xs mt-1">ต้นทุนซื้อสินค้าใหม่</div>
                        </div>
                      </div>

                      {/* ใครถืออยู่กี่ชิ้น */}
                      <div className="bg-gray-900 rounded-xl overflow-hidden">
                        <div className="px-3 py-2 border-b border-gray-800 text-gray-400 text-xs font-medium">👥 ลูกค้าที่ถือสินค้าหมุนเวียนอยู่</div>
                        <div className="divide-y divide-gray-800">
                          {(reportData.customers || []).map(c => {
                            const isExpanded = expandedCyclicalCust === c.contact_id;
                            const holdings = cyclicalHoldingsCache[c.contact_id];
                            return (
                            <div key={c.contact_id}>
                              <button
                                onClick={() => {
                                  const next = isExpanded ? null : c.contact_id;
                                  setExpandedCyclicalCust(next);
                                  if (next) fetchCyclicalHoldingsFor(c);
                                }}
                                className="w-full px-3 py-2.5 flex items-center justify-between gap-2 text-left">
                                <div className="min-w-0">
                                  <div className="text-white text-sm truncate">{c.name}</div>
                                  {c.phone && <div className="text-gray-500 text-xs">{c.phone}</div>}
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <span className="text-orange-400 font-bold text-sm">{c.cylinders} ชิ้น</span>
                                  <span className="text-gray-500 text-xs">{isExpanded ? '▲' : '▼'}</span>
                                </div>
                              </button>
                              {isExpanded && (
                                <div className="px-3 pb-3 -mt-1">
                                  <div className="bg-gray-800 rounded-xl p-3 mb-2">
                                    {holdings === undefined ? (
                                      <div className="text-gray-500 text-xs animate-pulse">กำลังโหลดรายการ...</div>
                                    ) : holdings === 'unreconciled' ? (
                                      <div className="text-amber-400 text-xs">⚠️ ระบบแยกไม่ได้ว่าเป็นสินค้าชนิดไหนกี่ชิ้น (มีเฉพาะยอดรวม {c.cylinders} ชิ้น) — ประวัติเก่าบางส่วนไม่ได้บันทึกแยกชนิดไว้</div>
                                    ) : Object.keys(holdings).length === 0 ? (
                                      <div className="text-gray-500 text-xs">ไม่มีข้อมูลรายการ</div>
                                    ) : (
                                      <ul className="space-y-1">
                                        {Object.entries(holdings).map(([sku, qty]) => {
                                          const p = products.find(x => x.sku === sku);
                                          return <li key={sku} className="text-gray-300 text-xs flex justify-between"><span>{p?.name || sku}</span><span className="text-white font-medium">{qty} {p?.unit || ''}</span></li>;
                                        })}
                                      </ul>
                                    )}
                                  </div>
                                  {hasFeature(shopInfo?.subscription_tier, 'credit_ar') && (
                                    <button onClick={() => openCollectDispatch(contacts.find(x => x.contact_id === c.contact_id) || c)}
                                      className="w-full text-xs bg-orange-800 hover:bg-orange-700 text-orange-200 hover:text-white px-2.5 py-2 rounded-lg transition-colors">📤 ส่งพนักงานไปเก็บ</button>
                                  )}
                                </div>
                              )}
                            </div>
                            );
                          })}
                        </div>
                        {!reportData.customers?.length && <div className="text-center text-gray-500 py-8 text-sm">ไม่มีลูกค้าถือสินค้าหมุนเวียนอยู่ตอนนี้</div>}
                      </div>
                    </div>
                  );
                })()}

                {/* ── ภาษี VAT (ขาย vs ซื้อ) ── */}
                {!reportLoading && reportData?.type === 'vat' && (() => {
                  const s = reportData.summary || {};
                  const netPayable = s.net_vat_payable || 0;
                  return (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        <div className="bg-gray-800 rounded-xl p-3 text-center">
                          <div className="text-lg font-bold text-green-400">฿{(s.output_vat || 0).toLocaleString(undefined, {minimumFractionDigits:2})}</div>
                          <div className="text-gray-400 text-xs mt-1">ภาษีขาย (Output VAT)</div>
                        </div>
                        <div className="bg-gray-800 rounded-xl p-3 text-center">
                          <div className="text-lg font-bold text-orange-400">฿{(s.input_vat || 0).toLocaleString(undefined, {minimumFractionDigits:2})}</div>
                          <div className="text-gray-400 text-xs mt-1">ภาษีซื้อ (Input VAT)</div>
                        </div>
                        <div className="bg-gray-800 rounded-xl p-3 text-center">
                          <div className={`text-lg font-bold ${netPayable >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                            {netPayable >= 0 ? '฿' : '-฿'}{Math.abs(netPayable).toLocaleString(undefined, {minimumFractionDigits:2})}
                          </div>
                          <div className="text-gray-400 text-xs mt-1">{netPayable >= 0 ? 'VAT ที่ต้องนำส่ง' : 'VAT ขอคืนได้'}</div>
                        </div>
                      </div>

                      <div className="bg-gray-900 rounded-xl overflow-hidden">
                        <div className="px-3 py-2 border-b border-gray-800 text-gray-400 text-xs font-medium">🏪 ภาษีขายแยกตามสาขา</div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead><tr className="border-b border-gray-800">
                              <th className="text-left text-gray-400 px-3 py-2">สาขา</th>
                              <th className="text-right text-gray-400 px-3 py-2">จำนวนบิล</th>
                              <th className="text-right text-gray-400 px-3 py-2">ยอดก่อน VAT</th>
                              <th className="text-right text-gray-400 px-3 py-2">VAT</th>
                            </tr></thead>
                            <tbody>
                              {(reportData.branch_breakdown || []).map(b => (
                                <tr key={b.branch} className="border-b border-gray-800/50">
                                  <td className="px-3 py-2 text-white font-medium">{b.branch}</td>
                                  <td className="px-3 py-2 text-right text-gray-300">{b.sales_count}</td>
                                  <td className="px-3 py-2 text-right text-gray-300">฿{b.sales_subtotal.toLocaleString(undefined, {minimumFractionDigits:2})}</td>
                                  <td className="px-3 py-2 text-right text-green-400">฿{b.sales_vat.toLocaleString(undefined, {minimumFractionDigits:2})}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {!reportData.branch_breakdown?.length && <div className="text-center text-gray-500 py-8 text-sm">ไม่มียอดขายที่มี VAT ในช่วงนี้</div>}
                      </div>

                      <div className="bg-gray-900 rounded-xl overflow-hidden">
                        <div className="px-3 py-2 border-b border-gray-800 text-gray-400 text-xs font-medium">🧮 ที่มาภาษีซื้อ (Input VAT)</div>
                        <div className="divide-y divide-gray-800 text-xs">
                          <div className="px-3 py-2.5 flex items-center justify-between">
                            <span className="text-gray-300">📥 ใบรับสินค้า ({s.receives_count || 0} ใบ)</span>
                            <span className="text-orange-400 font-medium">฿{(s.input_vat_receives || 0).toLocaleString(undefined, {minimumFractionDigits:2})}</span>
                          </div>
                          <div className="px-3 py-2.5 flex items-center justify-between">
                            <span className="text-gray-300">💸 รายจ่าย ({s.expenses_count || 0} รายการ)</span>
                            <span className="text-orange-400 font-medium">฿{(s.input_vat_expenses || 0).toLocaleString(undefined, {minimumFractionDigits:2})}</span>
                          </div>
                        </div>
                      </div>

                      <p className="text-gray-500 text-xs px-1">
                        หมายเหตุ: ภาษีซื้อ (ใบรับสินค้า+รายจ่าย) ยังไม่แยกตามสาขา เพราะยังไม่ได้ผูกกับสาขาที่ขายในตอนนี้ — แสดงเป็นยอดรวมทั้งร้านเท่านั้น
                      </p>
                    </div>
                  );
                })()}

                {/* ── รายจ่าย ── */}
                {!reportLoading && reportData?.type === 'expenses' && (() => {
                  const s = reportData.summary || {};
                  return (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        <div className="bg-gray-800 rounded-xl p-3 text-center">
                          <div className="text-lg font-bold text-red-400">฿{(s.total || 0).toLocaleString(undefined, {minimumFractionDigits:2})}</div>
                          <div className="text-gray-400 text-xs mt-1">รายจ่ายรวม ({s.count || 0} รายการ)</div>
                        </div>
                        <div className="bg-gray-800 rounded-xl p-3 text-center">
                          <div className="text-lg font-bold text-gray-300">฿{(s.subtotal || 0).toLocaleString(undefined, {minimumFractionDigits:2})}</div>
                          <div className="text-gray-400 text-xs mt-1">ยอดก่อน VAT</div>
                        </div>
                        <div className="bg-gray-800 rounded-xl p-3 text-center">
                          <div className="text-lg font-bold text-orange-400">฿{(s.vat || 0).toLocaleString(undefined, {minimumFractionDigits:2})}</div>
                          <div className="text-gray-400 text-xs mt-1">VAT ที่จ่ายไป</div>
                        </div>
                      </div>

                      {reportData.category_breakdown?.length > 0 && (() => {
                        const maxCat = Math.max(...reportData.category_breakdown.map(c => c.total), 1);
                        return (
                          <div className="bg-gray-900 rounded-xl p-4">
                            <h3 className="text-white text-sm font-bold mb-3">📊 รายจ่ายแยกตามหมวดหมู่</h3>
                            <div className="space-y-2.5">
                              {reportData.category_breakdown.map(c => (
                                <div key={c.label}>
                                  <div className="flex items-center justify-between text-xs mb-1">
                                    <span className="text-gray-300 truncate">{c.label}</span>
                                    <span className="text-red-400 font-bold shrink-0 ml-2">฿{c.total.toLocaleString(undefined,{minimumFractionDigits:2})}</span>
                                  </div>
                                  <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                                    <div className="h-full bg-red-500 rounded-full" style={{ width: `${Math.max(3, (c.total / maxCat) * 100)}%` }} />
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })()}

                      <div className="bg-gray-900 rounded-xl overflow-hidden">
                        <div className="divide-y divide-gray-800">
                          {(reportData.expenses || []).map(e => (
                            <div key={e.expense_no} className="px-3 py-2.5 flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <div className="text-white text-sm truncate">{e.label}</div>
                                <div className="text-gray-500 text-xs">{e.created_at} · {e.payment_method}{e.vat_amount > 0 ? ` · VAT ฿${e.vat_amount.toLocaleString(undefined,{minimumFractionDigits:2})}` : ''}</div>
                              </div>
                              <span className="text-red-400 font-bold text-sm shrink-0">฿{e.total.toLocaleString(undefined,{minimumFractionDigits:2})}</span>
                            </div>
                          ))}
                        </div>
                        {!reportData.expenses?.length && <div className="text-center text-gray-500 py-8 text-sm">ไม่มีรายจ่ายในช่วงนี้</div>}
                      </div>
                    </div>
                  );
                })()}

                {/* ── ราคาผิดปกติ / จับทุจริตจัดซื้อ ── */}
                {!reportLoading && reportData?.type === 'fraud' && (() => {
                  const alerts = reportData.alerts || [];
                  return (
                    <div className="space-y-4">
                      <p className="text-gray-500 text-xs px-1">
                        เทียบราคาที่ซื้อจริงตอนรับสินค้ากับราคากลางอำเภอ/จังหวัด (จากข้อมูลนิรนามของร้านอื่นในระบบ) —
                        ขึ้นเตือนถ้าซื้อแพงกว่าราคากลางเกิน 20% เพื่อช่วยตรวจสอบพนักงานจัดซื้อ
                      </p>
                      {reportData.notSetup && (
                        <div className="bg-yellow-900/20 border border-yellow-800 rounded-xl p-3 text-yellow-300 text-xs">
                          ⚠️ ฟีเจอร์นี้ยังไม่พร้อมใช้งาน (รอตั้งค่าฐานข้อมูลฝั่งระบบ)
                        </div>
                      )}
                      <div className="bg-gray-900 rounded-xl overflow-hidden">
                        <div className="divide-y divide-gray-800">
                          {alerts.map(a => (
                            <div key={a.id} className="px-4 py-3">
                              <div className="flex items-center justify-between gap-2 mb-1">
                                <span className="text-white text-sm font-medium">🚩 {a.item_name}</span>
                                <span className={`text-xs px-2 py-0.5 rounded-full ${
                                  a.status === 'pending' ? 'bg-red-900/50 text-red-300' :
                                  a.status === 'investigated' ? 'bg-yellow-900/50 text-yellow-300' : 'bg-green-900/50 text-green-300'
                                }`}>
                                  {a.status === 'pending' ? 'รอตรวจสอบ' : a.status === 'investigated' ? 'กำลังตรวจสอบ' : 'จบเรื่องแล้ว'}
                                </span>
                              </div>
                              <div className="text-gray-500 text-xs mb-2">
                                {a.branch_name ? `${a.branch_name} · ` : ''}{a.receive_doc_no} · {new Date(a.created_at).toLocaleDateString('th-TH')}
                              </div>
                              <div className="text-xs text-gray-300 mb-2">
                                ซื้อ ฿{a.submitted_price.toLocaleString()} เทียบราคากลาง ฿{a.market_median_price.toLocaleString()}
                                <span className="text-red-400 font-bold"> (+{a.deviation_percentage}%)</span>
                              </div>
                              {a.status === 'pending' && (
                                <div className="flex gap-2">
                                  <button onClick={() => updateProcurementAlertStatus(a.id, 'investigated')}
                                    className="flex-1 bg-yellow-800 hover:bg-yellow-700 text-yellow-100 text-xs font-medium py-1.5 rounded-lg transition-colors">🔍 กำลังตรวจสอบ</button>
                                  <button onClick={() => updateProcurementAlertStatus(a.id, 'resolved')}
                                    className="flex-1 bg-green-800 hover:bg-green-700 text-green-100 text-xs font-medium py-1.5 rounded-lg transition-colors">✅ จบเรื่องแล้ว</button>
                                </div>
                              )}
                              {a.status === 'investigated' && (
                                <button onClick={() => updateProcurementAlertStatus(a.id, 'resolved')}
                                  className="w-full bg-green-800 hover:bg-green-700 text-green-100 text-xs font-medium py-1.5 rounded-lg transition-colors">✅ จบเรื่องแล้ว</button>
                              )}
                            </div>
                          ))}
                        </div>
                        {!alerts.length && !reportData.notSetup && <div className="text-center text-gray-500 py-8 text-sm">ยังไม่มีรายการราคาผิดปกติ</div>}
                      </div>
                    </div>
                  );
                })()}

              </div>
            </div>
          )}

          {/* ══ TAB: ตั้งค่า POS ════════════════════════════════════════════ */}
          {/* กันไว้อีกชั้น (defense in depth) — เผื่อ tab ถูกตั้งเป็น 'settings' ทางอ้อมผ่านลิงก์ลัด
              "เพิ่มพนักงาน" จากที่อื่นในหน้านี้ (ปุ่มลัดไม่ได้เช็ค cashierMode) ไม่ใช่แค่ซ่อนปุ่มแท็บเฉยๆ */}
          {tab === 'settings' && !cashierMode && (
            <div className="h-full overflow-y-auto">
              <div className="p-4 max-w-xl mx-auto space-y-6">
                {/* Staff PIN — เปลี่ยนเป็น PIN รายบุคคลแล้ว ตั้ง/รีเซ็ตได้ที่แท็บ "พนักงาน" ด้านล่าง */}
                <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
                  <h3 className="text-white font-bold mb-1">🔐 หน้าพนักงาน (pos-staff)</h3>
                  <p className="text-gray-400 text-xs mb-3">
                    พนักงานแต่ละคนตั้ง PIN ของตัวเองผ่านลิงก์ที่ระบบส่งให้ทาง LINE อัตโนมัติหลังได้รับอนุมัติ/ถูกเพิ่มเข้าระบบ —
                    ดู/รีเซ็ต PIN รายคนได้ที่รายชื่อพนักงานด้านล่าง
                  </p>
                  <a
                    href={`/pos-staff?shopId=${shopId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-green-400 hover:text-green-300 text-xs underline"
                  >
                    🔗 เปิดหน้าพนักงาน (pos-staff)
                  </a>
                </div>

                {/* ลิงก์แคชเชียร์ — แยกจากลิงก์ /pos?userId=... ของเจ้าของร้านโดยสิ้นเชิง บังคับใส่
                    PIN เสมอ ไม่มีทางเห็น Dashboard/ตั้งค่า/ข้อมูลร้านทั้งหมดได้เลยจากลิงก์นี้ —
                    สิทธิ์ที่ทำได้ขึ้นกับที่ติ๊กไว้ในโปรไฟล์พนักงานแต่ละคนเท่านั้น */}
                <div className="bg-gray-900 rounded-2xl p-5 border border-green-900">
                  <h3 className="text-white font-bold mb-1">🖥️ ลิงก์แคชเชียร์ (หน้าขายเต็มรูปแบบ)</h3>
                  <p className="text-gray-400 text-xs mb-3">
                    แชร์ลิงก์นี้ให้พนักงานแคชเชียร์แทนลิงก์ของเจ้าของร้าน — บังคับใส่ PIN ก่อนเข้าเสมอ
                    ไม่มีทางกดไปหน้า Dashboard/ตั้งค่าได้เลย ทำได้เฉพาะสิ่งที่ติ๊กสิทธิ์ไว้ในโปรไฟล์พนักงาน
                    (ตั้งสิทธิ์ได้ที่รายชื่อพนักงานด้านล่าง)
                  </p>
                  <div className="flex items-center gap-2">
                    <input readOnly value={typeof window !== 'undefined' ? `${window.location.origin}/pos?shopId=${shopId}&mode=cashier` : ''}
                      className="flex-1 bg-gray-800 text-gray-300 text-xs px-3 py-2.5 rounded-xl border border-gray-700 truncate" />
                    <button onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}/pos?shopId=${shopId}&mode=cashier`);
                      showToast('คัดลอกลิงก์แคชเชียร์แล้ว');
                    }} className="shrink-0 bg-green-700 hover:bg-green-600 text-white text-xs font-bold px-4 py-2.5 rounded-xl transition-colors">
                      📋 คัดลอก
                    </button>
                  </div>
                </div>

                {/* ลิงก์สั่งซื้อสำหรับลูกค้า */}
                <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
                  <h3 className="text-white font-bold mb-1">🛒 ลิงก์สั่งซื้อสำหรับลูกค้า</h3>
                  <p className="text-gray-400 text-xs mb-3">
                    แชร์ลิงก์นี้ให้ลูกค้าเพื่อสั่งซื้อ/สั่งจัดส่งเองได้ (ไม่ต้อง login) — คำสั่งซื้อที่เข้ามาจะรอให้ร้านตรวจสอบ/ยืนยันในแท็บ "🚚 ออเดอร์" ก่อนเสมอ ไม่กลายเป็นออเดอร์จริงทันที
                  </p>
                  <div className="flex items-center gap-2">
                    <input readOnly value={typeof window !== 'undefined' ? `${window.location.origin}/order?shopId=${shopId}` : ''}
                      className="flex-1 bg-gray-800 text-gray-300 text-xs px-3 py-2.5 rounded-xl border border-gray-700 truncate" />
                    <button onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}/order?shopId=${shopId}`);
                      showToast('คัดลอกลิงก์แล้ว');
                    }} className="shrink-0 bg-blue-700 hover:bg-blue-600 text-white text-xs font-bold px-4 py-2.5 rounded-xl transition-colors">
                      📋 คัดลอก
                    </button>
                  </div>

                  {posBranches.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-gray-800 space-y-2">
                      <p className="text-gray-400 text-xs mb-2">
                        หรือแยกลิงก์เฉพาะสาขา (ลูกค้าจะเห็นแค่สินค้าของสาขานั้น + ล็อกสาขาไว้อัตโนมัติ ไม่ต้องเลือกเอง)
                      </p>
                      {posBranches.map(b => (
                        <div key={b.id} className="flex items-center gap-2">
                          <span className="shrink-0 text-gray-300 text-xs w-20 truncate">{b.brand_name || b.branch_name}</span>
                          <input readOnly value={typeof window !== 'undefined' ? `${window.location.origin}/order?shopId=${shopId}&branch=${encodeURIComponent(b.branch_name)}` : ''}
                            className="flex-1 bg-gray-800 text-gray-300 text-xs px-3 py-2 rounded-xl border border-gray-700 truncate" />
                          <button onClick={() => {
                            navigator.clipboard.writeText(`${window.location.origin}/order?shopId=${shopId}&branch=${encodeURIComponent(b.branch_name)}`);
                            showToast('คัดลอกลิงก์แล้ว');
                          }} className="shrink-0 bg-gray-700 hover:bg-gray-600 text-white text-xs font-bold px-3 py-2 rounded-xl transition-colors">
                            📋
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Table names */}
                <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
                  <h3 className="text-white font-bold mb-1">🪑 ชื่อโต๊ะ / บิล</h3>
                  <p className="text-gray-400 text-xs mb-4">
                    ตั้งชื่อโต๊ะล่วงหน้า เช่น โต๊ะ 1, โต๊ะ 2, Take Away, Delivery<br />
                    คั่นด้วยเครื่องหมายจุลภาค (,)
                  </p>
                  <textarea
                    value={tableNamesInput}
                    onChange={e => setTableNamesInput(e.target.value)}
                    rows={3}
                    placeholder="โต๊ะ 1, โต๊ะ 2, โต๊ะ 3, Take Away, Delivery"
                    className="w-full bg-gray-800 text-white text-sm px-4 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500 resize-none"
                  />
                  <button
                    onClick={() => saveTableNames(tableNamesInput)}
                    className="mt-2 w-full bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm font-medium py-2.5 rounded-xl transition-colors"
                  >
                    บันทึกชื่อโต๊ะ
                  </button>
                  {tableNames.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {tableNames.map(n => (
                        <span key={n} className="bg-gray-800 text-gray-300 text-xs px-3 py-1.5 rounded-full border border-gray-700">{n}</span>
                      ))}
                    </div>
                  )}
                </div>

                {/* คำขอสมัคร (#สมัครพนักงานขนส่ง / #สมัครผู้จัดการสาขา) */}
                {staffRequests.filter(r => r.status === 'pending').length > 0 && (
                  <div className="bg-gray-900 rounded-2xl p-5 border border-orange-800/50">
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="text-white font-bold">📋 คำขอสมัคร</h3>
                      <span className="text-[10px] font-bold px-2 py-0.5 bg-orange-900/60 text-orange-300 rounded-full animate-pulse">
                        {staffRequests.filter(r => r.status === 'pending').length} รออนุมัติ
                      </span>
                    </div>
                    <p className="text-gray-400 text-xs mb-4">
                      ให้พนักงาน/ผู้จัดการพิมพ์ <span className="font-mono bg-gray-800 px-1.5 py-0.5 rounded border border-gray-700">#สมัครพนักงาน</span> หรือ <span className="font-mono bg-gray-800 px-1.5 py-0.5 rounded border border-gray-700">#สมัครผู้จัดการสาขา</span> ในกลุ่ม LINE ของสาขา แล้วมาอนุมัติที่นี่ (คำสั่งเดิม <span className="font-mono bg-gray-800 px-1.5 py-0.5 rounded border border-gray-700">#สมัครพนักงานขนส่ง</span> ยังใช้ได้เหมือนเดิม)
                    </p>
                    <div className="space-y-2">
                      {staffRequests.filter(r => r.status === 'pending').map(req => (
                        <div key={req.id} className="bg-gray-800 rounded-xl p-3 flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-white text-sm font-medium">{req.display_name || 'สมาชิก LINE'}</span>
                              <span className="text-xs bg-gray-700 text-gray-400 px-2 py-0.5 rounded-full">
                                {req.role === 'delivery_staff' ? '🛵 พนักงานส่ง' : '🏬 ผู้จัดการสาขา'}
                              </span>
                            </div>
                            <div className="text-gray-500 text-xs mt-0.5">สาขา: {req.branch_name || '-'}</div>
                          </div>
                          <div className="flex gap-1.5 shrink-0">
                            <button onClick={() => actOnStaffRequest(req.id, 'approve')} disabled={staffRequestActing === req.id}
                              className="text-xs bg-green-700 hover:bg-green-600 text-white px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                              {staffRequestActing === req.id ? '...' : 'อนุมัติ'}
                            </button>
                            <button onClick={() => actOnStaffRequest(req.id, 'reject')} disabled={staffRequestActing === req.id}
                              className="text-xs bg-gray-700 hover:bg-red-800 text-gray-300 hover:text-red-300 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                              ปฏิเสธ
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Staff / Drivers */}
                <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h3 className="text-white font-bold">🛵 พนักงาน / คนส่งของ</h3>
                      <p className="text-gray-400 text-xs mt-0.5">ใส่ LINE ID ของพนักงานเพื่อรับงานส่งของผ่าน LINE อัตโนมัติ</p>
                    </div>
                    <button onClick={() => { setEditStaff(null); setStaffForm({ name:'', phone:'', line_id:'', role:'พนักงานส่ง', notes:'', ...emptyStaffPerms() }); setStaffPreset(''); setShowStaffForm(true); }} className="shrink-0 bg-green-600 hover:bg-green-500 text-white text-xs font-bold px-3 py-2 rounded-xl transition-colors">
                      + เพิ่ม
                    </button>
                  </div>

                  {staffLoading ? (
                    <div className="text-center text-gray-500 py-4 text-sm animate-pulse">กำลังโหลด...</div>
                  ) : staff.length === 0 ? (
                    <div className="text-center text-gray-500 py-6 text-sm">ยังไม่มีพนักงาน</div>
                  ) : (
                    <div className="space-y-2">
                      {staff.map(s => (
                        <div key={s.staff_id} className="bg-gray-800 rounded-xl p-3 flex items-center gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-white text-sm font-medium">{s.name}</span>
                              <span className="text-xs bg-gray-700 text-gray-400 px-2 py-0.5 rounded-full">{s.role}</span>
                            </div>
                            {s.phone && <div className="text-gray-400 text-xs">📞 {s.phone}</div>}
                            <div className="text-xs mt-0.5">
                              {s.line_id ? (
                                <span className="text-green-400">✅ LINE ID: {s.line_id}</span>
                              ) : (
                                <span className="text-yellow-500">⚠️ ยังไม่มี LINE ID</span>
                              )}
                            </div>
                            <div className="text-xs mt-0.5">
                              {s.has_pin ? (
                                <span className="text-green-400">🔐 ตั้ง PIN แล้ว</span>
                              ) : (
                                <span className="text-yellow-500">⚠️ ยังไม่ได้ตั้ง PIN</span>
                              )}
                            </div>
                            {STAFF_PERM_DEFS.some(p => s[p.key]) && (
                              <div className="flex flex-wrap gap-1 mt-1">
                                {STAFF_PERM_DEFS.filter(p => s[p.key]).map(p => (
                                  <span key={p.key} className="text-[10px] bg-blue-900/50 text-blue-300 px-1.5 py-0.5 rounded">{p.icon} {p.label}</span>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="flex flex-col gap-1.5 shrink-0 items-end">
                            <div className="flex gap-1.5">
                              <button onClick={() => {
                                setEditStaff(s);
                                const perms = {};
                                STAFF_PERM_DEFS.forEach(p => { perms[p.key] = !!s[p.key]; });
                                setStaffForm({ name: s.name, phone: s.phone, line_id: s.line_id, role: s.role, notes: s.notes, ...perms });
                                setStaffPreset('');
                                setShowStaffForm(true);
                              }} className="text-xs bg-gray-700 hover:bg-blue-700 text-gray-300 hover:text-white px-2.5 py-1.5 rounded-lg transition-colors">แก้ไข</button>
                              <button onClick={() => deleteStaffMember(s)} className="text-xs bg-gray-700 hover:bg-red-700 text-gray-300 hover:text-white px-2.5 py-1.5 rounded-lg transition-colors">ลบ</button>
                            </div>
                            <div className="flex gap-1.5">
                              {s.line_id && (
                                <button onClick={() => resendStaffPinLink(s)} className="text-xs bg-gray-700 hover:bg-purple-800 text-gray-300 hover:text-purple-200 px-2.5 py-1.5 rounded-lg transition-colors">📨 ส่งลิงก์ตั้ง PIN</button>
                              )}
                              {s.has_pin && (
                                <button onClick={() => revokeStaffPin(s)} className="text-xs bg-gray-700 hover:bg-red-800 text-gray-300 hover:text-red-200 px-2.5 py-1.5 rounded-lg transition-colors">🚫 ปิดใช้งาน PIN</button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* PromptPay ID */}
                <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
                  <h3 className="text-white font-bold mb-1">📲 พร้อมเพย์ QR</h3>
                  <p className="text-gray-400 text-xs mb-4">
                    ใช้เบอร์โทรส่วนตัว หรือเลขผู้เสียภาษีนิติบุคคล 13 หลัก (ระบบตรวจจับประเภทให้อัตโนมัติ) — เงินจะเข้าบัญชีธนาคารที่ผูกพร้อมเพย์กับเลขนี้อยู่ ณ ตอนนี้เท่านั้น
                    {posConfig.promptpay_id ? ` — ปัจจุบัน: ${posConfig.promptpay_id}` : ''}
                  </p>
                  <div>
                    <label className="block text-gray-400 text-xs mb-1.5">เลขพร้อมเพย์</label>
                    <input
                      type="text"
                      value={posSettingsForm.promptpay_id}
                      onChange={e => setPosSettingsForm(f => ({ ...f, promptpay_id: e.target.value }))}
                      className="w-full bg-gray-800 text-white text-sm px-4 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500"
                      placeholder="เช่น 0812345678 หรือ 0105536000000"
                    />
                  </div>
                </div>

                {/* Biller ID (Thai QR Payment / Bill Payment — ธนาคารใดก็ได้) */}
                <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
                  <h3 className="text-white font-bold mb-1">🏦 Biller ID จากธนาคาร</h3>
                  <p className="text-gray-400 text-xs mb-4">
                    สำหรับร้าน/บริษัทที่ธนาคารออกการ์ดหรือเอกสารระบุคำว่า "Biller ID" มาให้ (ธนาคารใดก็ได้ ไม่จำกัดแค่ SCB/KBank) —
                    เป็นคนละระบบกับพร้อมเพย์ด้านบน เงินจะเข้าบัญชีที่ผูกกับ Biller ID นี้โดยตรง <b>ถ้ากรอกช่องนี้ ระบบจะใช้ช่องนี้แทนพร้อมเพย์ทันที</b>
                    {posConfig.scb_biller_id ? ` — ปัจจุบัน: ${posConfig.scb_biller_id}` : ' — เว้นว่างไว้ถ้าไม่มี'}
                  </p>
                  <div>
                    <label className="block text-gray-400 text-xs mb-1.5">Biller ID</label>
                    <input
                      type="text"
                      value={posSettingsForm.scb_biller_id}
                      onChange={e => setPosSettingsForm(f => ({ ...f, scb_biller_id: e.target.value }))}
                      className="w-full bg-gray-800 text-white text-sm px-4 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500"
                      placeholder="เช่น 050556501923609"
                    />
                  </div>
                </div>

                {/* ร้านจด VAT */}
                <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
                  <h3 className="text-white font-bold mb-1">🧾 ร้านนี้จดทะเบียน VAT</h3>
                  <p className="text-gray-400 text-xs mb-4">
                    เปิดไว้ถ้าร้านจดทะเบียนภาษีมูลค่าเพิ่ม — ใบเสร็จขายหน้าร้านทุกใบจะแสดงยอดก่อน VAT/VAT 7% แยกให้อัตโนมัติตามประเภท VAT ของสินค้าแต่ละชิ้น
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button"
                      onClick={() => setPosSettingsForm(f => ({ ...f, vat_registered: true }))}
                      className={`py-2.5 rounded-xl text-sm font-medium transition-colors ${
                        posSettingsForm.vat_registered ? 'bg-green-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                      }`}>
                      ✅ จด VAT
                    </button>
                    <button type="button"
                      onClick={() => setPosSettingsForm(f => ({ ...f, vat_registered: false }))}
                      className={`py-2.5 rounded-xl text-sm font-medium transition-colors ${
                        !posSettingsForm.vat_registered ? 'bg-green-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                      }`}>
                      ไม่จด VAT
                    </button>
                  </div>
                </div>

                {/* ขนาดกระดาษเครื่องพิมพ์ใบเสร็จ */}
                <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
                  <h3 className="text-white font-bold mb-1">🖨️ ขนาดกระดาษเครื่องพิมพ์ใบเสร็จ</h3>
                  <p className="text-gray-400 text-xs mb-4">
                    เลือกตามเครื่องพิมพ์ใบเสร็จที่ร้านมีอยู่แล้ว (ไม่ต้องซื้อเครื่องใหม่) — ใช้กำหนดความกว้างตอนพิมพ์ใบเสร็จ/ใบกำกับภาษี
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {['58mm', '80mm'].map(size => (
                      <button key={size} type="button"
                        onClick={() => setPosSettingsForm(f => ({ ...f, receipt_paper_size: size }))}
                        className={`py-2.5 rounded-xl text-sm font-medium transition-colors ${
                          posSettingsForm.receipt_paper_size === size ? 'bg-green-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                        }`}>
                        {size}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  onClick={savePosSettings}
                  disabled={settingsSaving}
                  className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-colors"
                >
                  {settingsSaving ? 'กำลังบันทึก...' : '💾 บันทึกตั้งค่า'}
                </button>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* ══ CART DRAWER (mobile) ══════════════════════════════════════════ */}
      {showCartDrawer && (
        <div className="lg:hidden fixed inset-0 z-40 bg-black/60" onClick={() => setShowCartDrawer(false)}>
          <div className="absolute bottom-0 left-0 right-0 bg-gray-900 rounded-t-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between shrink-0">
              <span className="text-white font-bold">🛒 ตะกร้า ({cart.reduce((s, i) => s + i.qty, 0)} รายการ)</span>
              <button onClick={() => setShowCartDrawer(false)} className="text-gray-400 hover:text-white text-xl">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {cart.map(item => (
                <div key={item.sku} className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-white text-sm font-medium truncate">{item.name}</div>
                    <div className="text-green-400 text-xs">฿{(item.price * item.qty).toLocaleString()}</div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button onClick={() => updateQty(item.sku, item.qty - 1)} className="w-7 h-7 rounded-full bg-gray-700 hover:bg-red-700 text-white flex items-center justify-center transition-colors">−</button>
                    <span className="text-white text-sm w-6 text-center">{item.qty}</span>
                    <button onClick={() => updateQty(item.sku, item.qty + 1)} className="w-7 h-7 rounded-full bg-gray-700 hover:bg-green-700 text-white flex items-center justify-center transition-colors">+</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="p-4 border-t border-gray-800 shrink-0 space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-gray-400 text-sm">รวมทั้งหมด</span>
                <span className="text-white font-bold text-xl">฿{cartSubtotal.toLocaleString()}</span>
              </div>
              <div className="flex gap-2">
                <button onClick={() => { setCart([]); setShowCartDrawer(false); }}
                  className="flex-1 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm font-medium py-3 rounded-xl transition-colors">
                  ล้าง
                </button>
                <button onClick={openDelivery}
                  className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-xl transition-colors text-sm">
                  🛵 จัดส่ง
                </button>
                <button onClick={openCheckout}
                  className="flex-[2] bg-green-600 hover:bg-green-500 text-white font-bold py-3 rounded-xl transition-colors text-sm">
                  ชำระเงิน
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══ CHECKOUT MODAL ════════════════════════════════════════════════ */}
      {showCheckout && (
        <div className="fixed inset-0 z-40 bg-black/60 flex items-end sm:items-center justify-center p-4">
          <div className="bg-gray-900 rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b border-gray-800 flex items-center justify-between">
              <div>
                <h3 className="text-white font-bold">ชำระเงิน</h3>
                {openBills.find(b => b.id === activeBillId)?.name && (
                  <div className="text-green-400 text-xs mt-0.5">{openBills.find(b => b.id === activeBillId).name}</div>
                )}
              </div>
              <button onClick={() => setShowCheckout(false)} className="text-gray-500 hover:text-white text-xl leading-none">✕</button>
            </div>
            <div className="p-5 space-y-4">
              {/* รายการสินค้า — ราคาแก้ไขได้ต่อรายการ */}
              <div className="bg-gray-800 rounded-xl p-3 space-y-2 max-h-48 overflow-y-auto">
                {cart.map(item => (
                  <div key={item.sku} className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-gray-300 flex-1 min-w-0 truncate">{item.name} ×{item.qty}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-gray-500">฿</span>
                      <input type="number" value={item.price} min="0"
                        onChange={e => updatePrice(item.sku, e.target.value)}
                        className="w-16 bg-gray-900 text-white text-right px-1.5 py-1 rounded-lg border border-gray-700 focus:outline-none focus:border-green-500 text-sm"
                      />
                      <span className="text-white font-medium w-16 text-right">= ฿{(item.price * item.qty).toLocaleString()}</span>
                    </div>
                  </div>
                ))}
                <div className="border-t border-gray-700 pt-1.5 flex justify-between text-sm font-bold">
                  <span className="text-gray-400">รวม</span>
                  <span className="text-white">฿{cartSubtotal.toLocaleString()}</span>
                </div>
              </div>

              {/* สินค้าหมุนเวียน (เช่น ถังแก๊ส/ขวดน้ำ/ถังออกซิเจน) — ค่าเริ่มต้นถือว่าลูกค้านำของเก่ามาแลกครบทุกชิ้น
                  กดปุ่ม "ยืม" เฉพาะรายการที่ลูกค้าไม่ได้เอาของเก่ามาคืน (ยืมไปก่อน) */}
              {cyclicalCartItems.length > 0 && (
                <div className="bg-purple-900/20 border border-purple-800/60 rounded-xl p-3 space-y-2">
                  <label className="block text-purple-300 text-xs font-bold">🔄 สินค้าหมุนเวียน — ค่าเริ่มต้นคือลูกค้านำของเก่ามาแลกครบ</label>
                  {cyclicalCartItems.map(item => {
                    const unit = item.unit || 'ชิ้น';
                    const isBorrowing = !!borrowingSku[item.sku];
                    return (
                      <div key={item.sku} className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2 text-sm">
                          <span className="text-gray-300 flex-1 min-w-0 truncate">{item.name} (ซื้อ {item.qty})</span>
                          <button type="button"
                            onClick={() => setBorrowingSku(s => ({ ...s, [item.sku]: !s[item.sku] }))}
                            className={`text-xs px-3 py-1.5 rounded-lg shrink-0 transition-colors ${isBorrowing ? 'bg-orange-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
                            {isBorrowing ? '🤝 ยืม' : 'แลกครบ'}
                          </button>
                        </div>
                        {isBorrowing && (
                          <div className="flex items-center justify-end gap-2 text-xs text-gray-400">
                            <span>จำนวนที่ยืม (ไม่เอา{unit}เก่ามาแลก)</span>
                            <input type="number" min="0" max={item.qty} value={borrowedQty[item.sku] || ''}
                              onChange={e => setBorrowedQty(q => ({ ...q, [item.sku]: e.target.value }))}
                              placeholder="0"
                              className="w-16 bg-gray-900 text-white text-right px-2 py-1.5 rounded-lg border border-orange-700/50 focus:outline-none focus:border-orange-500 text-sm"
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* ลูกค้า — ค้นหาลูกค้าเดิมเพื่อดึงราคาประจำตัว หรือพิมพ์ชื่อใหม่เฉยๆ ก็ได้ */}
              <div>
                <label className="block text-gray-400 text-xs mb-1.5">ลูกค้า (ไม่บังคับ)</label>
                {creditCustomer ? (
                  <div className="bg-gray-800 rounded-xl p-3 flex items-center justify-between border border-gray-700">
                    <div>
                      <div className="text-white font-bold text-sm">{creditCustomer.name}</div>
                      {creditCustomer.phone && <div className="text-gray-400 text-xs">{creditCustomer.phone}</div>}
                    </div>
                    <button onClick={() => setCreditCustomer(null)}
                      className="text-gray-500 hover:text-gray-300 text-lg ml-2">✕</button>
                  </div>
                ) : (
                  <div>
                    <input
                      type="text"
                      value={creditCustomerQ}
                      onChange={e => setCreditCustomerQ(e.target.value)}
                      placeholder="ค้นหาลูกค้าเดิม หรือพิมพ์ชื่อใหม่..."
                      className="w-full bg-gray-800 text-white text-sm px-4 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500 mb-2"
                    />
                    {creditCustomerQ.length > 0 && (() => {
                      const q = creditCustomerQ.toLowerCase();
                      const qDigits = q.replace(/\D/g, '');
                      const matches = (contacts || []).filter(c =>
                        (c.name || '').toLowerCase().includes(q) ||
                        (qDigits.length > 0 && (c.phone || '').replace(/\D/g, '').includes(qDigits))
                      ).slice(0, 5);
                      return matches.length > 0 ? (
                        <div className="bg-gray-800 rounded-xl overflow-hidden border border-gray-700">
                          {matches.map((c, i) => (
                            <button key={i} className="w-full text-left px-3 py-2.5 hover:bg-gray-700 text-sm text-gray-200 border-b border-gray-700/50 last:border-0"
                              onClick={() => { setCreditCustomer(c); setCreditCustomerQ(''); }}>
                              <div>{c.name}</div>
                              {c.phone && <div className="text-gray-500 text-xs">{c.phone}</div>}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="text-center py-2">
                          <button onClick={() => { setCreditCustomer({ name: creditCustomerQ, phone: '' }); setCreditCustomerQ(''); }}
                            className="text-xs text-green-400 hover:text-green-300">
                            + ใช้ "{creditCustomerQ}" เป็นชื่อลูกค้าใหม่ (ไม่บันทึกราคาประจำตัว)
                          </button>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>

              {/* ส่วนลด — เลือกได้ทั้ง บาท / เปอร์เซ็นต์ */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-gray-400 text-xs">ส่วนลด</label>
                  <div className="flex bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
                    <button type="button" onClick={() => setDiscountType('amount')}
                      className={`text-xs px-3 py-1 transition-colors ${discountType === 'amount' ? 'bg-green-600 text-white' : 'text-gray-400 hover:text-white'}`}>฿ บาท</button>
                    <button type="button" onClick={() => setDiscountType('percent')}
                      className={`text-xs px-3 py-1 transition-colors ${discountType === 'percent' ? 'bg-green-600 text-white' : 'text-gray-400 hover:text-white'}`}>% เปอร์เซ็นต์</button>
                  </div>
                </div>
                <input type="number" value={discount}
                  onChange={e => setDiscount(e.target.value < 0 ? '0' : e.target.value)}
                  placeholder="0" min="0" max={discountType === 'percent' ? 100 : undefined}
                  className="w-full bg-gray-800 text-white text-sm px-4 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500"
                />
                {discountType === 'percent' && discount && (
                  <div className="text-gray-500 text-xs mt-1">= ฿{cartDiscount.toLocaleString()}</div>
                )}
              </div>

              {/* ยอดสุทธิ */}
              <div className="bg-gray-800 rounded-xl p-4 text-center">
                <div className="text-gray-400 text-xs mb-1">ยอดสุทธิ</div>
                <div className="text-green-400 text-3xl font-bold">฿{cartTotal.toLocaleString()}</div>
              </div>

              {/* วันที่ทำรายการ — ปกติเป็นวันนี้ แก้เป็นวันอื่นได้ถ้าคีย์ข้อมูลย้อนหลัง */}
              <div>
                <label className="block text-gray-400 text-xs mb-1.5">📅 วันที่ทำรายการ</label>
                <input type="date" value={saleDate || getTodayISO()} max={getTodayISO()}
                  onChange={e => setSaleDate(e.target.value)}
                  className="w-full bg-gray-800 text-white text-sm px-4 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500"/>
                {saleDate && saleDate !== getTodayISO() && (
                  <div className="text-amber-400 text-[11px] mt-1">⚠️ กำลังบันทึกย้อนหลัง — ไม่ใช่วันนี้</div>
                )}
              </div>

              {/* วิธีชำระ */}
              <div>
                <label className="block text-gray-400 text-xs mb-1.5">วิธีชำระ</label>
                <div className="grid grid-cols-4 gap-2">
                  {PAY_METHODS.filter(m => m !== 'เชื่อ' || hasFeature(shopInfo?.subscription_tier, 'credit_ar')).map(m => (
                    <button key={m} onClick={() => setPayMethod(m)}
                      className={`py-2 rounded-xl text-xs font-medium transition-colors ${
                        payMethod === m ? 'bg-green-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                      }`}
                    >{m}</button>
                  ))}
                </div>
              </div>

              {payMethod === 'เงินสด' && (
                <div>
                  <label className="block text-gray-400 text-xs mb-1.5">รับเงินมา (บาท)</label>
                  <input type="number" value={cashReceived} onChange={e => setCashReceived(e.target.value)}
                    placeholder={cartTotal}
                    className="w-full bg-gray-800 text-white text-sm px-4 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500"
                  />
                  {cashReceived && (
                    <div className={`mt-2 text-center text-sm font-bold ${cartChange >= 0 ? 'text-yellow-400' : 'text-red-400'}`}>
                      {cartChange >= 0 ? `เงินทอน ฿${cartChange.toLocaleString()}` : '⚠️ เงินไม่พอ'}
                    </div>
                  )}
                </div>
              )}

              {payMethod === 'โอน' && (
                <div className="space-y-3">
                  {/* PromptPay QR */}
                  {(qrLoading || qrImageData) && (
                    <div className="bg-white rounded-2xl p-4 text-center">
                      {qrLoading ? (
                        <div className="text-gray-400 text-sm py-6">กำลังสร้าง QR...</div>
                      ) : (
                        <>
                          <div className="text-gray-700 text-xs mb-2 font-medium">สแกนพร้อมเพย์ ฿{cartTotal.toLocaleString()}</div>
                          <img src={qrImageData} alt="PromptPay QR"
                            className="mx-auto w-48 h-48 object-contain" />
                          <div className="text-gray-500 text-xs mt-2">ยอดเงินล็อคไว้แล้ว — ลูกค้าสแกนแล้วโอนได้เลย</div>
                        </>
                      )}
                    </div>
                  )}

                  {/* slip upload */}
                  {slipDriveUrl ? (
                    <div className="bg-green-900/30 border border-green-800 rounded-xl p-3 flex items-center gap-3">
                      <div className="text-green-400 text-xl shrink-0">✅</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-green-300 text-xs font-bold">อัปโหลดสลิปแล้ว</div>
                        {slipOcrData?.amount && (
                          <div className="text-green-200 text-xs mt-0.5">
                            ยอด ฿{Number(slipOcrData.amount).toLocaleString()}
                            {slipOcrData.sender ? ` · ${slipOcrData.sender}` : ''}
                          </div>
                        )}
                        <div className="text-gray-500 text-xs mt-0.5">ไม่ต้องส่งซ้ำใน LINE</div>
                      </div>
                      <button onClick={() => { setSlipDriveUrl(''); setSlipOcrData(null); }}
                        className="text-gray-500 hover:text-gray-300 text-sm shrink-0">✕</button>
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => slipInputRef.current?.click()}
                        disabled={slipUploading}
                        className="w-full bg-gray-800 hover:bg-gray-700 border border-dashed border-gray-600 text-gray-300 text-sm font-medium py-3 rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
                      >
                        {slipUploading
                          ? <><span className="inline-block animate-spin">⏳</span> กำลังอัปโหลด...</>
                          : <><span>📷</span> ถ่ายรูป / แนบสลิปโอน (ถ้ามี)</>}
                      </button>
                      <input ref={slipInputRef} type="file" accept="image/*" capture="environment"
                        className="hidden" onChange={handleSlipCapture} />
                      <div className="bg-blue-900/20 border border-blue-900 rounded-xl p-3 text-xs text-blue-400">
                        💡 ถ้าไม่แนบสลิปตอนนี้ พนักงานยืนยันทีหลังได้ที่หน้า Staff หรือส่งสลิปเข้า LINE
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* เชื่อ — เตือนว่าต้องเลือกลูกค้า (เลือกได้จากช่อง "ลูกค้า" ด้านบนแล้ว) */}
              {payMethod === 'เชื่อ' && (
                <div className="bg-orange-900/20 border border-orange-800/60 rounded-xl p-3">
                  {!creditCustomer ? (
                    <div className="text-orange-300 text-xs">⚠️ ขายเชื่อต้องเลือกลูกค้าที่ช่อง "ลูกค้า" ด้านบนก่อน</div>
                  ) : (
                    <div className="text-orange-400 text-xs">⚠️ บิลเชื่อจะไม่บันทึกลงบัญชีหลักจนกว่าจะรับชำระ</div>
                  )}
                </div>
              )}

              <button
                onClick={handleCheckout}
                disabled={checkoutLoading || (payMethod === 'เงินสด' && cashReceived && cartChange < 0) || (payMethod === 'เชื่อ' && !creditCustomer)}
                className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-bold py-4 rounded-xl transition-colors text-lg"
              >
                {checkoutLoading ? 'กำลังบันทึก...' : payMethod === 'เชื่อ' ? `💳 บันทึกเชื่อ${creditCustomer ? ` (${creditCustomer.name})` : ''}` : '✅ ยืนยันชำระเงิน'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ BILL MODAL ═════════════════════════════════════════════════════ */}
      {showBill && lastBill && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-xs text-center p-6">
            <div className="text-4xl mb-3">✅</div>
            <div className="text-gray-800 font-bold text-lg mb-1">ชำระเงินสำเร็จ!</div>
            <div className="text-gray-500 text-xs mb-1">{lastBill.billNo}</div>
            {lastBill.billName && <div className="text-gray-600 text-xs mb-3 font-medium">{lastBill.billName}</div>}
            <div className="bg-gray-50 rounded-xl p-4 text-left mb-4 text-xs space-y-1">
              {lastBill.items.map((item, i) => (
                <div key={i} className="flex justify-between">
                  <span className="text-gray-600">{item.name} ×{item.qty}</span>
                  <span className="text-gray-800">฿{(item.price * item.qty).toLocaleString()}</span>
                </div>
              ))}
              {lastBill.discount > 0 && (
                <div className="flex justify-between text-red-500">
                  <span>ส่วนลด</span>
                  <span>−฿{lastBill.discount.toLocaleString()}</span>
                </div>
              )}
              <div className="border-t border-gray-200 pt-1 flex justify-between font-bold">
                <span>ยอดสุทธิ</span>
                <span className="text-green-600">฿{lastBill.total.toLocaleString()}</span>
              </div>
              {lastBill.payMethod === 'เงินสด' && lastBill.change > 0 && (
                <div className="flex justify-between text-orange-500">
                  <span>เงินทอน</span>
                  <span>฿{lastBill.change.toLocaleString()}</span>
                </div>
              )}
            </div>
            <div className="flex gap-2 mb-2">
              <button onClick={() => printReceipt(lastBill)}
                className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-800 text-sm font-bold py-2.5 rounded-xl transition-colors">
                🖨️ พิมพ์ใบเสร็จ
              </button>
              <button onClick={() => openTaxInvoiceForm(lastBill)}
                className="flex-1 bg-blue-100 hover:bg-blue-200 text-blue-800 text-sm font-bold py-2.5 rounded-xl transition-colors">
                🧾 ใบกำกับภาษี
              </button>
            </div>
            <button onClick={() => setShowBill(false)}
              className="w-full bg-green-600 hover:bg-green-500 text-white font-bold py-3 rounded-xl transition-colors">
              ปิด / รายการถัดไป
            </button>
          </div>
        </div>
      )}

      {/* ══ TAX INVOICE FORM MODAL ══════════════════════════════════════════ */}
      {showTaxInvoiceForm && lastBill && (
        <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-gray-900 rounded-2xl w-full max-w-sm border border-gray-700 shadow-2xl">
            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-white font-bold">🧾 ออกใบกำกับภาษี</h3>
                <button onClick={() => setShowTaxInvoiceForm(false)} className="text-gray-400 hover:text-white text-2xl leading-none">×</button>
              </div>
              <p className="text-gray-500 text-xs mb-4">อ้างอิงบิล {lastBill.billNo} — ยอด ฿{lastBill.total.toLocaleString()}</p>
              <div className="space-y-3">
                <div className="relative">
                  <label className="block text-gray-400 text-xs mb-1.5">🔍 ค้นหาจากผู้ติดต่อ (ชื่อ/เบอร์โทร)</label>
                  <input value={taxInvoiceContactQ} onChange={e => setTaxInvoiceContactQ(e.target.value)}
                    placeholder="พิมพ์ชื่อหรือเบอร์โทรเพื่อเลือกผู้ซื้อ..."
                    className="w-full bg-gray-800 text-white text-sm px-4 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-blue-500" />
                  {taxInvoiceContactQ.trim() && (
                    <div className="absolute z-10 left-0 right-0 mt-1 bg-gray-800 border border-gray-700 rounded-xl overflow-hidden shadow-xl max-h-48 overflow-y-auto">
                      {taxInvoiceMatchedContacts.length === 0 ? (
                        <div className="px-4 py-3 text-gray-500 text-xs">ไม่พบผู้ติดต่อ</div>
                      ) : taxInvoiceMatchedContacts.map(c => (
                        <button key={c.contact_id} onClick={() => pickTaxInvoiceContact(c)}
                          className="w-full text-left px-4 py-2.5 hover:bg-gray-700 transition-colors border-b border-gray-700 last:border-0">
                          <div className="text-white text-sm">{c.company_name || c.name}</div>
                          <div className="text-gray-500 text-xs">{c.phone || 'ไม่มีเบอร์'}{c.tax_id ? ` · ${c.tax_id}` : ''}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-gray-400 text-xs mb-1.5">ชื่อผู้ซื้อ / บริษัท *</label>
                  <input value={taxInvoiceForm.buyer_name} onChange={e => setTaxInvoiceForm(f => ({ ...f, buyer_name: e.target.value }))}
                    className="w-full bg-gray-800 text-white text-sm px-4 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500" />
                </div>
                <div>
                  <label className="block text-gray-400 text-xs mb-1.5">เบอร์โทรศัพท์</label>
                  <input value={taxInvoiceForm.buyer_phone} onChange={e => setTaxInvoiceForm(f => ({ ...f, buyer_phone: e.target.value }))}
                    className="w-full bg-gray-800 text-white text-sm px-4 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500"
                    placeholder="08x-xxx-xxxx" />
                </div>
                <div>
                  <label className="block text-gray-400 text-xs mb-1.5">เลขประจำตัวผู้เสียภาษี (13 หลัก) *</label>
                  <input value={taxInvoiceForm.buyer_tax_id} onChange={e => setTaxInvoiceForm(f => ({ ...f, buyer_tax_id: e.target.value }))}
                    className="w-full bg-gray-800 text-white text-sm px-4 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500"
                    placeholder="0-0000-00000-00-0" maxLength={17} />
                </div>
                <div>
                  <label className="block text-gray-400 text-xs mb-1.5">ที่อยู่</label>
                  <textarea value={taxInvoiceForm.buyer_address} rows={2} onChange={e => setTaxInvoiceForm(f => ({ ...f, buyer_address: e.target.value }))}
                    className="w-full bg-gray-800 text-white text-sm px-4 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500 resize-none" />
                </div>
                <div>
                  <label className="block text-gray-400 text-xs mb-1.5">สาขา</label>
                  <input value={taxInvoiceForm.buyer_branch} onChange={e => setTaxInvoiceForm(f => ({ ...f, buyer_branch: e.target.value }))}
                    className="w-full bg-gray-800 text-white text-sm px-4 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500"
                    placeholder="สำนักงานใหญ่" />
                </div>
              </div>
              <button onClick={issueTaxInvoice} disabled={taxInvoiceIssuing}
                className="w-full mt-5 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-colors">
                {taxInvoiceIssuing ? 'กำลังออกใบกำกับภาษี...' : '🧾 ออกใบกำกับภาษี + พิมพ์'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ PRODUCT FORM MODAL ══════════════════════════════════════════════ */}
      {showProdForm && (
        <div className="fixed inset-0 z-40 bg-black/60 flex items-end sm:items-center justify-center p-4">
          <div className="bg-gray-900 rounded-2xl w-full max-w-md max-h-[92vh] overflow-y-auto">
            <div className="p-5 border-b border-gray-800 flex items-center justify-between">
              <h3 className="text-white font-bold">{editProd ? 'แก้ไขสินค้า' : 'เพิ่มสินค้าใหม่'}</h3>
              <button onClick={() => { setShowProdForm(false); setEditProd(null); }} className="text-gray-500 hover:text-white text-xl">✕</button>
            </div>
            <div className="p-5 space-y-4">

              {/* ── ประเภทสินค้า 3 ปุ่ม ── */}
              <div>
                <label className="text-gray-400 text-xs block mb-1.5">ประเภทสินค้า</label>
                <div className="flex gap-1.5">
                  {[
                    { v: 'ไม่นับสต็อค', label: '🛠️', sub: 'ไม่นับสต็อค', desc: 'บริการ' },
                    { v: 'นับสต็อค',    label: '📦', sub: 'นับสต็อค',    desc: 'สินค้าทั่วไป' },
                    ...(hasFeature(shopInfo?.subscription_tier, 'cyclical_stock')
                      ? [{ v: 'หมุนเวียน', label: '🔄', sub: 'หมุนเวียน', desc: 'ถัง/กล่อง' }]
                      : []),
                  ].map(opt => (
                    <button key={opt.v} type="button" onClick={() => setProdForm(f => ({ ...f, type: opt.v }))}
                      className={`flex-1 py-2 px-1 rounded-xl text-xs font-medium transition-colors border flex flex-col items-center gap-0.5 ${
                        prodForm.type === opt.v
                          ? 'bg-green-700 border-green-600 text-white'
                          : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
                      }`}>
                      <span className="text-base">{opt.label}</span>
                      <span className="font-semibold">{opt.sub}</span>
                      <span className={`text-[10px] ${prodForm.type === opt.v ? 'text-green-300' : 'text-gray-500'}`}>{opt.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* ── ชื่อสินค้า ── */}
              <div>
                <label className="block text-gray-400 text-xs mb-1.5">ชื่อสินค้า *</label>
                <input value={prodForm.name} onChange={e => setProdForm(f => ({...f, name: e.target.value}))}
                  className="w-full bg-gray-800 text-white text-sm px-4 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500"
                  placeholder="เช่น เบียช้าง 320ml" />
              </div>

              {/* ── รหัสสินค้า + บาร์โค้ด ── */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-gray-400 text-xs mb-1.5">รหัสสินค้า</label>
                  <input value={prodForm.product_code} onChange={e => setProdForm(f => ({...f, product_code: e.target.value}))}
                    className="w-full bg-gray-800 text-white text-sm px-4 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500"
                    placeholder="เช่น BV-001" />
                </div>
                <div>
                  <label className="block text-gray-400 text-xs mb-1.5">บาร์โค้ด</label>
                  <input value={prodForm.barcode} onChange={e => setProdForm(f => ({...f, barcode: e.target.value}))}
                    className="w-full bg-gray-800 text-white text-sm px-4 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500"
                    placeholder="8850999..." />
                </div>
              </div>

              {/* ── หมวดหมู่ + หน่วย ── */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-gray-400 text-xs mb-1.5">หมวดหมู่</label>
                  <input value={prodForm.category} onChange={e => setProdForm(f => ({...f, category: e.target.value}))}
                    className="w-full bg-gray-800 text-white text-sm px-4 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500"
                    placeholder="เครื่องดื่ม" />
                </div>
                <div>
                  <label className="block text-gray-400 text-xs mb-1.5">หน่วย</label>
                  <input list="unit-options" value={prodForm.unit}
                    onChange={e => setProdForm(f => ({...f, unit: e.target.value}))}
                    placeholder="ชิ้น, ถัง, กก."
                    className="w-full bg-gray-800 text-white text-sm px-4 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500" />
                  <datalist id="unit-options">
                    {UNITS.map(u => <option key={u} value={u} />)}
                  </datalist>
                </div>
              </div>

              {/* ── ราคาขาย + ราคาทุน ── */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-gray-400 text-xs mb-1.5">ราคาขาย (บาท)</label>
                  <input type="number" value={prodForm.price} onChange={e => setProdForm(f => ({...f, price: e.target.value}))}
                    className="w-full bg-gray-800 text-white text-sm px-4 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500"
                    placeholder="0" min="0" />
                </div>
                <div>
                  <label className="block text-gray-400 text-xs mb-1.5">ราคาทุนเฉลี่ย</label>
                  <div className="w-full bg-gray-800/50 text-gray-400 text-sm px-4 py-2.5 rounded-xl border border-gray-700/50">
                    {editProd?.cost > 0 ? `฿${editProd.cost.toLocaleString()}` : '— คำนวณอัตโนมัติ'}
                  </div>
                </div>
              </div>

              {/* ── VAT ── */}
              <div>
                <label className="block text-gray-400 text-xs mb-1.5">ราคานี้</label>
                <div className="flex gap-1.5">
                  {['ไม่มี VAT', 'รวม VAT แล้ว', 'ไม่รวม VAT'].map(v => (
                    <button key={v} type="button" onClick={() => setProdForm(f => ({ ...f, vat_type: v }))}
                      className={`flex-1 py-2 rounded-xl text-xs font-medium transition-colors border ${
                        prodForm.vat_type === v
                          ? 'bg-blue-700 border-blue-600 text-white'
                          : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
                      }`}>
                      {v}
                    </button>
                  ))}
                </div>
              </div>

              {/* ── สต็อค (แสดงเฉพาะนับสต็อค / หมุนเวียน) ── */}
              {prodForm.type !== 'ไม่นับสต็อค' && (
                <div>
                  <label className="block text-gray-400 text-xs mb-1.5">
                    {prodForm.type === 'หมุนเวียน' ? 'สต็อคพร้อมขาย' : 'จำนวนสต็อคเริ่มต้น'}
                  </label>
                  <input type="number" value={prodForm.stock} onChange={e => setProdForm(f => ({...f, stock: e.target.value}))}
                    className="w-full bg-gray-800 text-white text-sm px-4 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500"
                    placeholder="0" min="0" />
                </div>
              )}

              {/* ── เพดานเปล่ารอรีฟิล (เฉพาะสินค้าหมุนเวียน) ── */}
              {prodForm.type === 'หมุนเวียน' && (
                <div>
                  <label className="block text-gray-400 text-xs mb-1.5">เพดานเปล่ารอรีฟิล (แจ้งเตือนถ้าเกิน — เว้นว่าง/0 = ไม่ตั้งเพดาน)</label>
                  <input type="number" value={prodForm.empty_ceiling} onChange={e => setProdForm(f => ({...f, empty_ceiling: e.target.value}))}
                    className="w-full bg-gray-800 text-white text-sm px-4 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500"
                    placeholder="0" min="0" />
                </div>
              )}

              {/* ── สาขาที่ขาย (แสดงเฉพาะร้านที่มีมากกว่า 1 สาขา) ── */}
              {posBranches.length > 0 && (
                <div>
                  <label className="block text-gray-400 text-xs mb-1.5">สาขาที่ขาย (ไม่เลือก = ขายได้ทุกสาขา)</label>
                  <div className="flex flex-wrap gap-2">
                    {posBranches.map(b => {
                      const checked = prodForm.branches.includes(b.branch_name);
                      return (
                        <button key={b.id} type="button"
                          onClick={() => setProdForm(f => ({
                            ...f,
                            branches: checked ? f.branches.filter(x => x !== b.branch_name) : [...f.branches, b.branch_name],
                          }))}
                          className={`text-xs font-bold px-3 py-2 rounded-xl border-2 transition-colors ${checked ? 'bg-green-900/40 border-green-600 text-green-300' : 'bg-gray-800 border-gray-700 text-gray-400'}`}>
                          {checked ? '✓ ' : ''}{b.brand_name || b.branch_name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ── รายละเอียดสินค้า ── */}
              <div>
                <label className="block text-gray-400 text-xs mb-1.5">รายละเอียดสินค้า</label>
                <textarea value={prodForm.description} onChange={e => setProdForm(f => ({...f, description: e.target.value}))}
                  rows={2}
                  className="w-full bg-gray-800 text-white text-sm px-4 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500 resize-none"
                  placeholder="คำอธิบายเพิ่มเติม เช่น ขนาด, สี, คุณสมบัติ" />
              </div>

              {/* ── คำค้น / ชื่ออื่น ── */}
              <div>
                <label className="block text-gray-400 text-xs mb-1.5">คำค้น / ชื่ออื่น</label>
                <input value={prodForm.aliases} onChange={e => setProdForm(f => ({...f, aliases: e.target.value}))}
                  className="w-full bg-gray-800 text-white text-sm px-4 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500"
                  placeholder="เช่น chang, ช้าง, 320ml" />
                <p className="text-gray-600 text-xs mt-1">ช่วยให้บอท LINE จับคู่ชื่อสินค้าบนบิลซื้อได้</p>
              </div>

              {/* ── หมายเหตุ ── */}
              <div>
                <label className="block text-gray-400 text-xs mb-1.5">หมายเหตุ</label>
                <input value={prodForm.notes} onChange={e => setProdForm(f => ({...f, notes: e.target.value}))}
                  className="w-full bg-gray-800 text-white text-sm px-4 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500"
                  placeholder="ไม่บังคับ" />
              </div>

              {/* ── สถานะ active ── */}
              <label className="flex items-center gap-3 cursor-pointer select-none">
                <div className={`relative w-11 h-6 rounded-full transition-colors ${prodForm.is_active ? 'bg-green-600' : 'bg-gray-700'}`}
                  onClick={() => setProdForm(f => ({ ...f, is_active: !f.is_active }))}>
                  <div className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${prodForm.is_active ? 'translate-x-5' : ''}`} />
                </div>
                <span className="text-sm text-gray-300">
                  {prodForm.is_active ? 'แสดงในหน้าขาย (active)' : 'ซ่อนจากหน้าขาย (inactive)'}
                </span>
              </label>

              <button onClick={saveProd} disabled={prodSaving || !prodForm.name}
                className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-colors mt-1">
                {prodSaving ? 'กำลังบันทึก...' : editProd ? 'บันทึกการแก้ไข' : 'เพิ่มสินค้า'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ NEW BILL MODAL ════════════════════════════════════════════════ */}
      {showNewBillModal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
          onClick={() => { setShowNewBillModal(false); setNewBillName(''); setNewBillCust(null); setNewBillCustQ(''); }}>
          <div className="bg-gray-900 rounded-2xl w-full max-w-sm border border-gray-700 shadow-2xl"
            onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-800 flex items-center justify-between">
              <h3 className="text-white font-bold">เปิดบิลใหม่</h3>
              <button onClick={() => { setShowNewBillModal(false); setNewBillName(''); setNewBillCust(null); setNewBillCustQ(''); }}
                className="text-gray-500 hover:text-white text-xl">✕</button>
            </div>
            <div className="p-5 space-y-4">
              {/* ── เลือกลูกค้า ── */}
              <div>
                <label className="block text-gray-400 text-xs mb-1.5">ลูกค้า <span className="text-gray-600">(ไม่บังคับ)</span></label>
                {newBillCust ? (
                  <div className="flex items-center gap-2 bg-green-900/30 border border-green-700/50 rounded-xl px-3 py-2.5">
                    <div className="flex-1 min-w-0">
                      <div className="text-white text-sm font-medium">{newBillCust.name}</div>
                      <div className="text-green-400 text-xs">
                        {newBillCust.shop_name && <span className="mr-2">🏪 {newBillCust.shop_name}</span>}
                        {newBillCust.phone && <span>📞 {newBillCust.phone}</span>}
                      </div>
                    </div>
                    <button onClick={() => { setNewBillCust(null); setNewBillCustQ(''); }}
                      className="text-gray-400 hover:text-red-400 text-lg leading-none shrink-0">×</button>
                  </div>
                ) : (
                  <div className="relative">
                    <input
                      value={newBillCustQ}
                      onChange={e => setNewBillCustQ(e.target.value)}
                      placeholder="ค้นหาชื่อ หรือเบอร์โทร..."
                      className="w-full bg-gray-800 text-white text-sm px-4 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500"
                    />
                    {newBillCustQ.trim().length > 0 && (() => {
                      const q = newBillCustQ.toLowerCase();
                      const qDigits = q.replace(/\D/g, '');
                      const hits = customers.filter(c =>
                        c.name.toLowerCase().includes(q) ||
                        (qDigits.length > 0 && (c.phone || '').replace(/\D/g, '').includes(qDigits)) ||
                        (c.shop_name || '').toLowerCase().includes(q)
                      ).slice(0, 6);
                      return hits.length > 0 ? (
                        <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-gray-800 border border-gray-700 rounded-xl overflow-hidden shadow-xl">
                          {hits.map(c => (
                            <button key={c.contact_id} type="button"
                              onClick={() => { setNewBillCust(c); setNewBillCustQ(''); }}
                              className="w-full text-left px-4 py-2.5 hover:bg-gray-700 transition-colors border-b border-gray-700/50 last:border-0">
                              <div className="text-white text-sm">{c.name}</div>
                              <div className="text-gray-400 text-xs">
                                {c.shop_name && <span className="mr-2">🏪 {c.shop_name}</span>}
                                {c.phone && <span>📞 {c.phone}</span>}
                              </div>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-gray-500 text-sm shadow-xl">
                          ไม่พบลูกค้า
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>

              {/* ── ชื่อบิล (optional override) ── */}
              <div>
                <label className="block text-gray-400 text-xs mb-1.5">
                  ชื่อโต๊ะ / บิล <span className="text-gray-600">(ถ้าไม่ระบุ ใช้ชื่อลูกค้า หรือ "cash sale")</span>
                </label>
                <input
                  value={newBillName}
                  onChange={e => setNewBillName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && createBill(newBillName, newBillCust)}
                  placeholder={newBillCust ? newBillCust.name : `เช่น โต๊ะ ${openBills.length + 1}, Take Away`}
                  className="w-full bg-gray-800 text-white text-sm px-4 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500"
                />
              </div>

              {/* quick-pick จากชื่อที่ตั้งค่าไว้ (กรองออกที่เปิดอยู่แล้ว) */}
              {tableNames.filter(n => !openBills.some(b => b.name === n)).length > 0 && (
                <div>
                  <div className="text-gray-500 text-xs mb-2">โต๊ะที่ตั้งค่าไว้</div>
                  <div className="flex flex-wrap gap-2">
                    {tableNames
                      .filter(n => !openBills.some(b => b.name === n))
                      .map(name => (
                        <button key={name} onClick={() => createBill(name)}
                          className="bg-gray-800 hover:bg-green-800 text-gray-200 text-sm px-4 py-2 rounded-xl border border-gray-700 hover:border-green-600 transition-colors">
                          {name}
                        </button>
                      ))}
                  </div>
                </div>
              )}

              {/* บิลที่เปิดอยู่แล้ว (ถ้ามี) */}
              {openBills.length > 0 && tableNames.filter(n => openBills.some(b => b.name === n)).length > 0 && (
                <div>
                  <div className="text-gray-600 text-xs mb-2">เปิดอยู่แล้ว</div>
                  <div className="flex flex-wrap gap-2">
                    {tableNames.filter(n => openBills.some(b => b.name === n)).map(name => (
                      <span key={name} className="bg-gray-900 text-gray-600 text-xs px-3 py-1.5 rounded-xl border border-gray-800 line-through">
                        {name}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <button onClick={() => { setShowNewBillModal(false); setNewBillName(''); setNewBillCust(null); setNewBillCustQ(''); }}
                  className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 py-2.5 rounded-xl text-sm transition-colors">
                  ยกเลิก
                </button>
                <button onClick={() => createBill(newBillName, newBillCust)}
                  className="flex-[2] bg-green-600 hover:bg-green-500 text-white font-bold py-2.5 rounded-xl text-sm transition-colors">
                  ＋ เปิดบิล
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══ CONTACT FORM MODAL ════════════════════════════════════════════ */}
      {showContactForm && (
        <div className="fixed inset-0 z-40 bg-black/60 flex items-end sm:items-center justify-center p-4">
          <div className="bg-gray-900 rounded-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
            {/* header — sticky */}
            <div className="p-4 border-b border-gray-800 flex items-center justify-between sticky top-0 bg-gray-900 z-10">
              <h3 className="text-white font-bold">{editContact ? 'แก้ไขผู้ติดต่อ' : 'เพิ่มผู้ติดต่อ'}</h3>
              <button onClick={() => { setShowContactForm(false); setEditContact(null); }} className="text-gray-500 hover:text-white text-xl w-8 h-8 flex items-center justify-center">✕</button>
            </div>

            <div className="p-5 space-y-4">
              {/* ชื่อ */}
              <div>
                <label className="block text-gray-400 text-xs mb-1.5">ชื่อ / บริษัท *</label>
                <input value={contactForm.name} onChange={e => setContactForm(f => ({...f, name: e.target.value}))}
                  className="w-full bg-gray-800 text-white text-sm px-4 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500"
                  placeholder="เช่น คุณสมชาย หรือ บริษัท ABC จำกัด" autoFocus />
              </div>

              {/* ประเภท — 3 ตัวเลือก */}
              <div>
                <label className="block text-gray-400 text-xs mb-1.5">ประเภท</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { key: 'ผู้จำหน่าย', icon: '🏢' },
                    { key: 'ลูกค้า',    icon: '👤' },
                    { key: 'ทั้งคู่',   icon: '🤝' },
                  ].map(({ key, icon }) => (
                    <button key={key} type="button" onClick={() => setContactForm(f => ({...f, contact_type: key}))}
                      className={`py-2.5 rounded-xl text-sm font-medium transition-colors ${
                        contactForm.contact_type === key ? 'bg-green-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                      }`}>
                      {icon} {key}
                    </button>
                  ))}
                </div>
              </div>

              {/* เบอร์โทร + อีเมล */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-gray-400 text-xs mb-1.5">เบอร์โทร</label>
                  <input value={contactForm.phone} onChange={e => setContactForm(f => ({...f, phone: e.target.value}))}
                    className="w-full bg-gray-800 text-white text-sm px-3 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500"
                    placeholder="0812345678" type="tel" />
                </div>
                <div>
                  <label className="block text-gray-400 text-xs mb-1.5">อีเมล</label>
                  <input value={contactForm.email} onChange={e => setContactForm(f => ({...f, email: e.target.value}))}
                    className="w-full bg-gray-800 text-white text-sm px-3 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500"
                    placeholder="email@example.com" type="email" />
                </div>
              </div>

              {/* ชื่อร้านค้า */}
              <div>
                <label className="block text-gray-400 text-xs mb-1.5">ชื่อร้านค้า</label>
                <input value={contactForm.shop_name} onChange={e => setContactForm(f => ({...f, shop_name: e.target.value}))}
                  className="w-full bg-gray-800 text-white text-sm px-4 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500"
                  placeholder="ชื่อร้าน (ถ้ามี)" />
              </div>

              {/* ที่อยู่จัดส่ง — แสดงเมื่อเป็นลูกค้า/ทั้งคู่ */}
              {(contactForm.contact_type === 'ลูกค้า' || contactForm.contact_type === 'ทั้งคู่') && (
                <>
                  {[1, 2].map(slot => (
                    <div key={slot} className="border border-gray-700 rounded-xl p-3 space-y-2">
                      <div className="text-gray-400 text-xs font-medium">
                        📍 ที่อยู่จัดส่งที่ {slot}{slot === 1 ? ' (หลัก)' : ' (เพิ่มเติม)'}
                      </div>
                      <textarea
                        value={contactForm[`address_${slot}`]}
                        onChange={e => setContactForm(f => ({ ...f, [`address_${slot}`]: e.target.value }))}
                        className="w-full bg-gray-800 text-white text-sm px-3 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500 resize-none" rows={2}
                        placeholder={slot === 1 ? 'บ้านเลขที่ ถนน ตำบล อำเภอ จังหวัด' : 'ที่อยู่ที่ 2 (ถ้ามี)'} />
                      {contactForm[`maps_${slot}`] ? (
                        <div className="flex items-center gap-2">
                          <span className="text-green-400 text-xs flex-1 truncate">✅ ปักหมุดแล้ว</span>
                          <button type="button" onClick={() => openMapPicker(slot)} className="text-xs text-blue-400 hover:text-blue-300 shrink-0">แก้ไข</button>
                          <a href={contactForm[`maps_${slot}`]} target="_blank" rel="noreferrer" className="text-xs text-gray-400 hover:text-gray-200 shrink-0">ดู</a>
                          <button type="button" onClick={() => setContactForm(f => ({ ...f, [`maps_${slot}`]: '' }))} className="text-xs text-gray-500 hover:text-red-400 shrink-0">ลบ</button>
                        </div>
                      ) : (
                        <button type="button" onClick={() => openMapPicker(slot)}
                          className="w-full flex items-center justify-center gap-1.5 bg-gray-700 hover:bg-green-800 text-gray-300 hover:text-green-300 text-xs py-2 rounded-xl border border-gray-600 hover:border-green-700 transition-colors">
                          🗺️ เปิดแผนที่วางหมุด
                        </button>
                      )}
                    </div>
                  ))}
                </>
              )}

              {/* ประเภทบุคคล */}
              <div>
                <label className="block text-gray-400 text-xs mb-1.5">ประเภทบุคคล</label>
                <div className="grid grid-cols-2 gap-2">
                  {['บุคคลธรรมดา', 'นิติบุคคล'].map(pt => (
                    <button key={pt} type="button"
                      onClick={() => setContactForm(f => ({ ...f, person_type: pt }))}
                      className={`py-2.5 rounded-xl text-sm font-medium transition-colors ${
                        contactForm.person_type === pt ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                      }`}>
                      {pt === 'บุคคลธรรมดา' ? '👤 บุคคลธรรมดา' : '🏢 นิติบุคคล'}
                    </button>
                  ))}
                </div>
              </div>

              {/* ฟิลด์เพิ่มเติมสำหรับนิติบุคคล */}
              {contactForm.person_type === 'นิติบุคคล' && (
                <div className="bg-blue-950/40 border border-blue-800/50 rounded-xl p-4 space-y-3">
                  <p className="text-blue-300 text-xs font-medium">🏢 ข้อมูลนิติบุคคล</p>
                  <div>
                    <label className="block text-gray-400 text-xs mb-1.5">เลขประจำตัวผู้เสียภาษี (13 หลัก)</label>
                    <input value={contactForm.tax_id} onChange={e => setContactForm(f => ({...f, tax_id: e.target.value}))}
                      className="w-full bg-gray-800 text-white text-sm px-3 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-blue-500"
                      placeholder="0-0000-00000-00-0" maxLength={17} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-gray-400 text-xs mb-1.5">ชื่อผู้ติดต่อ</label>
                      <input value={contactForm.contact_person_name} onChange={e => setContactForm(f => ({...f, contact_person_name: e.target.value}))}
                        className="w-full bg-gray-800 text-white text-sm px-3 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-blue-500"
                        placeholder="ชื่อ-นามสกุล" />
                    </div>
                    <div>
                      <label className="block text-gray-400 text-xs mb-1.5">เบอร์โทรผู้ติดต่อ</label>
                      <input value={contactForm.contact_person_phone} onChange={e => setContactForm(f => ({...f, contact_person_phone: e.target.value}))}
                        className="w-full bg-gray-800 text-white text-sm px-3 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-blue-500"
                        placeholder="0812345678" type="tel" />
                    </div>
                  </div>
                </div>
              )}

              {/* ข้อมูลบริษัท/ภาษี — accordion (บุคคลธรรมดาก็ยังมีตัวเลือกนี้) */}
              <div className="border border-gray-700 rounded-xl overflow-hidden">
                <button type="button" onClick={() => setShowTaxSection(v => !v)}
                  className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:bg-gray-800 transition-colors">
                  <span>🏛️ ข้อมูลบริษัท / ที่อยู่ภาษี</span>
                  <span className="text-gray-600 text-xs">{showTaxSection ? '▲ ซ่อน' : '▼ แสดง'}</span>
                </button>
                {showTaxSection && (
                  <div className="px-4 pb-4 space-y-3 border-t border-gray-700">
                    <div className="mt-3">
                      <label className="block text-gray-400 text-xs mb-1.5">ชื่อบริษัท / นิติบุคคล</label>
                      <input value={contactForm.company_name} onChange={e => setContactForm(f => ({...f, company_name: e.target.value}))}
                        className="w-full bg-gray-800 text-white text-sm px-3 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500"
                        placeholder="ชื่อบริษัทตามที่จดทะเบียน" />
                    </div>
                    {contactForm.person_type !== 'นิติบุคคล' && (
                      <div>
                        <label className="block text-gray-400 text-xs mb-1.5">เลขภาษี (13 หลัก)</label>
                        <input value={contactForm.tax_id} onChange={e => setContactForm(f => ({...f, tax_id: e.target.value}))}
                          className="w-full bg-gray-800 text-white text-sm px-3 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500"
                          placeholder="0-0000-00000-00-0" />
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-gray-400 text-xs mb-1.5">สาขา / สำนักงาน</label>
                        <input value={contactForm.tax_branch} onChange={e => setContactForm(f => ({...f, tax_branch: e.target.value}))}
                          className="w-full bg-gray-800 text-white text-sm px-3 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500"
                          placeholder="สำนักงานใหญ่" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-gray-400 text-xs mb-1.5">ที่อยู่ภาษี</label>
                      <textarea value={contactForm.tax_address} onChange={e => setContactForm(f => ({...f, tax_address: e.target.value}))}
                        className="w-full bg-gray-800 text-white text-sm px-3 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500 resize-none" rows={2}
                        placeholder="ที่อยู่ตามที่จดทะเบียนภาษี" />
                    </div>
                  </div>
                )}
              </div>

              {/* aliases */}
              <div>
                <label className="block text-gray-400 text-xs mb-1.5">คำค้น / ชื่ออื่น / aliases</label>
                <input value={contactForm.aliases} onChange={e => setContactForm(f => ({...f, aliases: e.target.value}))}
                  className="w-full bg-gray-800 text-white text-sm px-4 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500"
                  placeholder="เช่น แก๊สซัพ, กรุงเทพกลการ" />
                <p className="text-gray-600 text-xs mt-1">บอท LINE จะใช้คำเหล่านี้จับคู่ชื่อบนสลิป/บิล</p>
              </div>

              {/* notes */}
              <div>
                <label className="block text-gray-400 text-xs mb-1.5">หมายเหตุ</label>
                <input value={contactForm.notes} onChange={e => setContactForm(f => ({...f, notes: e.target.value}))}
                  className="w-full bg-gray-800 text-white text-sm px-4 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500"
                  placeholder="เช่น ต้องโทรก่อนส่ง, รับของเวลาเช้าเท่านั้น" />
              </div>

              {/* ยอดค้าง + ถัง — เฉพาะลูกค้า */}
              {(contactForm.contact_type === 'ลูกค้า' || contactForm.contact_type === 'ทั้งคู่') && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-gray-400 text-xs mb-1.5">ยอดค้าง (บาท)</label>
                    <input value={contactForm.debt} onChange={e => setContactForm(f => ({...f, debt: e.target.value}))}
                      type="number" min="0"
                      className="w-full bg-gray-800 text-white text-sm px-3 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500"
                      placeholder="0" />
                  </div>
                  <div>
                    <label className="block text-gray-400 text-xs mb-1.5">ถังอยู่กับลูกค้า</label>
                    <input value={contactForm.cylinders} onChange={e => setContactForm(f => ({...f, cylinders: e.target.value}))}
                      type="number" min="0"
                      className="w-full bg-gray-800 text-white text-sm px-3 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500"
                      placeholder="0" />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-gray-400 text-xs mb-1.5">วงเงินยืมสูงสุด (ชิ้น) — เว้นว่าง/0 = ไม่จำกัด</label>
                    <input value={contactForm.cylinder_limit} onChange={e => setContactForm(f => ({...f, cylinder_limit: e.target.value}))}
                      type="number" min="0"
                      className="w-full bg-gray-800 text-white text-sm px-3 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500"
                      placeholder="ไม่จำกัด" />
                  </div>
                </div>
              )}

              <button onClick={saveContact} disabled={contactSaving || !contactForm.name}
                className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-colors">
                {contactSaving ? 'กำลังบันทึก...' : editContact ? 'บันทึกการแก้ไข' : 'เพิ่มผู้ติดต่อ'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ STAFF FORM MODAL ═══════════════════════════════════════════════ */}
      {showStaffForm && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
          <div className="bg-gray-900 rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="p-5">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-white font-bold text-lg">{editStaff ? 'แก้ไขพนักงาน' : 'เพิ่มพนักงาน'}</h3>
                <button onClick={() => setShowStaffForm(false)} className="text-gray-400 hover:text-white text-2xl leading-none transition-colors">×</button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-gray-400 text-xs block mb-1">ชื่อพนักงาน *</label>
                  <input value={staffForm.name} onChange={e => setStaffForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full bg-gray-800 text-white text-sm px-3 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500"
                    placeholder="ชื่อ-นามสกุล" />
                </div>
                <div>
                  <label className="text-gray-400 text-xs block mb-1">เบอร์โทรศัพท์</label>
                  <input value={staffForm.phone} onChange={e => setStaffForm(f => ({ ...f, phone: e.target.value }))}
                    className="w-full bg-gray-800 text-white text-sm px-3 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500"
                    placeholder="0812345678" type="tel" />
                </div>
                <div>
                  <label className="text-gray-400 text-xs block mb-1">LINE User ID</label>
                  <input value={staffForm.line_id} onChange={e => setStaffForm(f => ({ ...f, line_id: e.target.value }))}
                    className="w-full bg-gray-800 text-white text-sm px-3 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500"
                    placeholder="เช่น Uf3d9a8b2c1e4f5a6..." />
                  <p className="text-gray-600 text-xs mt-1">ดู User ID ได้จาก LINE Developers Console → Basic settings → Your user ID</p>
                </div>
                <div>
                  <label className="text-gray-400 text-xs block mb-1">บทบาท</label>
                  <select value={staffForm.role} onChange={e => setStaffForm(f => ({ ...f, role: e.target.value }))}
                    className="w-full bg-gray-800 text-white text-sm px-3 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500">
                    {['พนักงานส่ง', 'พนักงานขาย', 'หัวหน้าทีม', 'แคชเชียร์', 'อื่นๆ'].map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-gray-400 text-xs block mb-1">หมายเหตุ</label>
                  <input value={staffForm.notes} onChange={e => setStaffForm(f => ({ ...f, notes: e.target.value }))}
                    className="w-full bg-gray-800 text-white text-sm px-3 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500"
                    placeholder="ไม่บังคับ" />
                </div>
                <div className="bg-gray-800/60 rounded-xl p-3 border border-gray-700">
                  <label className="text-gray-400 text-xs block mb-2">🔑 สิทธิ์เข้าถึงหน้าพนักงาน (ไม่บังคับ — ผ่าน PIN ที่ /pos-staff หรือลิงก์แคชเชียร์)</label>

                  {/* ตำแหน่งสำเร็จรูป — กดแล้วติ๊กสิทธิ์แนะนำให้อัตโนมัติ ยังแก้ทีละอันต่อได้ */}
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {Object.keys(STAFF_PRESETS).map(presetName => (
                      <button key={presetName} type="button"
                        onClick={() => {
                          const keys = STAFF_PRESETS[presetName];
                          const perms = emptyStaffPerms();
                          keys.forEach(k => { perms[k] = true; });
                          setStaffForm(f => ({ ...f, ...perms }));
                          setStaffPreset(presetName);
                        }}
                        className={`text-xs font-bold px-2.5 py-1.5 rounded-lg transition-colors ${staffPreset === presetName ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
                        {presetName}
                      </button>
                    ))}
                  </div>

                  <div className="space-y-2">
                    {STAFF_PERM_DEFS.map(p => (
                      <label key={p.key} className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={!!staffForm[p.key]}
                          onChange={e => { setStaffForm(f => ({ ...f, [p.key]: e.target.checked })); setStaffPreset(''); }}
                          className="w-4 h-4 accent-green-600" />
                        <span className="text-gray-300 text-xs">{p.icon} {p.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex gap-3 mt-5">
                <button onClick={() => setShowStaffForm(false)} className="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-bold py-3 rounded-xl transition-colors text-sm">ยกเลิก</button>
                <button onClick={() => saveStaffMember()} disabled={staffSaving || !staffForm.name.trim()}
                  className="flex-1 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-colors text-sm">
                  {staffSaving ? 'กำลังบันทึก...' : editStaff ? 'บันทึกการแก้ไข' : 'เพิ่มพนักงาน'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══ Modal: รับคืน / รีฟิล สินค้าหมุนเวียน ══════════════════════ */}
      {showCyclicalModal && cyclicalProd && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-gray-900 rounded-2xl w-full max-w-sm border border-gray-700 shadow-2xl">
            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-white font-bold">
                  {showCyclicalModal === 'receive-back' ? '🔄 รับถังคืนจากลูกค้า' : '⛽ รีฟิลถังเปล่า'}
                </h3>
                <button onClick={() => setShowCyclicalModal(null)} className="text-gray-400 hover:text-white text-2xl leading-none">×</button>
              </div>
              <div className="bg-gray-800 rounded-xl p-3 mb-4">
                <div className="text-white font-medium text-sm">{cyclicalProd.name}</div>
                <div className="flex gap-3 mt-1.5 text-xs">
                  <span className="text-green-400">เต็ม {cyclicalProd.stock}</span>
                  <span className="text-orange-400">กับลูกค้า {cyclicalProd.at_customer || 0}</span>
                  <span className="text-gray-400">เปล่า {cyclicalProd.empty_waiting || 0}</span>
                </div>
              </div>
              <div className="mb-4">
                <label className="text-gray-400 text-xs block mb-1.5">
                  {showCyclicalModal === 'receive-back' ? `จำนวนที่รับคืน (${cyclicalProd.unit})` : `จำนวนที่รีฟิล (${cyclicalProd.unit})`}
                </label>
                <input type="number" min="1" value={cyclicalQty} onChange={e => setCyclicalQty(e.target.value)}
                  className="w-full bg-gray-800 text-white text-lg font-bold px-4 py-3 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500"
                  placeholder="0" autoFocus />
              </div>
              <div className="flex gap-3">
                <button onClick={() => setShowCyclicalModal(null)} className="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-bold py-3 rounded-xl transition-colors text-sm">ยกเลิก</button>
                <button onClick={doCyclicalAction} disabled={cyclicalSaving || !cyclicalQty || parseInt(cyclicalQty) <= 0}
                  className="flex-[2] bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-colors text-sm">
                  {cyclicalSaving ? 'กำลังบันทึก...' : showCyclicalModal === 'receive-back' ? `รับคืน ${cyclicalQty || 0}` : `รีฟิล ${cyclicalQty || 0}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══ DELIVERY MODAL ════════════════════════════════════════════════ */}
      {showDelivery && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
          <div className="bg-gray-900 rounded-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
            <div className="p-5 border-b border-gray-800 flex items-center justify-between">
              <div>
                <h3 className="text-white font-bold text-lg">🛵 ส่งสินค้า</h3>
                <div className="text-gray-400 text-xs mt-0.5">ขั้นตอน {delivStep}/2: {delivStep === 1 ? 'เลือกลูกค้า' : 'เลือกที่อยู่ + พนักงาน'}</div>
              </div>
              <button onClick={() => setShowDelivery(false)} className="text-gray-400 hover:text-white text-2xl leading-none transition-colors">×</button>
            </div>

            <div className="p-5">
              {/* ── ขั้นตอนที่ 1: เลือกลูกค้า ─────────────────────────────────── */}
              {delivStep === 1 && (
                <div className="space-y-3">
                  {/* สรุปออเดอร์ */}
                  <div className="bg-gray-800 rounded-xl p-3">
                    <div className="text-gray-400 text-xs mb-2">สินค้าในออเดอร์</div>
                    {cart.map(item => (
                      <div key={item.sku} className="flex justify-between text-sm py-0.5">
                        <span className="text-white">{item.name} <span className="text-gray-500">×{item.qty}</span></span>
                        <span className="text-green-400">฿{(item.price * item.qty).toLocaleString()}</span>
                      </div>
                    ))}
                    <div className="border-t border-gray-700 mt-2 pt-2 flex justify-between font-bold">
                      <span className="text-gray-300 text-sm">รวม</span>
                      <span className="text-white">฿{cartTotal.toLocaleString()}</span>
                    </div>
                  </div>

                  <div>
                    <label className="text-gray-400 text-xs block mb-1.5">ค้นหาลูกค้า</label>
                    <input value={delivCustSearch} onChange={e => setDelivCustSearch(e.target.value)}
                      className="w-full bg-gray-800 text-white text-sm px-3 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500"
                      placeholder="ชื่อหรือเบอร์โทร..." autoFocus />
                  </div>

                  {/* ลิสลูกค้า */}
                  <div className="space-y-1.5 max-h-64 overflow-y-auto">
                    {delivMatchedCustomers.map(c => (
                      <button key={c.contact_id}
                        onClick={() => { setDelivCust(c); setDelivStep(2); fetchCustomerPrices(c.contact_id); }}
                        className="w-full text-left bg-gray-800 hover:bg-gray-700 rounded-xl p-3 transition-colors flex items-center justify-between gap-2">
                        <div>
                          <div className="text-white text-sm font-medium">{c.name}</div>
                          {c.phone && <div className="text-gray-400 text-xs">{c.phone}</div>}
                          {c.address_1 && <div className="text-gray-500 text-xs truncate max-w-xs">{c.address_1}</div>}
                        </div>
                        <span className="text-green-400 text-lg shrink-0">›</span>
                      </button>
                    ))}
                    {delivMatchedCustomers.length === 0 && (
                      <div className="text-center py-6 text-gray-500 text-sm">
                        ไม่พบลูกค้า —{' '}
                        <button onClick={() => { setShowDelivery(false); setTab('contacts'); }} className="text-green-400 underline">เพิ่มลูกค้าใหม่</button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ── ขั้นตอนที่ 2: ที่อยู่ + พนักงาน ───────────────────────────────── */}
              {delivStep === 2 && delivCust && (
                <div className="space-y-4">
                  {/* ลูกค้าที่เลือก */}
                  <div className="bg-gray-800 rounded-xl p-3 flex items-center justify-between">
                    <div>
                      <div className="text-white font-medium text-sm">{delivCust.name}</div>
                      {delivCust.phone && <div className="text-gray-400 text-xs">{delivCust.phone}</div>}
                      {Object.keys(customerPrices).length > 0 && (
                        <div className="text-green-400 text-xs mt-0.5">💰 ใช้ราคาประจำตัวแล้ว</div>
                      )}
                    </div>
                    <button onClick={() => setDelivStep(1)} className="text-xs text-green-400 underline">เปลี่ยน</button>
                  </div>

                  {/* เลือกที่อยู่ */}
                  <div>
                    <label className="text-gray-400 text-xs block mb-2">📍 ที่อยู่จัดส่ง</label>
                    <div className="space-y-2">
                      {delivCust.address_1 && (
                        <button onClick={() => setDelivAddrIdx(0)}
                          className={`w-full text-left p-3 rounded-xl border text-sm transition-colors ${delivAddrIdx === 0 ? 'bg-green-900/40 border-green-600 text-green-200' : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'}`}>
                          <div className="font-medium text-xs text-gray-400 mb-0.5">ที่อยู่ 1</div>
                          {delivCust.address_1}
                          {delivCust.maps_1 && <span className="ml-2 text-xs text-green-400">🗺️ มี Maps</span>}
                        </button>
                      )}
                      {delivCust.address_2 && (
                        <button onClick={() => setDelivAddrIdx(1)}
                          className={`w-full text-left p-3 rounded-xl border text-sm transition-colors ${delivAddrIdx === 1 ? 'bg-green-900/40 border-green-600 text-green-200' : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'}`}>
                          <div className="font-medium text-xs text-gray-400 mb-0.5">ที่อยู่ 2</div>
                          {delivCust.address_2}
                          {delivCust.maps_2 && <span className="ml-2 text-xs text-green-400">🗺️ มี Maps</span>}
                        </button>
                      )}
                      <div role="button" tabIndex={0} onClick={() => setDelivAddrIdx(2)}
                        onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && setDelivAddrIdx(2)}
                        className={`w-full text-left p-3 rounded-xl border text-sm transition-colors cursor-pointer ${delivAddrIdx === 2 ? 'bg-green-900/40 border-green-600 text-green-200' : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'}`}>
                        <div className="font-medium text-xs text-gray-400 mb-0.5">ที่อยู่อื่น (พิมพ์เอง)</div>
                        {delivAddrIdx === 2 && (
                          <div className="space-y-1.5 mt-2" onClick={e => e.stopPropagation()}>
                            <input value={delivAddrCustom} onChange={e => setDelivAddrCustom(e.target.value)}
                              className="w-full bg-gray-700 text-white text-sm px-3 py-2 rounded-lg border border-gray-600 focus:outline-none"
                              placeholder="ที่อยู่จัดส่ง..." />
                            {delivMapsCustom ? (
                              <div className="flex items-center gap-2">
                                <span className="text-green-400 text-xs flex-1 truncate">✅ ปักหมุดแล้ว</span>
                                <button type="button" onClick={() => setShowDelivMapPicker(true)} className="text-xs text-blue-400 hover:text-blue-300 shrink-0">แก้ไข</button>
                                <a href={delivMapsCustom} target="_blank" rel="noreferrer" className="text-xs text-gray-400 hover:text-gray-200 shrink-0">ดู</a>
                                <button type="button" onClick={() => setDelivMapsCustom('')} className="text-xs text-gray-500 hover:text-red-400 shrink-0">ลบ</button>
                              </div>
                            ) : (
                              <button type="button" onClick={() => setShowDelivMapPicker(true)}
                                className="w-full flex items-center justify-center gap-1.5 bg-gray-600 hover:bg-green-800 text-gray-300 hover:text-green-300 text-xs py-2 rounded-lg border border-gray-500 hover:border-green-700 transition-colors">
                                🗺️ เปิดแผนที่วางหมุด
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* เลือกพนักงาน */}
                  <div>
                    <label className="text-gray-400 text-xs block mb-2">🛵 พนักงานส่ง</label>
                    {staff.length === 0 ? (
                      <div className="bg-gray-800 rounded-xl p-3 text-center text-sm text-yellow-400">
                        ยังไม่มีพนักงาน —{' '}
                        <button onClick={() => { setShowDelivery(false); setTab('settings'); }} className="underline">เพิ่มพนักงาน</button>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        {staff.map(s => (
                          <button key={s.staff_id} onClick={() => setDelivStaff(s)}
                            className={`p-3 rounded-xl border text-sm text-left transition-colors ${delivStaff?.staff_id === s.staff_id ? 'bg-green-900/40 border-green-600 text-green-200' : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'}`}>
                            <div className="font-medium">{s.name}</div>
                            <div className="text-xs mt-0.5 text-gray-500">{s.role}</div>
                            {!s.line_id && <div className="text-xs text-yellow-500 mt-0.5">⚠️ ไม่มี LINE ID</div>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* วิธีชำระเงิน */}
                  <div>
                    <label className="text-gray-400 text-xs block mb-2">💳 วิธีชำระเงิน</label>
                    <div className="grid grid-cols-3 gap-2">
                      {['เก็บปลายทาง', 'โอนแล้ว', ...(hasFeature(shopInfo?.subscription_tier, 'credit_ar') ? ['ค้างจ่าย'] : [])].map(pm => (
                        <button key={pm} onClick={() => setDelivPayment(pm)}
                          className={`py-2.5 rounded-xl text-xs font-medium transition-colors ${delivPayment === pm ? 'bg-green-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}>
                          {pm}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* หมายเหตุ */}
                  <div>
                    <label className="text-gray-400 text-xs block mb-1.5">หมายเหตุ (ไม่บังคับ)</label>
                    <input value={delivNotes} onChange={e => setDelivNotes(e.target.value)}
                      className="w-full bg-gray-800 text-white text-sm px-3 py-2.5 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500"
                      placeholder="เช่น โทรก่อนถึง 15 นาที" />
                  </div>

                  <div className="flex gap-3 pt-1">
                    <button onClick={() => setDelivStep(1)} className="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-bold py-3 rounded-xl transition-colors text-sm">← กลับ</button>
                    <button
                      onClick={() => handleDelivery()}
                      disabled={delivLoading || !delivStaff || cart.length === 0 || (delivAddrIdx === 2 && !delivAddrCustom.trim())}
                      className="flex-[2] bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-colors text-sm">
                      {delivLoading ? 'กำลังส่ง...' : `🛵 ส่งงานให้ ${delivStaff?.name || 'พนักงาน'}`}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══ QR CONTACT CARD MODAL ═══════════════════════════════════════════════ */}
      {showQrModal && qrContact && (
        <QrContactModal contact={qrContact} onClose={() => { setShowQrModal(false); setQrContact(null); }} />
      )}

      {/* ══ DEBT HISTORY MODAL ═══════════════════════════════════════════════════ */}
      {showDebtHistory && debtHistoryCont && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-end sm:items-center justify-center p-4">
          <div className="bg-gray-900 rounded-2xl w-full max-w-lg max-h-[80vh] overflow-y-auto">
            <div className="p-4 border-b border-gray-800 flex items-center justify-between sticky top-0 bg-gray-900 z-10">
              <div>
                <h3 className="text-white font-bold">📋 ประวัติหนี้</h3>
                <p className="text-gray-400 text-xs mt-0.5">{debtHistoryCont.name}</p>
              </div>
              <button onClick={() => setShowDebtHistory(false)} className="text-gray-500 hover:text-white text-xl w-8 h-8 flex items-center justify-center">✕</button>
            </div>
            <div className="p-4">
              <div className="flex gap-3 mb-4">
                <div className="flex-1 bg-red-900/30 border border-red-800/60 rounded-xl p-3 text-center">
                  <div className="text-red-400 font-bold text-xl">฿{(debtHistoryCont.debt || 0).toLocaleString()}</div>
                  <div className="text-gray-500 text-xs mt-0.5">ยอดค้างชำระ</div>
                </div>
                <div className="flex-1 bg-gray-800 rounded-xl p-3 text-center">
                  <div className="text-white font-bold text-xl">{debtHistoryOrders.filter(o => o.status !== 'ชำระแล้ว').length}</div>
                  <div className="text-gray-500 text-xs mt-0.5">บิลค้างชำระ</div>
                </div>
              </div>

              {debtHistoryLoading ? (
                <div className="text-center text-gray-500 py-8 animate-pulse">กำลังโหลด...</div>
              ) : debtHistoryOrders.length === 0 ? (
                <div className="text-center text-gray-500 py-8 text-sm">
                  <div className="text-3xl mb-2">📭</div>
                  <p>ไม่พบบิลค้างชำระ</p>
                  <p className="text-xs mt-1 text-gray-600">ยอดค้างอาจถูกปรับโดยตรง</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {debtHistoryOrders.map(o => (
                    <div key={o.order_no} className="bg-gray-800 rounded-xl p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-white text-sm font-medium">{o.order_no}</span>
                            <span className={`text-xs px-1.5 py-0.5 rounded-full ${o.source === 'delivery' ? 'bg-orange-900/60 text-orange-300' : 'bg-blue-900/60 text-blue-300'}`}>
                              {o.source === 'delivery' ? '🚚 จัดส่ง' : '🏪 หน้าร้าน'}
                            </span>
                            <span className={`text-xs px-2 py-0.5 rounded-full ${o.status === 'ชำระแล้ว' ? 'bg-green-900 text-green-400' : 'bg-red-900/60 text-red-300'}`}>{o.status}</span>
                          </div>
                          {(o.items||[]).length > 0 && (
                            <p className="text-gray-500 text-xs mt-1">{o.items.map(i => `${i.name}×${i.qty}`).join(', ')}</p>
                          )}
                          {o.notes && <p className="text-gray-600 text-xs mt-0.5">{o.notes}</p>}
                        </div>
                        <div className="text-red-400 font-bold text-sm shrink-0">฿{(o.total || 0).toLocaleString()}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={() => {
                  setShowDebtHistory(false);
                  setDebtCust(debtHistoryCont);
                  setDebtAmount('');
                  setShowDebtModal(true);
                }}
                className="w-full mt-4 bg-green-700 hover:bg-green-600 text-white font-bold py-3 rounded-xl transition-colors text-sm">
                💰 รับชำระหนี้จาก {debtHistoryCont.name}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ CONTACTS CSV/VCF IMPORT MODAL ═══════════════════════════════════════ */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-end sm:items-center justify-center p-4">
          <div className="bg-gray-900 rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
            <div className="p-4 border-b border-gray-800 flex items-center justify-between sticky top-0 bg-gray-900 z-10">
              <h3 className="text-white font-bold text-base">
                {isVcfMode ? '📱 นำเข้าผู้ติดต่อจากโทรศัพท์ (VCF)' : '📥 นำเข้าผู้ติดต่อจาก CSV'}
              </h3>
              <button onClick={closeImportModal} disabled={importLoading}
                className="text-gray-500 hover:text-white text-xl w-8 h-8 flex items-center justify-center disabled:opacity-30">✕</button>
            </div>

            <div className="p-5">
              {importProgress ? (
                <div className="text-center py-10">
                  <div className="text-5xl mb-4">⏳</div>
                  <p className="text-white font-bold text-lg mb-3">กำลังนำเข้า...</p>
                  <div className="bg-gray-800 rounded-full h-3 overflow-hidden mb-3 max-w-xs mx-auto">
                    <div className="bg-green-500 h-full transition-all duration-300 rounded-full"
                      style={{ width: `${Math.round((importProgress.done / importProgress.total) * 100)}%` }} />
                  </div>
                  <p className="text-gray-400 text-sm">{importProgress.done} / {importProgress.total} รายการ</p>
                  {importProgress.skipped > 0 && (
                    <p className="text-yellow-500 text-xs mt-1">ข้าม {importProgress.skipped} รายการที่ซ้ำ</p>
                  )}
                </div>

              ) : importRows.length === 0 ? (
                <div>
                  <div onClick={() => importFileRef.current?.click()}
                    className="border-2 border-dashed border-gray-600 hover:border-green-500 rounded-xl p-10 text-center cursor-pointer transition-colors group">
                    <div className="text-4xl mb-3 group-hover:scale-110 transition-transform">📱</div>
                    <p className="text-gray-200 font-medium mb-1">คลิกเพื่อเลือกไฟล์</p>
                    <p className="text-gray-500 text-xs">รองรับ <strong className="text-green-400">VCF</strong> (รายชื่อโทรศัพท์) และ <strong className="text-blue-400">CSV</strong> (Excel)</p>
                    <input ref={importFileRef} type="file" accept=".vcf,.csv,text/vcard,text/x-vcard,text/csv" className="hidden"
                      onChange={e => { if (e.target.files?.[0]) { handleImportFile(e.target.files[0]); e.target.value = ''; } }} />
                  </div>
                  <div className="mt-4 flex items-center justify-between">
                    <p className="text-gray-500 text-xs">ต้องการ CSV เปล่า?</p>
                    <button onClick={downloadTemplateCsv}
                      className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded-lg border border-gray-700 transition-colors">
                      ⬇ ดาวน์โหลด Template CSV
                    </button>
                  </div>
                  <div className="mt-4 bg-gray-800/50 rounded-xl p-4 text-xs text-gray-400 space-y-1.5">
                    <p className="font-medium text-gray-300 mb-2">💡 วิธี Export รายชื่อจากโทรศัพท์</p>
                    <p>• <strong className="text-green-400">ไฟล์ VCF (แนะนำ):</strong> แอปรายชื่อ → เลือกทั้งหมด → Share / ส่งออก → เลือก "ไฟล์ VCF" หรือ "vCard"</p>
                    <p>• <strong className="text-gray-200">Android / Samsung:</strong> แอป Contacts → ⋮ → จัดการผู้ติดต่อ → นำออก → บันทึกเป็น .vcf</p>
                    <p>• <strong className="text-gray-200">iPhone:</strong> Settings → Contacts → iCloud → Export vCard (หรือใช้แอป "Contacts+")</p>
                    <p>• <strong className="text-blue-400">ไฟล์ CSV:</strong> เปิด VCF ใน Excel → Save As → CSV หรือดาวน์โหลด Template ด้านบน</p>
                  </div>
                </div>

              ) : (
                <div className="space-y-5">
                  {/* column mapping — แสดงเฉพาะ CSV (VCF ไม่ต้องจับคู่) */}
                  {!isVcfMode && (
                    <div>
                      <h4 className="text-white font-medium text-sm mb-3">🔗 จับคู่คอลัมน์ CSV กับข้อมูลผู้ติดต่อ</h4>
                      <div className="space-y-2">
                        {[
                          { field: 'name',         label: 'ชื่อ *',      required: true  },
                          { field: 'phone',        label: 'เบอร์โทร',   required: false },
                          { field: 'email',        label: 'อีเมล',      required: false },
                          { field: 'company_name', label: 'ชื่อบริษัท', required: false },
                          { field: 'notes',        label: 'หมายเหตุ',   required: false },
                        ].map(({ field, label, required }) => (
                          <div key={field} className="flex items-center gap-3">
                            <span className={`text-xs w-28 shrink-0 ${required ? 'text-yellow-400' : 'text-gray-400'}`}>{label}</span>
                            <span className="text-gray-600 text-xs shrink-0">←</span>
                            <select value={importMapping[field] || ''}
                              onChange={e => setImportMapping(m => ({ ...m, [field]: e.target.value }))}
                              className="flex-1 bg-gray-800 text-white text-xs px-3 py-2 rounded-lg border border-gray-700 focus:outline-none focus:border-green-500">
                              <option value="">— ไม่นำเข้า —</option>
                              {importHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                            </select>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {isVcfMode && (
                    <div className="bg-green-900/30 border border-green-700/50 rounded-xl px-4 py-3 text-xs text-green-400 flex items-center gap-2">
                      <span>✅</span>
                      <span>อ่านไฟล์ VCF สำเร็จ พบ <strong>{importRows.length}</strong> รายชื่อ — พร้อมนำเข้าได้เลย</span>
                    </div>
                  )}

                  <div>
                    <h4 className="text-white font-medium text-sm mb-2">ประเภทผู้ติดต่อ (ทุกรายการ)</h4>
                    <div className="flex gap-2">
                      {['ลูกค้า', 'ผู้จำหน่าย', 'ทั้งคู่'].map(t => (
                        <button key={t} type="button" onClick={() => setImportDefaultType(t)}
                          className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${importDefaultType === t ? 'bg-green-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}>
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-white font-medium text-sm">ตัวอย่าง (5 แถวแรก)</h4>
                      <span className="text-gray-500 text-xs">พบ {importRows.length} รายการ</span>
                    </div>
                    <div className="bg-gray-800 rounded-xl overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-gray-700">
                              <th className="text-left text-gray-400 px-3 py-2 font-medium">ชื่อ</th>
                              <th className="text-left text-gray-400 px-3 py-2 font-medium">เบอร์โทร</th>
                              <th className="text-left text-gray-400 px-3 py-2 font-medium">อีเมล</th>
                              <th className="text-left text-gray-400 px-3 py-2 font-medium">บริษัท</th>
                            </tr>
                          </thead>
                          <tbody>
                            {importRows.slice(0, 5).map((row, i) => (
                              <tr key={i} className="border-b border-gray-700/50 last:border-0">
                                <td className="px-3 py-2 text-white font-medium">{importMapping.name ? (row[importMapping.name] || '—') : '—'}</td>
                                <td className="px-3 py-2 text-gray-300">{importMapping.phone ? (row[importMapping.phone] || '—') : '—'}</td>
                                <td className="px-3 py-2 text-gray-400">{importMapping.email ? (row[importMapping.email] || '—') : '—'}</td>
                                <td className="px-3 py-2 text-gray-400">{importMapping.company_name ? (row[importMapping.company_name] || '—') : '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <button onClick={() => { setImportRows([]); setImportHeaders([]); }}
                      className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium py-3 rounded-xl transition-colors text-sm">
                      ← เลือกไฟล์ใหม่
                    </button>
                    <button onClick={runImport}
                      disabled={importLoading || !importMapping.name}
                      className="flex-1 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-colors text-sm">
                      นำเข้า {importRows.filter(r => importMapping.name && r[importMapping.name]?.trim()).length} รายการ
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══ MAP PICKER MODAL ═════════════════════════════════════════════════ */}
      {/* ══ LOAN FORM MODAL ════════════════════════════════════════════════ */}
      {showLoanForm && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-end sm:items-center justify-center p-4">
          <div className="bg-gray-900 rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b border-gray-800">
              <div className="text-white font-bold">🏷️ บันทึกยืมสินค้า</div>
              <button onClick={() => setShowLoanForm(false)} className="text-gray-500 hover:text-white text-xl">✕</button>
            </div>
            <div className="p-4 space-y-4">
              {/* ผู้ยืม */}
              <div>
                <label className="block text-gray-400 text-xs mb-1.5">ชื่อผู้ยืม *</label>
                <input type="text" value={loanContactQ} placeholder="พิมพ์ค้นหาหรือชื่อใหม่..."
                  onChange={e => setLoanContactQ(e.target.value)}
                  className="w-full bg-gray-800 text-white text-sm px-3 py-2 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500 mb-1"
                />
                {loanContactQ.length > 0 && !loanForm.contact_name && (() => {
                  const q = loanContactQ.toLowerCase();
                  const qDigits = q.replace(/\D/g, '');
                  const matches = (contacts || []).filter(c => (c.name || '').toLowerCase().includes(q) || (qDigits.length > 0 && (c.phone || '').replace(/\D/g, '').includes(qDigits))).slice(0, 4);
                  return matches.length > 0 ? (
                    <div className="bg-gray-800 rounded-xl overflow-hidden border border-gray-700">
                      {matches.map((c, i) => (
                        <button key={i} className="w-full text-left px-3 py-2 text-sm text-gray-200 hover:bg-gray-700 border-b border-gray-700/50 last:border-0"
                          onClick={() => { setLoanForm(f => ({ ...f, contact_id: c.id || '', contact_name: c.name, contact_phone: c.phone || '' })); setLoanContactQ(c.name); }}>
                          {c.name} {c.phone && <span className="text-gray-500 text-xs">{c.phone}</span>}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <button className="text-xs text-green-400 hover:text-green-300"
                      onClick={() => { setLoanForm(f => ({ ...f, contact_name: loanContactQ, contact_phone: '' })); }}>
                      + ใช้ "{loanContactQ}" เป็นชื่อใหม่
                    </button>
                  );
                })()}
                {loanForm.contact_name && (
                  <div className="flex items-center gap-2 bg-green-900/30 rounded-xl px-3 py-2">
                    <span className="text-green-300 text-sm font-medium">{loanForm.contact_name}</span>
                    <button onClick={() => { setLoanForm(f => ({ ...f, contact_name: '', contact_id: '' })); setLoanContactQ(''); }}
                      className="text-gray-500 hover:text-white ml-auto">✕</button>
                  </div>
                )}
              </div>
              {/* สินค้า */}
              <div>
                <label className="block text-gray-400 text-xs mb-1.5">รายการสินค้า *</label>
                <div className="flex gap-2 mb-2">
                  <input type="text" value={loanItemQ} placeholder="ค้นหาสินค้า..."
                    onChange={e => setLoanItemQ(e.target.value)}
                    className="flex-1 bg-gray-800 text-white text-sm px-3 py-2 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500"
                  />
                </div>
                {loanItemQ.length > 0 && (() => {
                  const q = loanItemQ.toLowerCase();
                  // ไม่รวมสินค้าประเภทหมุนเวียน — มีระบบแลกเปลี่ยน/เก็บคืนของตัวเองแยกต่างหากแล้ว (ยืมผ่านหน้านี้จะไม่ตัดสต็อคเลย)
                  const matches = (products || []).filter(p => p.type !== 'หมุนเวียน' && (p.name || '').toLowerCase().includes(q)).slice(0, 5);
                  return matches.length > 0 ? (
                    <div className="bg-gray-800 rounded-xl overflow-hidden border border-gray-700 mb-2">
                      {matches.map((p, i) => (
                        <button key={i} className="w-full text-left px-3 py-2 text-sm text-gray-200 hover:bg-gray-700 border-b border-gray-700/50 last:border-0"
                          onClick={() => {
                            setLoanForm(f => ({ ...f, items: [...f.items, { sku: p.sku, name: p.name, qty: 1, unit: p.unit }] }));
                            setLoanItemQ('');
                          }}>
                          {p.name} <span className="text-gray-500 text-xs">สต็อก {p.stock} {p.unit}</span>
                        </button>
                      ))}
                    </div>
                  ) : null;
                })()}
                {loanForm.items.length > 0 && (
                  <div className="space-y-2">
                    {loanForm.items.map((item, i) => (
                      <div key={i} className="flex items-center gap-2 bg-gray-800 rounded-xl px-3 py-2">
                        <span className="text-gray-300 text-sm flex-1">{item.name}</span>
                        <input type="number" min="1" value={item.qty}
                          onChange={e => setLoanForm(f => ({ ...f, items: f.items.map((it, j) => j === i ? { ...it, qty: parseInt(e.target.value) || 1 } : it) }))}
                          className="w-16 bg-gray-700 text-white text-sm text-center px-2 py-1 rounded-lg border border-gray-600"
                        />
                        <span className="text-gray-500 text-xs">{item.unit}</span>
                        <button onClick={() => setLoanForm(f => ({ ...f, items: f.items.filter((_, j) => j !== i) }))}
                          className="text-gray-600 hover:text-red-400 text-sm">✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {/* วันกำหนดคืน */}
              <div>
                <label className="block text-gray-400 text-xs mb-1.5">กำหนดคืน</label>
                <input type="date" value={loanForm.due_date}
                  onChange={e => setLoanForm(f => ({ ...f, due_date: e.target.value }))}
                  className="w-full bg-gray-800 text-white text-sm px-3 py-2 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500"
                />
              </div>
              {/* หมายเหตุ */}
              <div>
                <label className="block text-gray-400 text-xs mb-1.5">หมายเหตุ</label>
                <input type="text" value={loanForm.notes} placeholder="เช่น ใช้จัดงาน..."
                  onChange={e => setLoanForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full bg-gray-800 text-white text-sm px-3 py-2 rounded-xl border border-gray-700 focus:outline-none focus:border-green-500"
                />
              </div>
              {/* ตัดสต็อค */}
              <label className="flex items-center gap-3 cursor-pointer">
                <div className={`w-10 h-5 rounded-full transition-colors ${loanForm.deduct_stock ? 'bg-green-600' : 'bg-gray-700'}`}
                  onClick={() => setLoanForm(f => ({ ...f, deduct_stock: !f.deduct_stock }))}>
                  <div className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${loanForm.deduct_stock ? 'translate-x-5' : 'translate-x-0'}`}/>
                </div>
                <span className="text-gray-300 text-sm">ตัดสต็อคสินค้าที่ยืมออก</span>
              </label>
            </div>
            <div className="p-4 border-t border-gray-800 flex gap-3">
              <button onClick={() => setShowLoanForm(false)}
                className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium py-3 rounded-xl transition-colors">
                ยกเลิก
              </button>
              <button onClick={saveLoan}
                disabled={loanSaving || !loanForm.contact_name || !loanForm.items.length}
                className="flex-1 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-sm font-bold py-3 rounded-xl transition-colors">
                {loanSaving ? 'กำลังบันทึก...' : '✅ บันทึก'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ EXPORT MODAL ═══════════════════════════════════════════════════ */}
      {showExportModal && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-gray-900 rounded-2xl w-full max-w-sm">
            <div className="flex items-center justify-between p-4 border-b border-gray-800">
              <div className="text-white font-bold">📤 Export Excel</div>
              <button onClick={() => setShowExportModal(false)} className="text-gray-500 hover:text-white text-xl">✕</button>
            </div>
            <div className="p-4 space-y-3">
              <div className="text-gray-400 text-xs mb-2">เลือกรายงานที่ต้องการ export:</div>
              {[
                { key: 'sales',      label: '💰 ยอดขาย (Bank Statement)' },
                { key: 'inventory',  label: '📦 สินค้าคงเหลือ' },
                { key: 'credit',     label: '💳 เงินเชื่อ' },
                { key: 'loans',      label: '🏷️ ยืมสินค้า' },
                { key: 'topsellers', label: '🏆 สินค้าขายดี' },
                { key: 'pl',         label: '📈 กำไร-ขาดทุน' },
                { key: 'expenses',   label: '🧾 รายจ่าย' },
                { key: 'vat',        label: '📋 ภาษี VAT' },
              ].map(r => (
                <label key={r.key} className="flex items-center gap-3 cursor-pointer py-1">
                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${exportTypes.includes(r.key) ? 'bg-green-600 border-green-600' : 'border-gray-600'}`}
                    onClick={() => setExportTypes(prev => prev.includes(r.key) ? prev.filter(t => t !== r.key) : [...prev, r.key])}>
                    {exportTypes.includes(r.key) && <span className="text-white text-xs font-bold">✓</span>}
                  </div>
                  <span className="text-gray-300 text-sm">{r.label}</span>
                </label>
              ))}
              {hasFeature(shopInfo?.subscription_tier, 'excel_report_templates') && (
                <>
                  <div className="border-t border-gray-800 pt-2 mt-2 text-gray-400 text-xs mb-1">📑 แม่แบบสำเร็จรูป (Business+)</div>
                  {[
                    { key: 'vat30',              label: '🧾 ภาษีซื้อ-ขาย มาตรฐาน (ภ.พ.30)' },
                    { key: 'sales_by_branch',    label: '🏢 สรุปยอดขายแยกสาขา/วิธีชำระ' },
                    { key: 'cyclical_inventory', label: '🔄 คลังสินค้าหมุนเวียน + มูลค่าสินทรัพย์' },
                  ].map(r => (
                    <label key={r.key} className="flex items-center gap-3 cursor-pointer py-1">
                      <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${exportTypes.includes(r.key) ? 'bg-green-600 border-green-600' : 'border-gray-600'}`}
                        onClick={() => setExportTypes(prev => prev.includes(r.key) ? prev.filter(t => t !== r.key) : [...prev, r.key])}>
                        {exportTypes.includes(r.key) && <span className="text-white text-xs font-bold">✓</span>}
                      </div>
                      <span className="text-gray-300 text-sm">{r.label}</span>
                    </label>
                  ))}
                </>
              )}
              <div className="border-t border-gray-800 pt-3 space-y-2">
                <div className="text-gray-400 text-xs">ช่วงเวลา: {reportDateFrom || 'ทั้งหมด'}{reportDateTo && reportDateFrom !== reportDateTo ? ` – ${reportDateTo}` : ''}</div>
              </div>
            </div>
            <div className="p-4 border-t border-gray-800 flex gap-3">
              <button onClick={() => setShowExportModal(false)}
                className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium py-3 rounded-xl transition-colors">
                ยกเลิก
              </button>
              <button onClick={runExport}
                disabled={exportLoading || !exportTypes.length}
                className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-bold py-3 rounded-xl transition-colors">
                {exportLoading ? 'กำลังสร้างไฟล์...' : '⬇️ ดาวน์โหลด'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showMapPicker && (() => {
        const existing = contactForm[`maps_${mapPickerSlot}`];
        let initCoords = null;
        if (existing) {
          const m = existing.match(/q=([+-]?\d+\.?\d*),([+-]?\d+\.?\d*)/);
          if (m) initCoords = { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
        }
        return (
          <MapPickerModal
            initCoords={initCoords}
            onConfirm={(lat, lng) => {
              const url = `https://www.google.com/maps?q=${lat},${lng}`;
              setContactForm(f => ({ ...f, [`maps_${mapPickerSlot}`]: url }));
              setShowMapPicker(false);
            }}
            onClose={() => setShowMapPicker(false)}
          />
        );
      })()}

      {showDelivMapPicker && (() => {
        let initCoords = null;
        if (delivMapsCustom) {
          const m = delivMapsCustom.match(/q=([+-]?\d+\.?\d*),([+-]?\d+\.?\d*)/);
          if (m) initCoords = { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
        }
        return (
          <MapPickerModal
            initCoords={initCoords}
            onConfirm={(lat, lng) => {
              setDelivMapsCustom(`https://www.google.com/maps?q=${lat},${lng}`);
              setShowDelivMapPicker(false);
            }}
            onClose={() => setShowDelivMapPicker(false)}
          />
        );
      })()}
    </>
  );
}
