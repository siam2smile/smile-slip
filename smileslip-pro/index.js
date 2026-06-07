const express = require('express');
const axios = require('axios');
const FormData = require('form-data');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// เก็บ rawBody ไว้สำหรับ verify LINE signature
app.use(express.json({
  verify: (req, res, buf) => { req.rawBody = buf; }
}));

// ==========================================
// 1. SYSTEM CONFIGURATION & DATABASE
// ==========================================
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_PUBLIC_KEY);

const LINE_HEADER = {
  headers: { Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` }
};

// LINE Signature Verification — ป้องกันการปลอม webhook
function verifyLineSignature(rawBody, signature) {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret) {
    console.warn('[SECURITY] ⚠️ LINE_CHANNEL_SECRET ไม่ได้ตั้งค่า — ข้ามการ verify');
    return true;
  }
  if (!signature) return false;
  const hash = crypto.createHmac('SHA256', secret).update(rawBody).digest('base64');
  return hash === signature;
}

// Duplicate event guard: กัน LINE retry ตัดเครดิตซ้ำ (TTL 5 นาที)
const processedEvents = new Map();
function isDuplicateEvent(eventId) {
  const now = Date.now();
  for (const [id, ts] of processedEvents) {
    if (now - ts > 5 * 60 * 1000) processedEvents.delete(id);
  }
  if (processedEvents.has(eventId)) return true;
  processedEvents.set(eventId, now);
  return false;
}

// ==========================================
// 2. HELPER FUNCTIONS
// ==========================================

// 2.0 ระบบ Tier — เช็คสิทธิ์แพ็กเกจ
const TIER_LEVEL = { normal: 0, pro: 1, advance: 2, super: 3 };
const MAX_BRANCHES = { normal: 1, pro: 1, advance: 5, super: 20 };
function getTier(shop) {
  return (shop.subscription_tier || 'normal').toLowerCase();
}
function hasFeature(shop, minTier) {
  return (TIER_LEVEL[getTier(shop)] || 0) >= (TIER_LEVEL[minTier] || 0);
}
function isSuper(shop) { return getTier(shop) === 'super'; }

// ค้นหาร้านค้าจาก sourceId — รองรับทั้ง shop_profiles และ shop_branches
async function findShopBySource(sourceId) {
  // 1. ค้นหาจาก shop_profiles โดยตรง (กลุ่มหลัก หรือ DM เจ้าของ)
  const { data: shop } = await supabase
    .from('shop_profiles')
    .select('*')
    .or(`line_group_id.eq.${sourceId},owner_line_id.eq.${sourceId}`)
    .maybeSingle();
  if (shop) return { shop, branchName: shop.shop_name, isOwnerChat: !!shop.owner_line_id && shop.owner_line_id === sourceId };

  // 2. ค้นหาจาก shop_branches (สาขาต่างๆ)
  const { data: branch } = await supabase
    .from('shop_branches')
    .select('*, shop_profiles(*)')
    .eq('line_group_id', sourceId)
    .eq('is_active', true)
    .maybeSingle();
  if (branch?.shop_profiles) {
    return { shop: branch.shop_profiles, branchName: branch.branch_name, isOwnerChat: false };
  }

  return null;
}

// Push แจ้งเตือนส่วนตัวเจ้าของ (Pro+)
async function pushToOwner(ownerLineId, messages) {
  try {
    await axios.post('https://api.line.me/v2/bot/message/push', { to: ownerLineId, messages }, LINE_HEADER);
    console.log(`[LOG] 📲 Push แจ้งเจ้าของสำเร็จ`);
  } catch (err) {
    console.error('[WARN] Push to owner failed:', err.response?.data?.message || err.message);
  }
}

// 2.1 ปรับเวลาเป็นประเทศไทย (UTC+7) — ใช้ปี ค.ศ. (Gregorian) สำหรับชื่อโฟลเดอร์
const getThaiDateTime = () => {
  const bangkokTime = new Date(new Date().getTime() + (7 * 60 * 60 * 1000));
  const year = String(bangkokTime.getFullYear());
  const month = String(bangkokTime.getMonth() + 1).padStart(2, '0');
  const day = String(bangkokTime.getDate()).padStart(2, '0');
  return {
    date: bangkokTime.toLocaleDateString('th-TH'),
    time: bangkokTime.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false }),
    raw: bangkokTime,
    year,
    month,
    isoDate: `${year}-${month}-${day}`,       // "2026-06-02" ใช้ filter Sheet
    monthFolderName: `${month}-${year}`,       // "06-2026"
  };
};

// 2.1b แปลงวันที่บนสลิป (DD/MM/YYYY หรือ DD/MM/YY) → { year, monthFolderName }
// ใช้สำหรับ Drive folder ให้ตรงกับวันที่จริงบนสลิป ไม่ใช่วันที่บันทึก
function parseSlipDateForFolder(slipDate) {
  const parts = (slipDate || '').split('/');
  if (parts.length !== 3) return null;
  let [, mm, yyyy] = parts.map(p => parseInt(p.trim(), 10));
  if (isNaN(mm) || isNaN(yyyy)) return null;
  if (yyyy > 2500) yyyy -= 543; // แปลง พ.ศ. → ค.ศ.
  if (yyyy < 100) yyyy += 2000;
  const month = String(mm).padStart(2, '0');
  const year = String(yyyy);
  return { year, monthFolderName: `${month}-${year}` };
}

// 2.2 ดึง Google Access Token ด้วย Refresh Token
async function getAccessToken(refreshToken) {
  console.log(`[LOG] 🔑 กำลังขอ Google Access Token ใหม่...`);
  try {
    const res = await axios.post('https://oauth2.googleapis.com/token', {
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
    });
    console.log(`[LOG] ✅ ได้รับ Google Access Token สำเร็จ`);
    return res.data.access_token;
  } catch (error) {
    console.error("[ERROR] Google Token Error:", error.message);
    const err = new Error("ไม่สามารถเชื่อมต่อบัญชี Google ของร้านค้าได้");
    // invalid_grant = token หมดอายุหรือถูก revoke
    err.isTokenInvalid = error.response?.data?.error === 'invalid_grant';
    throw err;
  }
}

// 2.3 ดาวน์โหลดรูปสลิปจาก LINE Server
async function getLineImage(messageId) {
  console.log(`[LOG] 📥 กำลังดาวน์โหลดรูปภาพจาก LINE (ID: ${messageId})...`);
  const url = `https://api-data.line.me/v2/bot/message/${messageId}/content`;
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      const response = await axios.get(url, { ...LINE_HEADER, responseType: 'arraybuffer', timeout: 20000 });
      return Buffer.from(response.data);
    } catch (err) {
      lastErr = err;
      const isNetwork = err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED' || err.message?.includes('socket') || err.message?.includes('TLS');
      if (isNetwork && i < 2) {
        console.log(`[LOG] ⚠️ LINE download ล้มเหลว (ครั้งที่ ${i + 1}) — retry ใน 2s...`);
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

// 2.4 สร้างโฟลเดอร์ Google Drive แบบแยกตาม เดือน/ปี
async function getOrCreateDriveFolder(accessToken, parentFolderId, folderName) {
  console.log(`[LOG] 📁 ค้นหา folder "${folderName}" ใน parent: ${parentFolderId}`);
  const query = `name='${folderName}' and '${parentFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true`;

  const searchRes = await axios.get(searchUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
  const found = searchRes.data.files;

  if (found && found.length > 0) {
    console.log(`[LOG] ✅ พบ folder "${folderName}" เดิม (ID: ${found[0].id})`);
    return found[0].id;
  }

  console.log(`[LOG] ➕ ไม่พบ folder "${folderName}" — กำลังสร้างใหม่...`);
  const createRes = await axios.post('https://www.googleapis.com/drive/v3/files', {
    name: folderName,
    mimeType: 'application/vnd.google-apps.folder',
    parents: [parentFolderId]
  }, { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } });

  console.log(`[LOG] ✅ สร้าง folder "${folderName}" สำเร็จ (ID: ${createRes.data.id})`);
  return createRes.data.id;
}

// 2.5 อัปโหลดรูปลง Google Drive
async function uploadToGoogleDrive(imageBuffer, accessToken, folderId, fileName) {
  console.log(`[LOG] ☁️ กำลังอัปโหลดรูปลง Google Drive...`);
  const form = new FormData();
  form.append('metadata', JSON.stringify({ name: fileName, parents: [folderId] }), { contentType: 'application/json' });
  form.append('file', imageBuffer, { filename: fileName, contentType: 'image/jpeg' });

  const res = await axios.post('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', form, {
    headers: { ...form.getHeaders(), Authorization: `Bearer ${accessToken}` }
  });

  console.log(`[LOG] ✅ อัปโหลดรูปสำเร็จ (Drive ID: ${res.data.id})`);
  return res.data.id;
}

// 2.6 สร้าง tab ปีใน Spreadsheet (ถ้ายังไม่มี) พร้อม header 10 คอลัมน์
async function getOrCreateYearSheet(accessToken, spreadsheetId, year) {
  const metaRes = await axios.get(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const exists = metaRes.data.sheets?.some(s => s.properties.title === year);
  if (exists) { console.log(`[LOG] ✅ Sheet tab "${year}" มีอยู่แล้ว`); return; }

  console.log(`[LOG] ➕ สร้าง Sheet tab "${year}" ใหม่...`);
  await axios.post(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
    { requests: [{ addSheet: { properties: { title: year } } }] },
    { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
  );
  await axios.put(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(year + '!A1:J1')}?valueInputOption=USER_ENTERED`,
    { values: [['วันที่สลิป','เวลา','ประเภท (รายรับ/รายจ่าย)','จำนวนเงิน (บาท)','ผู้โอน','ผู้รับ','หมายเหตุ','ลิงก์สลิป (Drive)','วันที่บันทึก (recorded_at)','ชื่อสาขา']] },
    { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
  );
  console.log(`[LOG] ✅ สร้าง Sheet tab "${year}" พร้อม header สำเร็จ`);
}

// 2.7 บันทึกข้อมูลลง Google Sheets (tab แยกตามปี)
// คอลัมน์: A=วันที่สลิป B=เวลา C=ประเภท D=ยอด E=ผู้โอน F=ผู้รับ G=หมายเหตุ H=ลิงก์รูป I=recorded_at J=สาขา
async function appendToGoogleSheet(accessToken, spreadsheetId, slipData, imageUrl, branchName = '-', sheetYear = null) {
  console.log(`[LOG] 📊 กำลังบันทึกข้อมูลลง Google Sheet${sheetYear ? ' tab ' + sheetYear : ''}...`);
  const range = sheetYear ? encodeURIComponent(sheetYear + '!A1') : 'A1';
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:append?valueInputOption=USER_ENTERED`;
  const { isoDate } = getThaiDateTime();
  const values = [[
    slipData.date, slipData.time,
    slipData.type === 'income' ? 'รายรับ' : 'รายจ่าย',
    slipData.amount, slipData.sender || '-',
    slipData.receiver || '-', slipData.note || '-',
    imageUrl || 'ไม่มีรูปภาพ',
    isoDate,
    branchName
  ]];
  await axios.post(url, { values }, { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } });
  console.log(`[LOG] ✅ บันทึกลง Google Sheet สำเร็จ (สาขา: ${branchName})`);
}

// 2.8 อ่านข้อมูลจาก Google Sheets แล้ว filter ตามวันที่และสาขา
// branchFilter = null → รวมทุกสาขา, string → เฉพาะสาขานั้น
async function readSheetSummary(accessToken, spreadsheetId, filterFn, branchFilter = null, sheetYear = null) {
  const range = sheetYear ? encodeURIComponent(sheetYear + '!A:J') : 'A:J';
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`;
  const res = await axios.get(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const rows = (res.data.values || []).slice(1); // ข้าม header

  let totalIncome = 0, totalExpense = 0, countIncome = 0, countExpense = 0;
  for (const row of rows) {
    const recordedAt = row[8] || '';   // คอลัมน์ I
    const rowBranch  = row[9] || '';   // คอลัมน์ J
    if (!filterFn(recordedAt)) continue;
    if (branchFilter && rowBranch !== branchFilter) continue;
    const type = row[2] || '';
    const amount = parseFloat(row[3]) || 0;
    if (type === 'รายรับ') { totalIncome += amount; countIncome++; }
    if (type === 'รายจ่าย') { totalExpense += amount; countExpense++; }
  }
  return { totalIncome, totalExpense, countIncome, countExpense, net: totalIncome - totalExpense };
}

// 2.9 สร้าง Flex Message สรุปยอด
function createSummaryFlexMessage(title, summary, period) {
  const fmt = (n) => `฿${n.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`;
  const netColor = summary.net >= 0 ? '#10B981' : '#EF4444';
  const netText = summary.net >= 0 ? `+${fmt(summary.net)}` : fmt(summary.net);
  return {
    type: "flex",
    altText: `${title}: รายรับ ${fmt(summary.totalIncome)} | รายจ่าย ${fmt(summary.totalExpense)}`,
    contents: {
      type: "bubble", size: "kilo",
      header: {
        type: "box", layout: "vertical", backgroundColor: "#1e293b", paddingAll: "md",
        contents: [
          { type: "text", text: "📊 " + title, weight: "bold", color: "#ffffff", size: "sm" },
          { type: "text", text: period, color: "#94a3b8", size: "xs", margin: "xs" }
        ]
      },
      body: {
        type: "box", layout: "vertical", spacing: "md", paddingAll: "lg",
        contents: [
          {
            type: "box", layout: "horizontal", contents: [
              { type: "text", text: "💚 รายรับ", color: "#10B981", size: "sm", flex: 2, weight: "bold" },
              { type: "text", text: fmt(summary.totalIncome), color: "#10B981", size: "sm", align: "end", flex: 3, weight: "bold" }
            ]
          },
          { type: "text", text: `${summary.countIncome} รายการ`, color: "#94a3b8", size: "xs", align: "end" },
          {
            type: "box", layout: "horizontal", contents: [
              { type: "text", text: "🔴 รายจ่าย", color: "#EF4444", size: "sm", flex: 2, weight: "bold" },
              { type: "text", text: fmt(summary.totalExpense), color: "#EF4444", size: "sm", align: "end", flex: 3, weight: "bold" }
            ]
          },
          { type: "text", text: `${summary.countExpense} รายการ`, color: "#94a3b8", size: "xs", align: "end" },
          { type: "separator" },
          {
            type: "box", layout: "horizontal", contents: [
              { type: "text", text: "กำไร / ขาดทุน", color: "#1e293b", size: "md", flex: 2, weight: "bold" },
              { type: "text", text: netText, color: netColor, size: "md", align: "end", flex: 3, weight: "bold" }
            ]
          }
        ]
      }
    }
  };
}

// 2.7 สร้างการ์ด Flex Message (ละเอียด + quote รูปต้นทาง)
function createBeautifulFlexMessage(slipData, txId, shop, quoteToken) {
  const dashboardUrl = `${process.env.FRONTEND_URL}/dashboard?userId=${shop.owner_line_id}`;
  const isIncome = slipData.type === 'income';
  const amountText = `฿${parseFloat(slipData.amount).toLocaleString('th-TH', { minimumFractionDigits: 2 })}`;
  const txShortId = txId ? String(txId).split('-')[0].toUpperCase() : '-';
  const headerColor = isIncome ? '#10B981' : '#EF4444';
  const headerText = isIncome ? '💚 เงินเข้า — รายรับ' : '🔴 เงินออก — รายจ่าย';
  const amountColor = isIncome ? '#10B981' : '#EF4444';

  // แถวข้อมูล helper
  const row = (label, value, valueColor = '#1e293b') => ({
    type: "box", layout: "horizontal", contents: [
      { type: "text", text: label, color: "#94a3b8", size: "sm", flex: 2 },
      { type: "text", text: value || '-', color: valueColor, size: "sm", align: "end", flex: 3, wrap: true }
    ]
  });

  const bodyContents = [
    // ยอดเงิน (ใหญ่)
    {
      type: "box", layout: "horizontal", contents: [
        { type: "text", text: "ยอดเงิน", color: "#94a3b8", size: "sm", flex: 2 },
        { type: "text", text: amountText, weight: "bold", color: amountColor, size: "xl", align: "end", flex: 3 }
      ]
    },
    { type: "separator", margin: "sm" },
    row("ผู้โอน", slipData.sender),
    row("ผู้รับ", slipData.receiver || shop.shop_name),
    row("บัญชีร้านค้า", shop.shop_name),
    row("วันที่", slipData.date),
    row("เวลา", slipData.time),
  ];

  if (slipData.note && slipData.note !== '-') {
    bodyContents.push(row("หมายเหตุ", slipData.note));
  }

  // ข้อมูลภาษี (เฉพาะ expense ที่มีข้อมูล)
  if (!isIncome && slipData.tax_id && slipData.tax_id !== '-') {
    bodyContents.push({ type: "separator", margin: "sm" });
    bodyContents.push({ type: "text", text: "ข้อมูลภาษี", color: "#94a3b8", size: "xs", margin: "sm" });
    bodyContents.push(row("เลขผู้เสียภาษี", slipData.tax_id));
    if (slipData.taxpayer_name && slipData.taxpayer_name !== '-') {
      bodyContents.push(row("ชื่อผู้เสียภาษี", slipData.taxpayer_name));
    }
    if (slipData.tax_amount && slipData.tax_amount > 0) {
      bodyContents.push(row("ภาษีมูลค่าเพิ่ม", `฿${parseFloat(slipData.tax_amount).toLocaleString('th-TH', { minimumFractionDigits: 2 })}`));
    }
  }

  bodyContents.push({ type: "separator", margin: "sm" });
  bodyContents.push(row("เลขที่รายการ", `#${txShortId}`, "#94a3b8"));

  const flexMsg = {
    type: "flex",
    altText: `${isIncome ? '💚 เงินเข้า' : '🔴 เงินออก'} ${amountText} | ${slipData.sender || ''} → ${slipData.receiver || shop.shop_name}`,
    contents: {
      type: "bubble",
      size: "kilo",
      header: {
        type: "box", layout: "vertical",
        backgroundColor: headerColor,
        paddingAll: "md",
        contents: [
          { type: "text", text: headerText, weight: "bold", color: "#ffffff", size: "sm" }
        ]
      },
      body: {
        type: "box", layout: "vertical", spacing: "sm",
        paddingAll: "lg",
        contents: bodyContents
      },
      footer: {
        type: "box", layout: "vertical", spacing: "sm", contents: [
          { type: "button", style: "primary", color: "#4F46E5", height: "sm",
            action: { type: "uri", label: "📊 ดูประวัติบัญชี", uri: dashboardUrl } }
        ]
      }
    }
  };

  return flexMsg;
}

async function replyToLine(replyToken, messages) {
  await axios.post('https://api.line.me/v2/bot/message/reply', { replyToken, messages }, LINE_HEADER);
}

// Retry wrapper สำหรับ Gemini — กัน 503 overload ด้วย exponential backoff + fallback model
async function withRetry(fn, fallbackFn = null, retries = 3, delayMs = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      const status = err.response?.status;
      if (status === 503) {
        if (i < retries - 1) {
          console.log(`[LOG] ⏳ Gemini 503 — รอ ${delayMs * (i + 1)}ms แล้ว retry ครั้งที่ ${i + 2}...`);
          await new Promise(r => setTimeout(r, delayMs * (i + 1)));
          continue;
        }
        // หมด retry แล้วยัง 503 — สลับ fallback model
        if (fallbackFn) {
          console.log(`[LOG] 🔄 Gemini หมด retry — สลับไปใช้ fallback model...`);
          return await fallbackFn();
        }
      }
      throw err;
    }
  }
}

// ==========================================
// 3. AI CORE ENGINE (HYBRID OCR: Cloud Vision + Gemini 3.5 Flash)
// ==========================================

// 3.1 ด่านหลัก: Gemini OCR (รองรับ model override สำหรับ fallback)
async function extractDataWithGemini(imageBuffer, modelOverride = null) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    const modelVersion = modelOverride || process.env.GEMINI_MODEL || 'gemini-3.5-flash';
    console.log(`[LOG] 🧠 [Gemini AI] ใช้โมเดล: ${modelVersion}`);

    const url = `https://generativelanguage.googleapis.com/v1/models/${modelVersion}:generateContent?key=${apiKey}`;
    const prompt = `วิเคราะห์สลิปโอนเงินหรือบิลรายจ่ายนี้ แล้วตอบกลับเป็น JSON เท่านั้น ห้ามมีข้อความอื่น:
{"type":"income หรือ expense","amount":0.00,"date":"วว/ดด/ปปปป","time":"นน:นน","sender":"ชื่อผู้โอน/ลูกค้า","receiver":"ชื่อผู้รับ/ร้านค้า","note":"หมายเหตุ/รายการ","tax_id":"เลขผู้เสียภาษี หรือ -","taxpayer_name":"ชื่อผู้เสียภาษี หรือ -","tax_amount":0.00,"tax_address":"ที่อยู่ผู้เสียภาษี หรือ -"}
กฎ: type=income ถ้าสลิปโอนเงินระหว่างบุคคล, type=expense ถ้าเป็นบิลซื้อของ/ใบเสร็จ/ค่าบริการ, amount และ tax_amount เป็นตัวเลขทศนิยมเท่านั้น ถ้าไม่มีข้อมูลภาษีให้ใส่ - หรือ 0`;

    const base64Image = imageBuffer.toString('base64');
    const requestBody = {
      contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: "image/jpeg", data: base64Image } }] }]
    };

    const response = await axios.post(url, requestBody, { headers: { 'Content-Type': 'application/json' } });

    if (response.data?.candidates?.[0]?.content?.parts?.[0]?.text) {
      const rawText = response.data.candidates[0].content.parts[0].text;
      // ดึง JSON ออกจาก text (กันกรณี Gemini แนบ markdown code block มาด้วย)
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("Gemini ไม่ส่ง JSON กลับมา");
      console.log(`[LOG] ✨ [Gemini AI] ประมวลผลสำเร็จ`);
      return JSON.parse(jsonMatch[0]);
    } else {
      throw new Error("โครงสร้างการตอบกลับจาก Gemini API ไม่ถูกต้อง");
    }
  } catch (error) {
    const detail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
    console.error("[ERROR] ❌ Gemini API Error:", error.message, "| Detail:", detail);
    throw error;
  }
}

// 3.2 ด่านหน้า: Hybrid Engine (Google Cloud Vision → Gemini fallback)
async function extractDataHybrid(imageBuffer) {
  console.log(`[LOG] ⚡ [Hybrid OCR] เริ่มกระบวนการสแกนผ่านด่านหน้า (Google Cloud Vision API)`);
  try {
    const visionApiKey = process.env.GOOGLE_VISION_API_KEY;
    const base64Image = imageBuffer.toString('base64');
    const visionUrl = `https://vision.googleapis.com/v1/images:annotate?key=${visionApiKey}`;
    const visionReq = {
      requests: [{ image: { content: base64Image }, features: [{ type: "TEXT_DETECTION" }] }]
    };

    const visionRes = await axios.post(visionUrl, visionReq);
    const textAnnotations = visionRes.data.responses[0].textAnnotations;

    if (!textAnnotations || textAnnotations.length === 0 || textAnnotations[0].description.length < 20) {
      console.log(`[LOG] ⚠️ [Hybrid OCR] ข้อมูลน้อยเกินไปหรืออาจเป็นลายมือ สลับไปใช้ Gemini...`);
      return await extractDataWithGemini(imageBuffer);
    }

    const rawText = textAnnotations[0].description;
    const amountMatch = rawText.match(/(?:จำนวนเงิน|Amount|จำนวน)\s*[:=]?\s*([\d,]+\.\d{2})/i);
    const dateMatch = rawText.match(/(\d{1,2}\s*[ก-๙]+\s*\d{2,4}|\d{2}\/\d{2}\/\d{2,4})/);

    if (amountMatch && dateMatch) {
      console.log(`[LOG] 🚀 [Hybrid OCR] Cloud Vision สแกนสำเร็จ ทำงานรวดเร็วโดยไม่ต้องพึ่ง Gemini`);
      return {
        type: "income",
        amount: parseFloat(amountMatch[1].replace(/,/g, '')),
        date: dateMatch[1],
        time: "00:00",
        sender: "ไม่ระบุ (สแกนด่วน)",
        receiver: "ร้านค้า",
        note: "สแกนด้วยโหมดความเร็วสูง"
      };
    } else {
      console.log(`[LOG] ⚠️ [Hybrid OCR] Cloud Vision สกัดยอดเงิน/วันที่ไม่ครบถ้วน สลับไปใช้ Gemini...`);
      return await extractDataWithGemini(imageBuffer);
    }
  } catch (error) {
    console.error(`[ERROR] ❌ Cloud Vision ขัดข้อง: ${error.message}. สลับการทำงานไปใช้ Gemini ทันที...`);
    return await extractDataWithGemini(imageBuffer);
  }
}

// ==========================================
// 4. MAIN WEBHOOK ENDPOINT (LINE RECEIVER)
// ==========================================
app.post('/webhook', async (req, res) => {
  // LINE Signature Verification — reject request ที่ไม่ได้มาจาก LINE จริง
  const signature = req.headers['x-line-signature'];
  if (!verifyLineSignature(req.rawBody, signature)) {
    console.warn('[SECURITY] ❌ Invalid x-line-signature — request rejected');
    return res.status(401).send('Unauthorized');
  }

  // ตอบ LINE ทันทีก่อนประมวลผล กัน timeout → retry → ตัดเครดิตซ้ำ
  res.status(200).send('OK');

  const events = req.body.events;
  if (!events || events.length === 0) return;

  for (const event of events) {
    const replyToken = event.replyToken;

    // [FIX 2] Duplicate Guard: กัน LINE retry ยิง event เดิมซ้ำภายใน 5 นาที
    const eventId = event.webhookEventId;
    if (eventId && isDuplicateEvent(eventId)) {
      console.log(`[LOG] ⏭️ ข้าม event ซ้ำ: ${eventId}`);
      continue;
    }

    // ==================== TEXT COMMAND HANDLER ====================
    if (event.type === 'message' && event.message.type === 'text') {
      const text = (event.message.text || '').trim();
      const sourceId = event.source.groupId || event.source.userId;

      // ดึงข้อมูลร้านก่อนทุก command (รองรับทั้งกลุ่มหลัก สาขา และ DM เจ้าของ)
      const foundCmd = await findShopBySource(sourceId);
      if (!foundCmd) { continue; }
      const { shop } = foundCmd;

      const isSummaryCmd = ['#สรุปวันนี้','#สรุปวัน','#สรุปเดือนนี้','#สรุปเดือน','#กำไรขาดทุน','#กำไร','#สรุปทุกสาขา','#สรุปอาทิตย์นี้','#สรุปสัปดาห์','#สรุปปีนี้','#สรุปปี','#สรุปวันที่','#ดูวันที่','#รายงาน','#ช่วยเหลือ','#help'].some(k => text.startsWith(k));
      if (!isSummaryCmd) continue; // ไม่ใช่ command ของเรา ข้ามไป

      try {
        // คำสั่ง #ช่วยเหลือ — ทุกแผน
        if (text.startsWith('#ช่วยเหลือ') || text.startsWith('#help')) {
          const tier = getTier(shop);
          const helpText = `📋 คำสั่งที่ใช้ได้ (${tier.toUpperCase()})\n\n` +
            `📸 ส่งรูปสลิป → บันทึกอัตโนมัติ\n\n` +
            (hasFeature(shop, 'pro') ?
              `📊 #สรุปวันนี้\n📅 #สรุปเดือนนี้\n📆 #สรุปอาทิตย์นี้\n🗓 #สรุปปีนี้\n📌 #สรุปวันที่ 07/06\n💰 #กำไรขาดทุน\n📋 #รายงาน\n` +
              (hasFeature(shop, 'advance') ? `🏢 #สรุปทุกสาขา\n` : '') :
              `🔒 อัปเกรดเป็น Shop Pro เพื่อใช้คำสั่งสรุปยอด\n`);
          await replyToLine(replyToken, [{ type: "text", text: helpText }]);
          continue;
        }

        // คำสั่งสรุป — ต้องใช้ Pro ขึ้นไป
        if (!hasFeature(shop, 'pro')) {
          await replyToLine(replyToken, [{
            type: "text",
            text: `🔒 ฟีเจอร์นี้สำหรับแพ็กเกจ Shop Pro ขึ้นไปค่ะ\n\nอัปเกรดได้ที่:\n${process.env.FRONTEND_URL}/pricing?userId=${shop.owner_line_id}`
          }]);
          continue;
        }

        // ดึง Google config
        const { data: gConfig } = await supabase
          .from('shop_google_configs')
          .select('google_refresh_token, google_sheet_id')
          .eq('shop_id', shop.id)
          .maybeSingle();

        const cmdSheetId = gConfig?.google_sheet_id || shop.google_sheet_id;
        if (!gConfig?.google_refresh_token || !cmdSheetId) {
          await replyToLine(replyToken, [{ type: "text", text: "⚠️ ยังไม่ได้เชื่อมต่อ Google Sheets ค่ะ กรุณาตั้งค่าที่ Dashboard ก่อนนะคะ" }]);
          continue;
        }

        const accessToken = await getAccessToken(gConfig.google_refresh_token);
        const { isoDate, year, month } = getThaiDateTime();

        let summaryMsg;

        if (text.startsWith('#สรุปวันนี้') || text.startsWith('#สรุปวัน')) {
          const summary = await readSheetSummary(accessToken, cmdSheetId,
            (d) => d === isoDate, null, year);
          summaryMsg = createSummaryFlexMessage('สรุปยอดวันนี้', summary, isoDate);

        } else if (text.startsWith('#สรุปเดือนนี้') || text.startsWith('#สรุปเดือน')) {
          const prefix = `${year}-${month}`;
          const summary = await readSheetSummary(accessToken, cmdSheetId,
            (d) => d.startsWith(prefix), null, year);
          summaryMsg = createSummaryFlexMessage('สรุปยอดเดือนนี้', summary, `${month}/${year}`);

        } else if (text.startsWith('#กำไรขาดทุน') || text.startsWith('#กำไร')) {
          const prefix = `${year}-${month}`;
          const summary = await readSheetSummary(accessToken, cmdSheetId,
            (d) => d.startsWith(prefix), null, year);
          summaryMsg = createSummaryFlexMessage('กำไร / ขาดทุน เดือนนี้', summary, `${month}/${year}`);

        } else if (text.startsWith('#สรุปอาทิตย์นี้') || text.startsWith('#สรุปสัปดาห์')) {
          const now = new Date(new Date().getTime() + 7 * 60 * 60 * 1000);
          const dow = now.getDay() === 0 ? 6 : now.getDay() - 1; // จันทร์=0
          const toISO = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
          const weekStart = toISO(new Date(now.getTime() - dow * 86400000));
          const weekEnd = toISO(new Date(now.getTime() + (6 - dow) * 86400000));
          const summary = await readSheetSummary(accessToken, cmdSheetId,
            (d) => d >= weekStart && d <= weekEnd, null, year);
          summaryMsg = createSummaryFlexMessage('สรุปยอดอาทิตย์นี้', summary, `${weekStart} ถึง ${weekEnd}`);

        } else if (text.startsWith('#สรุปปีนี้') || text.startsWith('#สรุปปี')) {
          const summary = await readSheetSummary(accessToken, cmdSheetId,
            () => true, null, year);
          summaryMsg = createSummaryFlexMessage(`สรุปยอดปี ${year}`, summary, year);

        } else if (text.startsWith('#สรุปวันที่') || text.startsWith('#ดูวันที่')) {
          const dateArg = text.replace(/^#สรุปวันที่|^#ดูวันที่/, '').trim();
          const parts = dateArg.split('/');
          if (parts.length >= 2) {
            const dd = parts[0].trim().padStart(2, '0');
            const mm = parts[1].trim().padStart(2, '0');
            let yyyy = parts[2] ? parseInt(parts[2].trim()) : parseInt(year);
            if (yyyy > 2500) yyyy -= 543;
            const targetDate = `${yyyy}-${mm}-${dd}`;
            const summary = await readSheetSummary(accessToken, cmdSheetId,
              (d) => d === targetDate, null, String(yyyy));
            summaryMsg = createSummaryFlexMessage(`สรุปยอด ${dd}/${mm}/${yyyy}`, summary, targetDate);
          } else {
            summaryMsg = { type: 'text', text: '⚠️ รูปแบบวันที่ไม่ถูกต้อง\nใช้: #สรุปวันที่ 07/06 หรือ 07/06/2026' };
          }

        } else if (text.startsWith('#รายงาน')) {
          const prefix = `${year}-${month}`;
          const summary = await readSheetSummary(accessToken, cmdSheetId,
            (d) => d.startsWith(prefix), null, year);
          summaryMsg = createSummaryFlexMessage(`รายงานผล ${month}/${year}`, summary, `${month}/${year}`);

        } else if (text.startsWith('#สรุปทุกสาขา')) {
          if (!hasFeature(shop, 'advance')) {
            await replyToLine(replyToken, [{ type: "text", text: `🔒 ฟีเจอร์นี้สำหรับแพ็กเกจ Advance ขึ้นไปค่ะ` }]);
            continue;
          }
          const prefix = `${year}-${month}`;
          const summary = await readSheetSummary(accessToken, cmdSheetId,
            (d) => d.startsWith(prefix), null, year);
          summaryMsg = createSummaryFlexMessage('สรุปทุกสาขา เดือนนี้', summary, `${month}/${year}`);
        }

        if (summaryMsg) await replyToLine(replyToken, [summaryMsg]);

      } catch (err) {
        console.error('[ERROR] Text command error:', err.message);
        try { await replyToLine(replyToken, [{ type: "text", text: `❌ เกิดข้อผิดพลาด: ${err.message}` }]); } catch(e) {}
      }
      continue;
    }
    // ===============================================================

    if (event.type === 'join') {
      const groupId = event.source.groupId;
      console.log(`[LOG] 🤖 บอทถูกเชิญเข้ากลุ่ม ID: ${groupId}`);
      const joinMsg = { type: "text", text: `สวัสดีค่ะ! ขอบคุณที่ดึง Smile Slip เข้ากลุ่มนะคะ\nโปรดคัดลอกรหัสกลุ่มนี้:\n${groupId}\n\nไปผูกในหน้า Dashboard ของร้านค้าเพื่อเริ่มใช้งานสแกนสลิปค่ะ 😊` };
      await replyToLine(replyToken, [joinMsg]);
      continue;
    }

    if (event.type === 'message' && event.message.type === 'image') {
      try {
        const sourceId = event.source.groupId || event.source.userId;
        console.log(`\n===================================================================`);
        console.log(`[LOG] 📥 ได้รับรูปภาพใหม่จากพิกัด ID: ${sourceId}`);

        // STEP 1: ค้นหาร้านค้า (รองรับทั้งกลุ่มหลักและสาขา)
        const found = await findShopBySource(sourceId);
        if (!found) {
          await replyToLine(replyToken, [{ type: "text", text: "⚠️ กลุ่มนี้ยังไม่ได้ลงทะเบียนผูกกับระบบ Smile Slip ค่ะ" }]);
          continue;
        }
        const { shop, branchName } = found;

        // STEP 2: ตรวจสอบเครดิตคงเหลือ
        const { data: creditData } = await supabase
          .from('shop_credits')
          .select('balance_credits')
          .eq('shop_id', shop.id)
          .single();

        if (!creditData || creditData.balance_credits <= 0) {
          await replyToLine(replyToken, [{ type: "text", text: `⚠️ เครดิตของร้าน ${shop.shop_name} หมดแล้ว กรุณาเติมเครดิตนะคะ` }]);
          continue;
        }

        // STEP 3: ประมวลผลรูปภาพด้วย Gemini (retry อัตโนมัติสูงสุด 3 ครั้งเมื่อ 503)
        const imageBuffer = await getLineImage(event.message.id);
        const quoteToken = event.message.quoteToken || null;
        const slipData = await withRetry(
          () => extractDataWithGemini(imageBuffer),
          () => extractDataWithGemini(imageBuffer, 'gemini-2.5-flash')
        );

        // STEP 4: Google Drive/Sheets — แยก try-catch ออกต่างหาก
        // อ่าน refresh_token จาก shop_google_configs (ตารางที่มีอยู่จริง)
        let driveFileUrl = null;
        try {
          const { data: gConfig } = await supabase
            .from('shop_google_configs')
            .select('google_refresh_token, google_folder_id, google_sheet_id')
            .eq('shop_id', shop.id)
            .maybeSingle();

          const folderId = gConfig?.google_folder_id || shop.google_folder_id;
          const sheetId = gConfig?.google_sheet_id || shop.google_sheet_id;

          if (gConfig?.google_refresh_token && folderId && sheetId) {
            const accessToken = await getAccessToken(gConfig.google_refresh_token);
            const thaiTime = getThaiDateTime();

            // ใช้วันที่บนสลิปจริงเพื่อเลือก folder/sheet ที่ถูกต้อง
            const slipDateInfo = parseSlipDateForFolder(slipData.date);
            const folderYear = slipDateInfo?.year || thaiTime.year;
            const folderMonth = slipDateInfo?.monthFolderName || thaiTime.monthFolderName;

            // โครงสร้าง Drive: root → ปี ค.ศ. → เดือน-ปี
            const yearFolderId = await getOrCreateDriveFolder(accessToken, folderId, folderYear);
            const monthFolderId = await getOrCreateDriveFolder(accessToken, yearFolderId, folderMonth);

            const fileName = `slip_${slipData.amount}THB_${folderMonth}_${Date.now()}.jpg`;
            const driveFileId = await uploadToGoogleDrive(imageBuffer, accessToken, monthFolderId, fileName);
            driveFileUrl = `https://drive.google.com/open?id=${driveFileId}`;

            // Sheet tab แยกตามปีของสลิป
            await getOrCreateYearSheet(accessToken, sheetId, folderYear);
            await appendToGoogleSheet(accessToken, sheetId, slipData, driveFileUrl, branchName, folderYear);
          }
        } catch (googleErr) {
          console.error('[WARN] ⚠️ Google Drive/Sheets ขัดข้อง (ข้าม แต่บันทึก Supabase ต่อ):', googleErr.message);
          // แจ้งเจ้าของร้านทาง LINE ถ้า token หมดอายุ
          if (googleErr.isTokenInvalid && shop.owner_line_id) {
            const reconnectUrl = `${process.env.FRONTEND_URL}/dashboard?userId=${shop.owner_line_id}&reconnectGoogle=true`;
            await pushToOwner(shop.owner_line_id, [{
              type: 'flex',
              altText: '⚠️ Google Drive ขาดการเชื่อมต่อ — กรุณาเชื่อมต่อใหม่',
              contents: {
                type: 'bubble',
                body: {
                  type: 'box', layout: 'vertical', spacing: 'md',
                  contents: [
                    { type: 'text', text: '⚠️ Google Drive ขาดการเชื่อมต่อ', weight: 'bold', color: '#e53e3e', size: 'md' },
                    { type: 'text', text: 'สลิปล่าสุดไม่ถูกบันทึกลง Google Sheets เนื่องจาก token หมดอายุ กรุณาเชื่อมต่อ Google ใหม่', wrap: true, color: '#555555', size: 'sm' }
                  ]
                },
                footer: {
                  type: 'box', layout: 'vertical',
                  contents: [{ type: 'button', style: 'primary', color: '#4285F4', action: { type: 'uri', label: '🔗 เชื่อมต่อ Google ใหม่', uri: reconnectUrl } }]
                }
              }
            }]);
          }
        }

        // STEP 5: ตัดยอดเครดิต (-1) — Super plan ได้รับการยกเว้น
        if (isSuper(shop)) {
          console.log(`[LOG] 👑 Super Plan — ไม่ตัดเครดิต`);
        } else {
          const newBalance = creditData.balance_credits - 1;
          await supabase.from('shop_credits').update({ balance_credits: newBalance }).eq('shop_id', shop.id);
          console.log(`[LOG] 💳 ตัดเครดิตสำเร็จ ยอดคงเหลือ: ${newBalance}`);
        }

        // STEP 6: Push แจ้งเจ้าของร้านส่วนตัว (Pro+ และเป็นสาขา ไม่ใช่กลุ่มหลัก)
        if (hasFeature(shop, 'pro') && !found.isOwnerChat && shop.owner_line_id) {
          const isIncome = slipData.type === 'income';
          const amountFmt = `฿${parseFloat(slipData.amount).toLocaleString('th-TH', { minimumFractionDigits: 2 })}`;
          const ownerNotify = {
            type: "text",
            text: `${isIncome ? '💚' : '🔴'} [${branchName}]\n${isIncome ? 'รายรับ' : 'รายจ่าย'} ${amountFmt}\nจาก: ${slipData.sender || 'ไม่ระบุ'}\n${slipData.date} ${slipData.time}`
          };
          await pushToOwner(shop.owner_line_id, [ownerNotify]);
        }

        // STEP 7: ตอบกลับ Flex Message ในกลุ่ม
        try {
          const flexMsg = createBeautifulFlexMessage(slipData, null, shop, quoteToken);
          await replyToLine(replyToken, [flexMsg]);
        } catch (replyErr) {
          const lineErrDetail = replyErr.response?.data ? JSON.stringify(replyErr.response.data) : replyErr.message;
          console.error('[WARN] ⚠️ ธุรกรรมสำเร็จแต่ตอบกลับ LINE ไม่ได้:', lineErrDetail);
        }

        console.log(`=================== 🎉 สิ้นสุดการประมวลผล ===================\n`);

      } catch (error) {
        console.error('[ERROR] ❌ ระบบทำงานล้มเหลว:', error.message);
        try { await replyToLine(replyToken, [{ type: "text", text: `❌ ไม่สามารถตรวจสอบสลิปได้: ${error.message}` }]); } catch(e) {}
      }
    }
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`[SYSTEM] 🚀 Smile Slip Webhook Server รันอยู่ที่พอร์ต ${PORT}`);
});
