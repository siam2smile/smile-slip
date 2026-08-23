/**
 * ตัวช่วย Google Sheets สำหรับ POS System
 * ใช้ refresh_token จาก shop_google_configs (เหมือน google-delivery.js)
 */
import { dualWrite, insertRow, updateRow, softDeleteRow, supabase } from './supabase-pos';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE_BASE = 'https://www.googleapis.com/drive/v3/files';

// Google Sheets API ตอบ 429/5xx เป็นครั้งคราว (เช่น "The service is currently
// unavailable") ซึ่งมักหายเองภายในไม่กี่วินาที — retry ก่อนปล่อย error ขึ้นไปให้ผู้ใช้เห็น
const RETRYABLE_STATUS = [429, 500, 502, 503, 504];
async function sheetsFetch(url, options, retries = 3) {
  let res;
  for (let attempt = 0; attempt < retries; attempt++) {
    res = await fetch(url, options);
    if (res.ok || !RETRYABLE_STATUS.includes(res.status)) return res;
    if (attempt < retries - 1) await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
  }
  return res;
}

export async function getAccessToken(refreshToken) {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
  });
  const d = await res.json();
  if (!d.access_token) throw new Error('Google token refresh ล้มเหลว: ' + JSON.stringify(d));
  return d.access_token;
}

// แปลงเลขคอลัมน์ (1-indexed) เป็นตัวอักษร เช่น 1→A, 18→R, 27→AA
function colLetter(n) {
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// เพิ่มหลายแถวในคำขอเดียว — สำคัญมากสำหรับ import จำนวนมาก (เช่น นำเข้า VCF หลักพันรายชื่อ)
// เพราะยิง append ทีละแถวจะช้ามากและโดน rate limit ของ Google (ทั้ง OAuth token refresh
// และ Sheets API เอง) จนพังกลางทางได้ถ้าเรียกซ้ำๆ ในเวลาสั้นๆ
//
// สำคัญ: range ต้องระบุขอบเขตคอลัมน์ให้ตรงกับความกว้างจริงของแถวที่จะเขียน (ไม่ใช่ A:Z
// แบบเปิดกว้าง) เพราะเจอบั๊กจริงใน production ที่ Google Sheets append แถวใหม่ผิดตำแหน่ง
// ไปเรื่อยๆ ทางขวา (คอลัมน์ P → Y → ...) ทุกครั้งที่เรียก append ซ้ำบนชีตที่มี header
// สั้นกว่าข้อมูลจริง — ยิ่งเรียกยิ่งเพี้ยนสะสม ระบุ range แคบพอดีป้องกันปัญหานี้แน่นอน
export async function appendRows(accessToken, sheetId, sheetName, rows) {
  if (!rows.length) return { ok: true };
  const width = Math.max(...rows.map(r => r.length));
  const range = encodeURIComponent(`${sheetName}!A:${colLetter(width)}`);
  const res = await sheetsFetch(
    `${SHEETS_BASE}/${sheetId}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: rows }),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Sheets append error: ${err.error?.message || res.status}`);
  }
  return await res.json();
}

export async function appendSheet(accessToken, sheetId, sheetName, row) {
  return appendRows(accessToken, sheetId, sheetName, [row]);
}

// สร้าง subfolder ใน parent folder ที่กำหนด
export async function createFolder(accessToken, name, parentId) {
  const body = { name, mimeType: 'application/vnd.google-apps.folder' };
  if (parentId) body.parents = [parentId];
  const res = await fetch(DRIVE_BASE, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const d = await res.json();
  if (!d.id) throw new Error('สร้าง folder ไม่ได้: ' + JSON.stringify(d));
  return d.id;
}

// ── Header Definitions ────────────────────────────────────────────────────────

// คำนวณ VAT รวมของรายการสินค้าจาก vat_type ต่อ SKU — ใช้ร่วมกันทั้งขายหน้าร้าน/ใบกำกับภาษี/รายงาน VAT
// products: array ที่ผ่าน rowToProduct() มาแล้ว
const VAT_RATE = 0.07;
export function computeVatBreakdown(items, products) {
  let subtotal = 0, vat = 0;
  for (const item of items || []) {
    const qty = parseFloat(item.qty) || 0;
    const price = parseFloat(item.price) || 0;
    const lineTotal = qty * price;
    const prod = item.sku ? products.find(p => p.sku === item.sku) : null;
    const vatType = prod?.vat_type || 'ไม่มี VAT';
    if (vatType === 'รวม VAT แล้ว') {
      const base = lineTotal / (1 + VAT_RATE);
      subtotal += base;
      vat += lineTotal - base;
    } else if (vatType === 'ไม่รวม VAT') {
      subtotal += lineTotal;
      vat += lineTotal * VAT_RATE;
    } else {
      subtotal += lineTotal; // ไม่มี VAT
    }
  }
  subtotal = Math.round(subtotal * 100) / 100;
  vat = Math.round(vat * 100) / 100;
  return { subtotal, vat, total: Math.round((subtotal + vat) * 100) / 100 };
}

// Phase 2 (write-primary flip, 2026-07-29): adapter สำหรับ pos_tax_invoices row → shape เดียวกับ
// rowToTaxInvoice เต็มรูปแบบ (ต่างจาก taxInvoiceFromRow แบบย่อใน export.js ที่ตัดฟิลด์ที่ไม่ใช้ในรายงาน VAT30 ออก)
export function taxInvoiceRecordFromRow(r) {
  return {
    invoice_no: r.invoice_no || '', issued_at: r.issued_at || '', ref_bill_no: r.ref_bill_no || '',
    customer_id: r.customer_id || '', buyer_name: r.buyer_name || '', buyer_tax_id: r.buyer_tax_id || '',
    buyer_address: r.buyer_address || '', buyer_branch: r.buyer_branch || '', items: r.items || [],
    subtotal: Number(r.subtotal) || 0, vat: Number(r.vat) || 0, total: Number(r.total) || 0,
    issued_by: r.issued_by || '', buyer_phone: r.buyer_phone || '',
    seller_name: r.seller_name || '', seller_address: r.seller_address || '',
  };
}

export function makeExpenseNo() {
  const now = new Date();
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  return `EXP${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

// Phase 2 (write-primary flip, 2026-07-29): adapter สำหรับ pos_expenses row → shape เดียวกับ rowToExpense
export function expenseFromRow(r) {
  return {
    expense_no: r.expense_no || '', created_at: r.transaction_at || '', label: r.label || '',
    total: Number(r.total) || 0, vat_type: r.vat_type || 'ไม่มี VAT', subtotal: Number(r.subtotal) || 0,
    vat_amount: Number(r.vat_amount) || 0, payment_method: r.payment_method || '',
    photo_url: r.photo_url || '', notes: r.notes || '', recorded_by: r.recorded_by || '',
    branch: r.branch_name || '', shift_no: r.shift_no || '', payee: r.payee || '',
  };
}

export function makeShiftNo() {
  const now = new Date();
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  return `SHIFT${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

// Phase 2 (write-primary flip, 2026-07-29): adapter สำหรับ pos_cash_shifts row → shape เดียวกับ
// rowToCashShift — opened_at/closed_at เก็บเป็น timestamptz จริงใน Supabase (ต่างจาก Sheets ที่เก็บ
// เป็นสตริงไทยดิบ) ต้องแปลงกลับเป็นสตริงไทยก่อนคืนค่า เพราะหน้าเว็บ (pos.js) เอาไปแสดงผลตรงๆ
export function cashShiftFromRow(r) {
  const fmtThai = (iso) => iso ? new Date(iso).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) : '';
  return {
    shift_no: r.shift_no || '', staff_id: r.staff_id || '', staff_name: r.staff_name || '',
    branch: r.branch_name || '', opened_at: fmtThai(r.opened_at), opening_cash: Number(r.opening_cash) || 0,
    closed_at: fmtThai(r.closed_at),
    expected_cash: r.expected_cash != null ? Number(r.expected_cash) : null,
    counted_cash: r.counted_cash != null ? Number(r.counted_cash) : null,
    variance: r.variance != null ? Number(r.variance) : null,
    notes: r.notes || '', withdrawn_amount: Number(r.withdrawn_amount) || 0,
    carried_forward: r.carried_forward != null ? Number(r.carried_forward) : null,
    status: r.status || 'เปิดอยู่',
  };
}

function makeCyclicalLogNo() {
  const now = new Date();
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  return `CYC${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}${pad(Math.floor(Math.random() * 100))}`;
}

// source: 'ขายหน้าร้าน'|'จัดส่ง'|'เก็บเงิน/ของ' — action: 'แลกเปลี่ยน'|'ยืม'|'คืน'
// เรียกใช้แบบ fail-safe (ไม่ throw) กันบันทึก log พังจนกระทบ transaction หลัก
// Phase 2 (write-primary flip, 2026-07-29): เขียน Supabase (pos_cyclical_log) เท่านั้นแล้ว
// ไม่ผ่าน Sheets อีกต่อไป — signature เปลี่ยนจาก (token, sheetId, {...}) เหลือแค่ ({...}) เดียว
export async function logCyclicalTransaction({ shopId, sku, name, source, action, qty, customerId, customerName, branch, performedBy }) {
  if (!qty || qty <= 0 || !shopId) return;
  try {
    const logNo = makeCyclicalLogNo();
    const nowIso = new Date().toISOString();
    const { error } = await supabase.from('pos_cyclical_log').insert({
      shop_id: shopId, log_no: logNo, transaction_at: nowIso, sku: sku || '', product_name: name || '',
      source: source || '', action: action || '', qty, customer_id: customerId || '',
      customer_name: customerName || '', branch_name: branch || '', performed_by: performedBy || '',
    });
    if (error) throw error;
  } catch (err) {
    console.error('[logCyclicalTransaction]', err.message);
  }
}

// ── Backdating helper ─────────────────────────────────────────────────────────
// คำนวณวันที่-เวลาของ "รายการ" (ไม่ใช่วันที่ระบบบันทึกจริง) — รองรับกรอกย้อนหลัง
// (เอกสารมาช้า/คีย์ข้อมูลย้อนหลัง) ผ่าน transactionDate (ISO "YYYY-MM-DD", optional)
// เวลาที่แสดงยังคงเป็นเวลาปัจจุบันเสมอ (ไม่มีช่องกรอกเวลาแยก) มีแค่ "วันที่" ที่แก้ได้
//
// คืนค่า 2 รูปแบบเพราะโค้ดเดิมของโปรเจกต์ใช้ format ไม่ตรงกันระหว่าง 2 จุด (ต้องคงไว้ตามเดิม
// เป๊ะ ไม่งั้น date-filter แบบ startsWith ที่มีอยู่แล้วจะพังกับวันที่/เดือนหลักเดียว):
//   - `full` (ไม่ pad เลข) — ใช้เขียนคอลัมน์ "วันที่-เวลา" ของ POS Sheet เอง (sales/receives/expenses
//     tab) ตรงกับที่ `now.toLocaleString('th-TH')` เคยให้มาแต่เดิม เช่น "5/7/2569 13:06:03"
//   - `thaiDate`/`thaiTime` (pad 2 หลัก) — ใช้เขียนคอลัมน์ "วันที่สลิป"/"เวลา" ของ Sheets บัญชีหลัก
//     (writeXToMainSheets) ตรงกับที่ `toLocaleDateString(...,{day:'2-digit',month:'2-digit'})` เคยให้มา
//   - `isoYear` — ปีของ "รายการ" (ไม่ใช่ปีปัจจุบัน) ใช้เลือกว่าจะเขียนลง tab ปีไหนใน Sheets บัญชีหลัก
export function resolveRecordDateTime(transactionDate) {
  const now = new Date();
  const thaiLocale = { timeZone: 'Asia/Bangkok' };
  const thaiTime = now.toLocaleTimeString('th-TH', thaiLocale);
  const pad = (n) => String(n).padStart(2, '0');

  if (transactionDate) {
    const [y, m, d] = transactionDate.split('-').map(Number);
    if (y && m && d) {
      const buddhistYear = y + 543;
      return {
        full: `${d}/${m}/${buddhistYear} ${thaiTime}`,        // ไม่ pad — ตรงกับ toLocaleString เดิม
        thaiDate: `${pad(d)}/${pad(m)}/${buddhistYear}`,      // pad — ตรงกับ toLocaleDateString เดิม
        thaiTime,
        isoYear: y.toString(),
      };
    }
  }

  const thaiDate = now.toLocaleDateString('th-TH', { ...thaiLocale, day: '2-digit', month: '2-digit', year: 'numeric' });
  return {
    full: now.toLocaleString('th-TH', thaiLocale),
    thaiDate,
    thaiTime,
    isoYear: now.getFullYear().toString(),
  };
}

// ── Key Generators ────────────────────────────────────────────────────────────

export function makeSKU() {
  // เพิ่มส่วนสุ่มต่อท้าย (เจอบั๊กจริงตอนสร้างฟีเจอร์นำเข้าสินค้าเป็นชุด — เดิม Date.now() อย่าง
  // เดียวชนกันได้ถ้าสร้างหลาย SKU ใน loop เดียวกัน (synchronous) แบบเดียวกับที่เคยแก้ makeContactId())
  const rand = Math.random().toString(36).slice(2, 5).toUpperCase();
  return 'P' + Date.now().toString(36).toUpperCase().slice(-6) + rand;
}

export function makeBillNo() {
  const now = new Date();
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  return `BILL${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

export function makeContactId() {
  // เพิ่มส่วนสุ่มต่อท้าย — ตอน bulk import สร้างหลายพัน ID ใน loop เดียวกัน (synchronous)
  // Date.now() อย่างเดียวอาจได้ millisecond เดียวกันหลายแถว ทำให้ contact_id ชนกันได้
  const rand = Math.random().toString(36).slice(2, 5).toUpperCase();
  return 'C' + Date.now().toString(36).toUpperCase().slice(-6) + rand;
}


export function makeStaffId() {
  return 'STF' + Date.now().toString(36).toUpperCase().slice(-6);
}

export function makeOrderNo() {
  const now = new Date();
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  return `DEL${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

export function makeLoanNo() {
  const now = new Date();
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  return `LN${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

export function makeReceiveNo() {
  const now = new Date();
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  return `RI${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

// ── Row Converters ────────────────────────────────────────────────────────────

// Supabase row (pos_products) → shape เดียวกับ rowToProduct() เดิมทุกฟิลด์ — Phase 2
// (write-primary flip, 2026-07-29): products.js อ่าน/เขียน Supabase ตรงแล้ว ไม่ผ่าน Sheets
export function productFromRow(r) {
  const rawType = r.type || 'นับสต็อค';
  return {
    sku: r.sku || '', name: r.name || '', category: r.category || '',
    price: Number(r.price) || 0, cost: Number(r.cost) || 0, stock: Number(r.stock) || 0,
    unit: r.unit || 'ชิ้น', aliases: r.aliases || '', notes: r.notes || '',
    updated_at: r.product_updated_at || '',
    type: rawType === 'ทั่วไป' ? 'นับสต็อค' : rawType, // backward compat
    at_customer: Number(r.at_customer) || 0, empty_waiting: Number(r.empty_waiting) || 0,
    product_code: r.product_code || '', barcode: r.barcode || '', description: r.description || '',
    vat_type: r.vat_type || 'ไม่มี VAT', is_active: r.is_active !== false,
    empty_ceiling: Number(r.empty_ceiling) || 0,
    branches: (r.branches || '').split(',').map(s => s.trim()).filter(Boolean),
    // เมนูสั่งซื้อออนไลน์ (ข้อ 94) — ค่าเริ่มต้น true เสมอ (ทั้งก่อน/หลังรัน SQL) ให้ตรงกับ
    // พฤติกรรมเดิมที่ order.js เคยดึงสินค้าทุกตัวมาแสดงไม่มีข้อยกเว้น — ต้องติ๊กออกเองถึงจะซ่อน
    online_order_visible: r.online_order_visible !== false,
  };
}

// Supabase row (pos_sales) → shape เดียวกับ rowToSale() เดิมทุกฟิลด์ — Phase 2
// (write-primary flip, 2026-07-29): sales.js อ่าน/เขียน Supabase ตรงแล้ว ไม่ผ่าน Sheets
export function saleFromRow(r) {
  return {
    bill_no: r.bill_no || '', created_at: r.transaction_at || '', items: r.items || [],
    subtotal: Number(r.subtotal) || 0, discount: Number(r.discount) || 0, total: Number(r.total) || 0,
    payment_method: r.payment_method || '', cash_received: Number(r.cash_received) || 0,
    change: Number(r.change_amount) || 0, cashier: r.cashier || '', notes: r.notes || '',
    status: r.status || 'ชำระแล้ว', customer_id: r.customer_id || '', customer_name: r.customer_name || '',
    paid_at: r.paid_at || '', branch: r.branch_name || '', vat_subtotal: Number(r.vat_subtotal) || 0,
    vat_amount: Number(r.vat_amount) || 0, shift_no: r.shift_no || '',
  };
}

// Phase 2 (write-primary flip, 2026-07-29): adapter สำหรับ pos_loans row → shape เดียวกับ rowToLoan
export function loanFromRow(r) {
  return {
    loan_no: r.loan_no || '', created_at: r.created_at || '', due_date: r.due_date || '',
    contact_id: r.contact_id || '', contact_name: r.contact_name || '', contact_phone: r.contact_phone || '',
    items: r.items || [], notes: r.notes || '', status: r.status || 'ยืมอยู่',
    returned_at: r.returned_at || '', branch: r.branch_name || '',
    stock_deducted: r.stock_deducted !== false,
  };
}

// Supabase row (pos_contacts) → shape เดียวกับ rowToContact() เดิมทุกฟิลด์ — Phase 2
// (write-primary flip, 2026-07-29): contacts.js อ่าน/เขียน Supabase ตรงแล้ว ไม่ผ่าน Sheets
export function contactFromRow(r) {
  return {
    contact_id: r.contact_id || '', name: r.name || '', contact_type: r.contact_type || 'ผู้จำหน่าย',
    phone: r.phone || '', email: r.email || '', address_1: r.address_1 || '', maps_1: r.maps_1 || '',
    address_2: r.address_2 || '', maps_2: r.maps_2 || '', company_name: r.company_name || '',
    tax_id: r.tax_id || '', tax_address: r.tax_address || '', tax_branch: r.tax_branch || '',
    debt: Number(r.debt) || 0, cylinders: Number(r.cylinders) || 0, shop_name: r.shop_name || '',
    aliases: r.aliases || '', notes: r.notes || '',
    created_at: r.contact_created_at || '', updated_at: r.contact_updated_at || '',
    person_type: r.person_type || 'บุคคลธรรมดา', contact_person_name: r.contact_person_name || '',
    contact_person_phone: r.contact_person_phone || '', cylinder_limit: Number(r.cylinder_limit) || 0,
  };
}

const EMPTY_STAFF_PERMS = {
  perm_view_revenue: false, perm_view_pl: false, perm_manage_stock: false, perm_export_vat: false,
  perm_process_sales: false, perm_void_sales: false, perm_manage_customers: false, perm_manage_expenses: false,
  perm_manage_delivery: false, perm_manage_receiving: false, perm_issue_tax_invoice: false, perm_manage_staff: false,
};

// สิทธิ์ที่ถือว่า "เกี่ยวกับหน้าขายเต็มรูปแบบ" (/pos?mode=cashier) — ตั้งใจไม่รวม perm_manage_delivery
// เพราะพนักงานส่งของล้วนๆ (preset "พนักงานส่งของ" มีแค่สิทธิ์นี้อย่างเดียว) ไม่ควรเข้าหน้าขายเต็มรูปแบบ
// ได้เลย ต้องใช้ /pos-staff (แอปพนักงาน) แทนเสมอ — ผู้จัดการสาขาที่มีสิทธิ์อื่นควบคู่ไปด้วย (เช่น
// perm_view_revenue) จะยังผ่านเงื่อนไขนี้ได้ปกติแม้จะมี perm_manage_delivery ติดมาด้วยก็ตาม
const CASHIER_SURFACE_PERMS = [
  'perm_process_sales', 'perm_void_sales', 'perm_manage_customers', 'perm_manage_stock',
  'perm_manage_expenses', 'perm_manage_receiving', 'perm_view_revenue', 'perm_view_pl',
  'perm_export_vat', 'perm_issue_tax_invoice', 'perm_manage_staff',
];
export function staffQualifiesForCashier(staff) {
  return CASHIER_SURFACE_PERMS.some(k => staff[k]);
}

// Supabase row → shape เดียวกับ rowToStaff() เดิมทุกฟิลด์ (ให้ logic ปลายทางที่มีอยู่แล้ว
// เช่น staffQualifiesForCashier() ไม่ต้องแก้เลย)
export function staffFromRow(r) {
  return {
    staff_id: r.staff_id || '', name: r.name || '', phone: r.phone || '',
    line_id: r.line_id || '', role: r.role || 'พนักงานส่ง', notes: r.notes || '',
    created_at: r.staff_created_at || '', branch_name: r.branch_name || '',
    has_pin: !!(r.pin && String(r.pin).trim()),
    perm_view_revenue: !!r.perm_view_revenue, perm_view_pl: !!r.perm_view_pl,
    perm_manage_stock: !!r.perm_manage_stock, perm_export_vat: !!r.perm_export_vat,
    perm_process_sales: !!r.perm_process_sales, perm_void_sales: !!r.perm_void_sales,
    perm_manage_customers: !!r.perm_manage_customers, perm_manage_expenses: !!r.perm_manage_expenses,
    perm_manage_delivery: !!r.perm_manage_delivery, perm_manage_receiving: !!r.perm_manage_receiving,
    perm_issue_tax_invoice: !!r.perm_issue_tax_invoice, perm_manage_staff: !!r.perm_manage_staff,
  };
}

// ตรวจสิทธิ์เชิงลึกของพนักงานคนหนึ่ง (จาก pos-staff.js "📊 จัดการร้าน" และ session แคชเชียร์ที่
// เซ็นชื่อของ /pos?mode=cashier) — ใช้บังคับฝั่ง API จริง ไม่ใช่แค่ซ่อน UI เฉยๆ (กันพนักงานเรียก
// API ตรงข้ามหน้าบ้าน) — คืน false ทั้งหมดถ้าไม่พบพนักงานหรือ error ใดๆ (fail-safe: ไม่มีสิทธิ์
// ดีกว่ามีสิทธิ์ผิดคน) — ดึงจาก Supabase สดทุกครั้ง ไม่เชื่อค่าที่ฝังใน session token เลย เพราะแอดมิน
// อาจถอนสิทธิ์แล้วต้องมีผลทันที ไม่ใช่รอ token หมดอายุ — Phase 2 (write-primary flip): เลิกอ่าน
// Sheets แล้ว ใช้ (shopId, staffId) แทน (token, sheetId, staffId) เดิม
export async function getStaffPermissions(shopId, staffId) {
  if (!staffId) return { ...EMPTY_STAFF_PERMS };
  try {
    const { data: row, error } = await supabase.from('pos_staff').select('*')
      .eq('shop_id', shopId).eq('staff_id', staffId).is('deleted_at', null).maybeSingle();
    if (error) throw error;
    if (!row) return { ...EMPTY_STAFF_PERMS };
    const staff = staffFromRow(row);
    return {
      perm_view_revenue: staff.perm_view_revenue,
      perm_view_pl: staff.perm_view_pl,
      perm_manage_stock: staff.perm_manage_stock,
      perm_export_vat: staff.perm_export_vat,
      perm_process_sales: staff.perm_process_sales,
      perm_void_sales: staff.perm_void_sales,
      perm_manage_customers: staff.perm_manage_customers,
      perm_manage_expenses: staff.perm_manage_expenses,
      perm_manage_delivery: staff.perm_manage_delivery,
      perm_manage_receiving: staff.perm_manage_receiving,
      perm_issue_tax_invoice: staff.perm_issue_tax_invoice,
      perm_manage_staff: staff.perm_manage_staff,
    };
  } catch (err) {
    console.error('[getStaffPermissions]', err.message);
    return { ...EMPTY_STAFF_PERMS };
  }
}

// Phase 2 (write-primary flip, 2026-07-29): adapter สำหรับ pos_delivery_orders row → shape
// เดียวกับ rowToOrder เต็มรูปแบบ (ต่างจาก orderFromRow แบบย่อใน reports.js ที่ตัดฟิลด์ที่ไม่ใช้ในรายงานออก)
export function deliveryOrderFromRow(r) {
  return {
    order_no: r.order_no || '', created_at: r.transaction_at || '', customer_id: r.customer_id || '',
    customer_name: r.customer_name || '', phone: r.phone || '', address: r.address || '',
    maps_link: r.maps_link || '', items: r.items || [], total: Number(r.total) || 0,
    payment_method: r.payment_method || '', staff_id: r.staff_id || '', staff_name: r.staff_name || '',
    status: r.status || 'รอจัดส่ง', notes: r.notes || '', slip_url: r.slip_url || '',
    confirmed_at: r.confirmed_at || '', confirmed_by: r.confirmed_by || '',
    cash_received: !!r.cash_received, goods_received: !!r.goods_received,
    created_by: r.created_by || '', credit_settled: !!r.credit_settled,
  };
}

// Phase 2 (write-primary flip, 2026-07-29): adapter สำหรับ pos_collections row → shape เดียวกับ rowToCollection (ลบไปแล้ว, Sheets-array-based, dead since write-primary flip)
export function collectionFromRow(r) {
  return {
    collection_no: r.collection_no || '', created_at: r.transaction_at || '',
    customer_id: r.customer_id || '', customer_name: r.customer_name || '', phone: r.phone || '',
    task_type: r.task_type || 'เงินเชื่อ', debt_amount: Number(r.debt_amount) || 0,
    items: r.items || [], staff_id: r.staff_id || '', staff_name: r.staff_name || '',
    status: r.status || 'รอดำเนินการ', notes: r.notes || '',
    collected_amount: Number(r.collected_amount) || 0, collected_items: r.collected_items || [],
    slip_url: r.slip_url || '', confirmed_at: r.confirmed_at || '', confirmed_by: r.confirmed_by || '',
    staff_note: r.staff_note || '', cash_received: !!r.cash_received, goods_received: !!r.goods_received,
    created_by: r.created_by || '',
  };
}

export function makeCollectionNo() {
  const now = new Date();
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  return `COL${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

// Phase 2 (write-primary flip, 2026-07-29): adapter สำหรับ pos_pending_receives row (เขียนจากบอท
// LINE ตอน #รับสินค้า) → shape เดียวกับ rowToPendingReceive
export function pendingReceiveFromRow(r) {
  return {
    pending_no: r.pending_no || '', created_at: r.created_at || '', supplier: r.supplier || '',
    invoice_no: r.invoice_no || '', invoice_date: r.invoice_date || '', items: r.items || [],
    image_url: r.image_url || '', branch: r.branch_name || '', status: r.status || 'รอตรวจสอบ',
  };
}

// Phase 2 (write-primary flip, 2026-07-29): adapter สำหรับ pos_pending_expenses row (เขียนจากบอท
// LINE ตอน #รายจ่าย) → shape เดียวกับ rowToPendingExpense
export function pendingExpenseFromRow(r) {
  return {
    pending_no: r.pending_no || '', created_at: r.created_at || '', label: r.label || '',
    vendor: r.vendor || '', amount: Number(r.amount) || 0, vat_type: r.vat_type || 'ไม่มี VAT',
    invoice_no: r.invoice_no || '', invoice_date: r.invoice_date || '', image_url: r.image_url || '',
    branch: r.branch_name || '', status: r.status || 'รอตรวจสอบ',
  };
}

// Phase 2 (write-primary flip, 2026-07-29): adapter สำหรับ pos_receives row → shape เดียวกับ rowToReceive (ลบไปแล้ว, dead since write-primary flip)
export function receiveFromRow(r) {
  return {
    receive_no: r.receive_no || '', created_at: r.transaction_at || '', supplier: r.supplier || '',
    items: r.items || [], total_cost: Number(r.total_cost) || 0, notes: r.notes || '',
    supplier_id: r.supplier_id || '', subtotal: Number(r.subtotal) || 0,
    vat_total: Number(r.vat_total) || 0, photo_url: r.photo_url || '', branch: r.branch_name || '',
  };
}

export function makeCustomerOrderNo() {
  const now = new Date();
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  return `CO${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}${pad(Math.floor(Math.random() * 100))}`;
}
