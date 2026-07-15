/**
 * ตัวช่วย Google Sheets สำหรับ Delivery System
 * ใช้ refresh_token จาก shop_google_configs (เหมือน analytics.js)
 */

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE_BASE = 'https://www.googleapis.com/drive/v3/files';

// แลก refresh token เป็น access token
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

// อ่านข้อมูลจาก sheet range
export async function readSheet(accessToken, sheetId, range) {
  const res = await fetch(
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

// เพิ่มแถวท้าย sheet
export async function appendSheet(accessToken, sheetId, sheetName, row) {
  const range = encodeURIComponent(`${sheetName}!A:Z`);
  const res = await fetch(
    `${SHEETS_BASE}/${sheetId}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [row] }),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Sheets append error: ${err.error?.message || res.status}`);
  }
  return await res.json();
}

// อัปเดตแถวที่รู้ index แล้ว (rowIndex = 1-based รวม header)
export async function updateSheetRow(accessToken, sheetId, sheetName, rowIndex, rowData) {
  const range = encodeURIComponent(`${sheetName}!A${rowIndex}:Z${rowIndex}`);
  const res = await fetch(
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

// สร้าง folder (parentId=null → สร้างใน root ของ Drive)
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

// สร้าง Google Sheet ใน folder
export async function createSpreadsheet(accessToken, name, parentId, headers) {
  // สร้างไฟล์ใน Drive ก่อน
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

  // ดึงชื่อ sheet แรกจริงๆ (อาจเป็น "แผ่น1" บัญชี Google ภาษาไทย ไม่ใช่ "Sheet1" เสมอไป)
  const metaRes = await fetch(`${SHEETS_BASE}/${sheetId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const meta = await metaRes.json();
  const firstSheetGId = meta.sheets?.[0]?.properties?.sheetId;
  const firstSheetName = meta.sheets?.[0]?.properties?.title || 'Sheet1';

  // บังคับ rename เป็น "Sheet1" เสมอ — api/delivery/*.js ทุกไฟล์ hardcode ชื่อ tab เป็น
  // "Sheet1" ตรงๆ ไม่ได้ query ชื่อจริงทุกครั้ง ถ้าไม่ rename ตรงนี้ บัญชี Google ภาษาไทย
  // (ได้ "แผ่น1") จะอ่าน/เขียนชีตผิด range ทันทีที่ตั้งค่าเสร็จ
  if (firstSheetName !== 'Sheet1' && firstSheetGId !== undefined) {
    await fetch(`${SHEETS_BASE}/${sheetId}:batchUpdate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{ updateSheetProperties: { properties: { sheetId: firstSheetGId, title: 'Sheet1' }, fields: 'title' } }],
      }),
    });
  }

  // ใส่ header row
  await appendSheet(accessToken, sheetId, 'Sheet1', headers);
  return sheetId;
}

// Customer Sheet headers
export const CUSTOMER_HEADERS = [
  'เบอร์โทร', 'ชื่อลูกค้า', 'ที่อยู่จัดส่ง', 'พิกัด (lat,lng)', 'หมายเหตุ', 'วันที่เพิ่ม', 'วันที่แก้ไข',
];

// Order Sheet headers
export const ORDER_HEADERS = [
  'เลขออเดอร์', 'วันที่สร้าง', 'เบอร์โทรลูกค้า', 'ชื่อลูกค้า', 'ที่อยู่จัดส่ง',
  'พิกัด', 'รายการสินค้า', 'ยอดรวม', 'สถานะ', 'พนักงานส่ง', 'วิธีชำระ',
  'วันที่ส่ง', 'วันที่ชำระ', 'หมายเหตุ',
];

// สร้าง order number
export function makeOrderNo() {
  const now = new Date();
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  return `ORD${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

// แปลง row array → customer object
export function rowToCustomer(row) {
  return {
    phone:      row[0] || '',
    name:       row[1] || '',
    address:    row[2] || '',
    coords:     row[3] || '',
    notes:      row[4] || '',
    created_at: row[5] || '',
    updated_at: row[6] || '',
  };
}

// แปลง row array → order object
export function rowToOrder(row) {
  return {
    order_no:         row[0]  || '',
    created_at:       row[1]  || '',
    customer_phone:   row[2]  || '',
    customer_name:    row[3]  || '',
    delivery_address: row[4]  || '',
    coords:           row[5]  || '',
    items_text:       row[6]  || '',
    total_amount:     row[7]  || '0',
    status:           row[8]  || 'pending',
    driver_name:      row[9]  || '',
    payment_method:   row[10] || '',
    delivered_at:     row[11] || '',
    paid_at:          row[12] || '',
    notes:            row[13] || '',
  };
}
