/**
 * ตัวช่วย Google Sheets สำหรับ POS System
 * ใช้ refresh_token จาก shop_google_configs (เหมือน google-delivery.js)
 */

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

export async function readSheet(accessToken, sheetId, range) {
  const res = await sheetsFetch(
    `${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent(range)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Sheets read error: ${err.error?.message || res.status}`);
  }
  const d = await res.json();
  return d.values || [];
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

export async function updateSheetRow(accessToken, sheetId, sheetName, rowIndex, rowData) {
  const range = encodeURIComponent(`${sheetName}!A${rowIndex}:Z${rowIndex}`);
  const res = await sheetsFetch(
    `${SHEETS_BASE}/${sheetId}/values/${range}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [rowData] }),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Sheets update error: ${err.error?.message || res.status}`);
  }
  return await res.json();
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

// ตรวจว่า tab มีอยู่ใน spreadsheet ไหม ถ้าไม่มีให้สร้างพร้อม header
export async function ensureTabExists(accessToken, sheetId, tabName, headers) {
  const metaRes = await fetch(`${SHEETS_BASE}/${sheetId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const meta = await metaRes.json();
  const exists = meta.sheets?.some(s => s.properties.title === tabName);
  if (!exists) {
    await fetch(`${SHEETS_BASE}/${sheetId}:batchUpdate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: tabName } } }] }),
    });
    if (headers?.length) await appendSheet(accessToken, sheetId, tabName, headers);
    return;
  }

  // แท็บมีอยู่แล้ว แต่ header อาจสั้นกว่ามาตรฐานปัจจุบัน (เช่น ร้านเชื่อมต่อ POS ไว้ก่อนที่
  // schema จะขยายคอลัมน์เพิ่มทีหลัง) — ถ้าไม่ patch header ให้ครบ การ append แถวใหม่จะ
  // เพี้ยนตำแหน่งไปเรื่อยๆ ได้ (เจอบั๊กจริงในโปรดักชันมาแล้วกับแท็บ "สินค้า") จึงต้องเช็ค
  // และเติม header ที่ขาดให้ครบทุกครั้งที่เปิดใช้แท็บนี้ เหมือนที่บอทมี getOrCreateYearSheet()
  if (headers?.length) {
    const range = `${tabName}!A1:${colLetter(headers.length)}1`;
    const res = await fetch(`${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent(range)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const d = await res.json();
    const currentHeader = d.values?.[0] || [];
    if (currentHeader.length < headers.length) {
      await fetch(
        `${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: [headers] }),
        }
      );
    }
  }
}

// สร้าง spreadsheet ที่มี 7 tabs: สินค้า, ยอดขาย, ผู้ติดต่อ, รับสินค้า, ลูกค้า, พนักงาน, ออเดอร์จัดส่ง
export async function createPosSpreadsheet(accessToken, name, parentId) {
  const res = await fetch(DRIVE_BASE, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.spreadsheet',
      parents: [parentId],
    }),
  });
  const d = await res.json();
  if (!d.id) throw new Error('สร้าง spreadsheet ไม่ได้: ' + JSON.stringify(d));
  const sheetId = d.id;

  // ดู gid ของ sheet แรก (อาจเป็น Sheet1 หรือ แผ่น1 ขึ้นกับภาษาบัญชี Google)
  const metaRes = await fetch(`${SHEETS_BASE}/${sheetId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const meta = await metaRes.json();
  const sheet1GId = meta.sheets[0].properties.sheetId;

  // Rename sheet แรก → สินค้า, เพิ่ม tab อีก 3 อัน
  await fetch(`${SHEETS_BASE}/${sheetId}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [
        {
          updateSheetProperties: {
            properties: { sheetId: sheet1GId, title: 'สินค้า' },
            fields: 'title',
          },
        },
        { addSheet: { properties: { title: 'ยอดขาย' } } },
        { addSheet: { properties: { title: 'ผู้ติดต่อ' } } },
        { addSheet: { properties: { title: 'รับสินค้า' } } },
        { addSheet: { properties: { title: 'พนักงาน' } } },
        { addSheet: { properties: { title: 'ออเดอร์จัดส่ง' } } },
        { addSheet: { properties: { title: 'ยืมสินค้า' } } },
      ],
    }),
  });

  // เขียน header ทั้ง 6 tab (รวม ลูกค้า+ผู้ติดต่อ ไว้ใน "ผู้ติดต่อ" tab เดียว)
  await appendSheet(accessToken, sheetId, 'สินค้า', PRODUCT_HEADERS);
  await appendSheet(accessToken, sheetId, 'ยอดขาย', SALE_HEADERS);
  await appendSheet(accessToken, sheetId, 'ผู้ติดต่อ', CONTACT_HEADERS);
  await appendSheet(accessToken, sheetId, 'รับสินค้า', RECEIVE_HEADERS);
  await appendSheet(accessToken, sheetId, 'พนักงาน', STAFF_HEADERS);
  await appendSheet(accessToken, sheetId, 'ออเดอร์จัดส่ง', ORDER_HEADERS);
  await appendSheet(accessToken, sheetId, 'ยืมสินค้า', LOAN_HEADERS);

  return sheetId;
}

// ── Header Definitions ────────────────────────────────────────────────────────

// A-M เดิม + N=รหัสผู้ใช้ O=บาร์โค้ด P=รายละเอียด Q=VAT R=สถานะ
// S=เพดานเปล่ารอรีฟิล เพิ่มท้ายสุด — ใช้เตือนสต็อคเปล่าล้น (เกินเพดาน = ของหมุนเวียนค้างไม่ได้รีฟิลเยอะผิดปกติ)
export const PRODUCT_HEADERS = [
  'รหัสสินค้า (ระบบ)', 'ชื่อสินค้า', 'หมวดหมู่', 'ราคาขาย (บาท)',
  'ราคาทุนเฉลี่ย (บาท)', 'จำนวนสต็อค', 'หน่วย', 'คำค้น/ชื่ออื่น', 'หมายเหตุ', 'วันที่อัปเดต',
  'ประเภท', 'กับลูกค้า', 'เปล่ารอรีฟิล',
  'รหัสสินค้า (ผู้ใช้)', 'บาร์โค้ด', 'รายละเอียดสินค้า', 'VAT', 'สถานะ',
  'เพดานเปล่ารอรีฟิล',
];

// Q-R (ยอดก่อน VAT/ยอด VAT) เพิ่มท้ายสุด — ไม่แทรกกลาง กันข้อมูลเก่าเลื่อนคอลัมน์ผิด
// คำนวณจาก vat_type ของสินค้าแต่ละชิ้น (ไม่รวมผลของส่วนลดบิล — เหมือน pattern เดียวกับใบกำกับภาษี)
export const SALE_HEADERS = [
  'เลขบิล', 'วันที่-เวลา', 'รายการสินค้า (JSON)', 'ยอดรวมก่อนลด',
  'ส่วนลด', 'ยอดสุทธิ', 'วิธีชำระ', 'เงินรับ', 'เงินทอน', 'ผู้ขาย', 'หมายเหตุ', 'สถานะ',
  'รหัสลูกค้า', 'ชื่อลูกค้า', 'วันที่ชำระ', 'สาขา', 'ยอดก่อน VAT (บาท)', 'ยอด VAT (บาท)',
];

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

// tab "ยืมสินค้า"
export const LOAN_HEADERS = [
  'เลขที่ยืม', 'วันที่ยืม', 'กำหนดคืน', 'รหัสผู้ติดต่อ', 'ชื่อผู้ติดต่อ', 'เบอร์โทร',
  'รายการสินค้า (JSON)', 'หมายเหตุ', 'สถานะ', 'วันที่คืน', 'สาขา',
];

// tab "ใบกำกับภาษี" — ใบกำกับภาษีที่ร้านออกให้ลูกค้าของร้านเอง (คนละระบบกับใบกำกับภาษี
// ที่ Smile Slip Pro ออกให้ร้านตอนซื้อแพ็กเกจ — นี่คือร้านออกให้ลูกค้าร้านตัวเอง)
// เลขที่รันต่อปี ไม่ให้เลขขาดหาย (นับจากจำนวนแถวที่มีอยู่ของปีนั้น + 1)
// เพิ่ม O=ชื่อผู้ขาย(สาขา) P=ที่อยู่ผู้ขาย(สาขา) ท้ายสุด — เก็บชื่อ/ที่อยู่ "ผู้ออกใบกำกับภาษี" ที่แท้จริง
// ตอนออกจริง (เผื่อสาขาที่ออกมีแบรนด์/ที่อยู่แยกจากบริษัทหลัก) แช่แข็งไว้ ณ เวลาที่ออก ไม่คำนวณใหม่
// ตอนพิมพ์ซ้ำทีหลัง (กันเอกสารเปลี่ยนย้อนหลังถ้าตั้งค่าสาขาถูกแก้ไขในอนาคต) — ว่าง = ใบเก่าก่อนมีฟีเจอร์นี้
// (fallback ไปใช้ข้อมูลบริษัทหลักที่ tax-invoice-pdf.js เหมือนเดิม)
export const TAX_INVOICE_HEADERS = [
  'เลขที่ใบกำกับภาษี', 'วันที่ออก', 'เลขที่บิลอ้างอิง', 'รหัสลูกค้า',
  'ชื่อผู้ซื้อ', 'เลขภาษีผู้ซื้อ', 'ที่อยู่ผู้ซื้อ', 'สาขาผู้ซื้อ',
  'รายการ (JSON)', 'ยอดก่อน VAT', 'ยอด VAT', 'ยอดรวม', 'ออกโดย', 'เบอร์โทรผู้ซื้อ',
  'ชื่อผู้ขาย (สาขา)', 'ที่อยู่ผู้ขาย (สาขา)',
];

export function rowToTaxInvoice(row) {
  let items = [];
  try { items = JSON.parse(row[8] || '[]'); } catch {}
  return {
    invoice_no:   row[0]  || '',
    issued_at:    row[1]  || '',
    ref_bill_no:  row[2]  || '',
    customer_id:  row[3]  || '',
    buyer_name:   row[4]  || '',
    buyer_tax_id: row[5]  || '',
    buyer_address:row[6]  || '',
    buyer_branch: row[7]  || '',
    items,
    subtotal:     parseFloat(row[9])  || 0,
    vat:          parseFloat(row[10]) || 0,
    total:        parseFloat(row[11]) || 0,
    issued_by:    row[12] || '',
    buyer_phone:  row[13] || '',
    seller_name:    row[14] || '',
    seller_address: row[15] || '',
  };
}

// A-W (23 คอลัมน์) — รวม ลูกค้า + ผู้จำหน่าย + ข้อมูลภาษีบริษัท + ประเภทบุคคล
export const CONTACT_HEADERS = [
  'รหัสผู้ติดต่อ', 'ชื่อ', 'ประเภท (ลูกค้า/ผู้จำหน่าย/ทั้งคู่)', 'เบอร์โทร', 'อีเมล',
  'ที่อยู่_1', 'maps_1', 'ที่อยู่_2', 'maps_2',
  'ชื่อบริษัท', 'เลขภาษี', 'ที่อยู่ภาษี', 'สาขา',
  'ยอดค้าง (บาท)', 'ถังอยู่กับลูกค้า', 'ชื่อร้านค้า',
  'คำค้น/aliases', 'หมายเหตุ', 'วันที่เพิ่ม', 'วันที่อัปเดต',
  'ประเภทบุคคล', 'ชื่อผู้ติดต่อ (นิติบุคคล)', 'เบอร์ผู้ติดต่อ (นิติบุคคล)',
  'วงเงินยืมสูงสุด (ชิ้น)',
];

// รหัสผู้จำหน่าย/ยอดก่อน VAT/ยอด VAT รวม (G-I) เพิ่มท้ายสุด — ผูกกับ contact_id จริงแทน
// ข้อความอิสระเดิม + แตกยอด VAT ออกจากยอดต้นทุนรวม (col E ยังหมายถึงยอดสุทธิรวม VAT เหมือนเดิม
// เพื่อไม่กระทบของเก่า)
// J=ลิงก์รูปภาพหลักฐานบิล เพิ่มท้ายสุด — ใช้เป็น "verified data filter" สำหรับดัชนีราคากลาง
// (มีรูปแนบ = ข้อมูลราคาน่าเชื่อถือ เอาเข้าตารางกลางได้ / ไม่มีรูป = คีย์มือเปล่าๆ ข้ามไม่เอาเข้า)
export const RECEIVE_HEADERS = [
  'เลขที่รับสินค้า', 'วันที่-เวลา', 'ผู้จำหน่าย', 'รายการสินค้า (JSON)',
  'ยอดต้นทุนรวม (บาท)', 'หมายเหตุ',
  'รหัสผู้จำหน่าย', 'ยอดก่อน VAT (บาท)', 'ยอด VAT รวม (บาท)',
  'ลิงก์รูปภาพหลักฐาน',
];


// A           B     C        D          E      F        G           H       I
// สาขา (H) + PIN (I) เพิ่มท้ายสุด — ไม่แทรกกลาง กันข้อมูลเก่าเลื่อนคอลัมน์ผิด (ensureTabExists
// auto-patch header ที่สั้นกว่าให้อยู่แล้ว) — PIN เป็นรหัสส่วนตัวที่พนักงานตั้งเอง (ไม่ใช่ PIN ร้านเดียวใช้ร่วมกันแบบเดิม)
export const STAFF_HEADERS = [
  'รหัสพนักงาน', 'ชื่อ', 'เบอร์โทร', 'LINE ID', 'บทบาท', 'หมายเหตุ', 'วันที่เพิ่ม', 'สาขา', 'PIN',
];

// A          B          C             D           E      F       G         H              I        J         K           L      M       N
//            O            P                Q              R                     S                      T
// O-T เพิ่มท้ายสุด — ไม่แทรกกลาง กันข้อมูลเก่าเลื่อนคอลัมน์ผิด (ensureTabExists auto-patch
// header ที่สั้นกว่าให้อยู่แล้ว)
export const ORDER_HEADERS = [
  'เลขออเดอร์', 'วันที่-เวลา', 'รหัสลูกค้า', 'ชื่อลูกค้า', 'เบอร์',
  'ที่อยู่จัดส่ง', 'maps_link', 'รายการ (JSON)', 'ยอดรวม (บาท)',
  'วิธีชำระ', 'รหัสพนักงานส่ง', 'ชื่อพนักงานส่ง', 'สถานะ', 'หมายเหตุ',
  'ลิงก์สลิป', 'ยืนยันจัดส่งเมื่อ', 'ยืนยันโดย', 'รับเงินเข้าร้านแล้ว',
  'รับของคืนเข้าคลังแล้ว', 'สร้างโดย', 'ชำระเงินเชื่อแล้ว',
];

// tab "รายจ่าย" — ค่าใช้จ่ายของร้านที่ไม่เกี่ยวกับสต็อคสินค้า (ค่าเช่า/ค่าน้ำไฟ/ค่าแรง ฯลฯ)
// คนละระบบกับ "รับสินค้า" (นั่นคือซื้อสินค้าเข้าสต็อค) — vat_type ใช้ชุดค่าเดียวกับสินค้า/รับสินค้า
export const EXPENSE_HEADERS = [
  'เลขที่รายจ่าย', 'วันที่-เวลา', 'รายการ/หมวดหมู่', 'จำนวนเงินรวม (บาท)',
  'ประเภท VAT', 'ยอดก่อน VAT (บาท)', 'ยอด VAT (บาท)', 'วิธีชำระ',
  'ลิงก์รูปภาพบิล/สลิป', 'หมายเหตุ', 'ผู้บันทึก', 'สาขา',
];

export function makeExpenseNo() {
  const now = new Date();
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  return `EXP${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

export function rowToExpense(row) {
  return {
    expense_no: row[0] || '',
    created_at: row[1] || '',
    label:      row[2] || '',
    total:      parseFloat(row[3]) || 0,
    vat_type:   row[4] || 'ไม่มี VAT',
    subtotal:   parseFloat(row[5]) || 0,
    vat_amount: parseFloat(row[6]) || 0,
    payment_method: row[7] || '',
    photo_url:  row[8] || '',
    notes:      row[9] || '',
    recorded_by: row[10] || '',
    branch:     row[11] || '',
  };
}

// tab "บันทึกแลกเปลี่ยน" — audit log รายรายการของการยืม/แลกเปลี่ยน/คืน/รีฟิลสินค้าหมุนเวียน
// (คนละอย่างกับ tab "รับสินค้า"/"ยอดขาย" ที่บันทึกบิลทั้งใบ — อันนี้บันทึกเฉพาะ "การเคลื่อนไหว
// ของสินค้าหมุนเวียน" ทีละ SKU ทีละครั้ง เพื่อตรวจสอบย้อนหลังได้ว่าใครยืม/คืน/แลกอะไรไปเมื่อไหร่)
export const CYCLICAL_LOG_HEADERS = [
  'เลขที่บันทึก', 'วันที่-เวลา', 'รหัสสินค้า', 'ชื่อสินค้า',
  'แหล่งที่มา', 'การกระทำ', 'จำนวน', 'รหัสลูกค้า', 'ชื่อลูกค้า', 'สาขา', 'ผู้ทำรายการ',
];

export function makeCyclicalLogNo() {
  const now = new Date();
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  return `CYC${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}${pad(Math.floor(Math.random() * 100))}`;
}

export function rowToCyclicalLog(row) {
  return {
    log_no:       row[0]  || '',
    created_at:   row[1]  || '',
    sku:          row[2]  || '',
    name:         row[3]  || '',
    source:       row[4]  || '',
    action:       row[5]  || '',
    qty:          parseFloat(row[6]) || 0,
    customer_id:  row[7]  || '',
    customer_name:row[8]  || '',
    branch:       row[9]  || '',
    performed_by: row[10] || '',
  };
}

// source: 'ขายหน้าร้าน'|'จัดส่ง'|'เก็บเงิน/ของ' — action: 'แลกเปลี่ยน'|'ยืม'|'คืน'
// เรียกใช้แบบ fail-safe (ไม่ throw) กันบันทึก log พังจนกระทบ transaction หลัก
export async function logCyclicalTransaction(token, sheetId, { sku, name, source, action, qty, customerId, customerName, branch, performedBy }) {
  if (!qty || qty <= 0) return;
  try {
    await ensureTabExists(token, sheetId, 'บันทึกแลกเปลี่ยน', CYCLICAL_LOG_HEADERS);
    const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
    await appendSheet(token, sheetId, 'บันทึกแลกเปลี่ยน', [
      makeCyclicalLogNo(), `'${now}`, sku || '', name || '',
      source || '', action || '', qty, customerId || '', customerName || '', branch || '', performedBy || '',
    ]);
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
  return 'P' + Date.now().toString(36).toUpperCase().slice(-6);
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

export function rowToProduct(row) {
  const rawType = row[10] || 'นับสต็อค';
  return {
    sku:           row[0] || '',
    name:          row[1] || '',
    category:      row[2] || '',
    price:         parseFloat(row[3]) || 0,
    cost:          parseFloat(row[4]) || 0,
    stock:         parseFloat(row[5]) || 0,
    unit:          row[6] || 'ชิ้น',
    aliases:       row[7] || '',
    notes:         row[8] || '',
    updated_at:    row[9] || '',
    type:          rawType === 'ทั่วไป' ? 'นับสต็อค' : rawType, // backward compat
    at_customer:   parseFloat(row[11]) || 0,
    empty_waiting: parseFloat(row[12]) || 0,
    product_code:  row[13] || '',
    barcode:       row[14] || '',
    description:   row[15] || '',
    vat_type:      row[16] || 'ไม่มี VAT',
    is_active:     row[17] !== '0', // default active
    empty_ceiling: parseFloat(row[18]) || 0, // 0 = ไม่ตั้งเพดาน
  };
}

export function rowToSale(row) {
  let items = [];
  try { items = JSON.parse(row[2] || '[]'); } catch {}
  return {
    bill_no:        row[0]  || '',
    created_at:     row[1]  || '',
    items,
    subtotal:       parseFloat(row[3]) || 0,
    discount:       parseFloat(row[4]) || 0,
    total:          parseFloat(row[5]) || 0,
    payment_method: row[6]  || '',
    cash_received:  parseFloat(row[7]) || 0,
    change:         parseFloat(row[8]) || 0,
    cashier:        row[9]  || '',
    notes:          row[10] || '',
    status:         row[11] || 'ชำระแล้ว',
    customer_id:    row[12] || '',
    customer_name:  row[13] || '',
    paid_at:        row[14] || '',
    branch:         row[15] || '',
    vat_subtotal:   parseFloat(row[16]) || 0,
    vat_amount:     parseFloat(row[17]) || 0,
  };
}

export function rowToLoan(row) {
  let items = [];
  try { items = JSON.parse(row[6] || '[]'); } catch {}
  return {
    loan_no:      row[0]  || '',
    created_at:   row[1]  || '',
    due_date:     row[2]  || '',
    contact_id:   row[3]  || '',
    contact_name: row[4]  || '',
    contact_phone:row[5]  || '',
    items,
    notes:        row[7]  || '',
    status:       row[8]  || 'ยืมอยู่',
    returned_at:  row[9]  || '',
    branch:       row[10] || '',
  };
}

export function rowToContact(row) {
  return {
    contact_id:          row[0]  || '',
    name:                row[1]  || '',
    contact_type:        row[2]  || 'ผู้จำหน่าย',
    phone:               row[3]  || '',
    email:               row[4]  || '',
    address_1:           row[5]  || '',
    maps_1:              row[6]  || '',
    address_2:           row[7]  || '',
    maps_2:              row[8]  || '',
    company_name:        row[9]  || '',
    tax_id:              row[10] || '',
    tax_address:         row[11] || '',
    tax_branch:          row[12] || '',
    debt:                parseFloat(row[13]) || 0,
    cylinders:           parseFloat(row[14]) || 0,
    shop_name:           row[15] || '',
    aliases:             row[16] || '',
    notes:               row[17] || '',
    created_at:          row[18] || '',
    updated_at:          row[19] || '',
    person_type:         row[20] || 'บุคคลธรรมดา',
    contact_person_name: row[21] || '',
    contact_person_phone:row[22] || '',
    cylinder_limit:      parseFloat(row[23]) || 0, // 0 = ไม่จำกัด
  };
}

export function rowToStaff(row) {
  return {
    staff_id:    row[0] || '',
    name:        row[1] || '',
    phone:       row[2] || '',
    line_id:     row[3] || '',
    role:        row[4] || 'พนักงานส่ง',
    notes:       row[5] || '',
    created_at:  row[6] || '',
    branch_name: row[7] || '',
    has_pin:     !!(row[8] && String(row[8]).trim()),
  };
}

export function rowToOrder(row) {
  let items = [];
  try { items = JSON.parse(row[7] || '[]'); } catch {}
  return {
    order_no:    row[0]  || '',
    created_at:  row[1]  || '',
    customer_id: row[2]  || '',
    customer_name: row[3] || '',
    phone:       row[4]  || '',
    address:     row[5]  || '',
    maps_link:   row[6]  || '',
    items,
    total:       parseFloat(row[8]) || 0,
    payment_method: row[9] || '',
    staff_id:    row[10] || '',
    staff_name:  row[11] || '',
    status:      row[12] || 'รอจัดส่ง',
    notes:       row[13] || '',
    slip_url:      row[14] || '',
    confirmed_at:  row[15] || '',
    confirmed_by:  row[16] || '',
    cash_received: row[17] === 'TRUE' || row[17] === '1',
    goods_received: row[18] === 'TRUE' || row[18] === '1',
    created_by:    row[19] || '',
    credit_settled: row[20] === 'TRUE' || row[20] === '1',
  };
}

// tab "งานเก็บเงิน/ของ" — ส่งพนักงานไปเก็บเงินเชื่อค้างชำระ และ/หรือสินค้าหมุนเวียนที่ลูกค้ายืมค้างอยู่
// A-U (21 คอลัมน์) mirror pattern เดียวกับ ORDER_HEADERS (สร้าง/ยืนยันโดยพนักงาน แล้วแอดมินยืนยันรับเข้าร้านอีกชั้น)
export const COLLECTION_HEADERS = [
  'เลขที่งาน', 'วันที่-เวลา', 'รหัสลูกค้า', 'ชื่อลูกค้า', 'เบอร์',
  'ประเภทงาน', 'ยอดที่ต้องเก็บ (บาท)', 'สินค้าที่ต้องเก็บคืน (JSON)',
  'รหัสพนักงาน', 'ชื่อพนักงาน', 'สถานะ', 'หมายเหตุ',
  'ยอดที่เก็บได้จริง (บาท)', 'สินค้าที่เก็บคืนได้จริง (JSON)',
  'ลิงก์สลิป', 'ยืนยันเมื่อ', 'ยืนยันโดย', 'หมายเหตุจากพนักงาน',
  'รับเงินเข้าร้านแล้ว', 'รับของเข้าคลังแล้ว', 'สร้างโดย',
];

export function rowToCollection(row) {
  let items = [];
  try { items = JSON.parse(row[7] || '[]'); } catch {}
  let collectedItems = [];
  try { collectedItems = JSON.parse(row[13] || '[]'); } catch {}
  return {
    collection_no:  row[0]  || '',
    created_at:     row[1]  || '',
    customer_id:    row[2]  || '',
    customer_name:  row[3]  || '',
    phone:          row[4]  || '',
    task_type:      row[5]  || 'เงินเชื่อ',
    debt_amount:    parseFloat(row[6]) || 0,
    items,
    staff_id:       row[8]  || '',
    staff_name:     row[9]  || '',
    status:         row[10] || 'รอดำเนินการ',
    notes:          row[11] || '',
    collected_amount: parseFloat(row[12]) || 0,
    collected_items: collectedItems,
    slip_url:       row[14] || '',
    confirmed_at:   row[15] || '',
    confirmed_by:   row[16] || '',
    staff_note:     row[17] || '',
    cash_received:  row[18] === 'TRUE' || row[18] === '1',
    goods_received: row[19] === 'TRUE' || row[19] === '1',
    created_by:     row[20] || '',
  };
}

export function makeCollectionNo() {
  const now = new Date();
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  return `COL${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

// tab "รับสินค้ารอยืนยัน" — สร้างจากบอท LINE เมื่อพิมพ์ #รับสินค้า แล้วส่งรูปใบส่งของ (รอแอดมินตรวจสอบ/แก้ไข
// ก่อนตัดเข้าสต็อคจริงผ่าน /api/pos/receives ปกติ — ไฟล์นี้แค่อ่าน/ลบ ไม่แตะสต็อคเอง)
export const PENDING_RECEIVE_HEADERS = ['เลขที่รอยืนยัน', 'วันที่-เวลา', 'ผู้จำหน่าย (OCR)', 'เลขที่เอกสาร', 'วันที่ในเอกสาร', 'รายการสินค้า (JSON)', 'ลิงก์รูปภาพ', 'สาขา', 'สถานะ'];

export function rowToPendingReceive(row) {
  let items = [];
  try { items = JSON.parse(row[5] || '[]'); } catch {}
  return {
    pending_no:    row[0] || '',
    created_at:    row[1] || '',
    supplier:      row[2] || '',
    invoice_no:    row[3] || '',
    invoice_date:  row[4] || '',
    items,
    image_url:     row[6] || '',
    branch:        row[7] || '',
    status:        row[8] || 'รอตรวจสอบ',
  };
}

// tab "รายจ่ายรอยืนยัน" — มาจากบอท LINE #รายจ่าย (คนละ tab กับ "รายจ่าย" ที่ยืนยันแล้ว)
export const PENDING_EXPENSE_HEADERS = ['เลขที่รอยืนยัน', 'วันที่-เวลา', 'รายการ/หมวดหมู่ (OCR)', 'ผู้รับเงิน (OCR)', 'จำนวนเงิน (OCR)', 'ประเภท VAT (OCR)', 'เลขที่เอกสาร', 'วันที่ในเอกสาร', 'ลิงก์รูปภาพ', 'สาขา', 'สถานะ'];

export function rowToPendingExpense(row) {
  return {
    pending_no:   row[0]  || '',
    created_at:   row[1]  || '',
    label:        row[2]  || '',
    vendor:       row[3]  || '',
    amount:       parseFloat(row[4]) || 0,
    vat_type:     row[5]  || 'ไม่มี VAT',
    invoice_no:   row[6]  || '',
    invoice_date: row[7]  || '',
    image_url:    row[8]  || '',
    branch:       row[9]  || '',
    status:       row[10] || 'รอตรวจสอบ',
  };
}

export function rowToReceive(row) {
  let items = [];
  try { items = JSON.parse(row[3] || '[]'); } catch {}
  return {
    receive_no:  row[0] || '',
    created_at:  row[1] || '',
    supplier:    row[2] || '',
    items,
    total_cost:  parseFloat(row[4]) || 0,
    notes:       row[5] || '',
    supplier_id: row[6] || '',
    subtotal:    parseFloat(row[7]) || 0,
    vat_total:   parseFloat(row[8]) || 0,
    photo_url:   row[9] || '',
  };
}
