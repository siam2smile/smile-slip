const express = require('express');
const axios = require('axios');
const FormData = require('form-data');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

// ==========================================
// 1. SYSTEM CONFIGURATION & DATABASE
// ==========================================
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const LINE_HEADER = {
  headers: { Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` }
};

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://smileslip-dashboard-832247688217.asia-southeast1.run.app';

// Duplicate event guard: LINE จะ retry webhook ถ้า server ตอบช้า
// เก็บ eventId ที่ประมวลผลแล้วไว้ใน memory 5 นาที กันตัดเครดิตซ้ำ
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

// 2.1 ปรับเวลาเป็นประเทศไทย (UTC+7)
const getThaiDateTime = () => {
  const bangkokTime = new Date(new Date().getTime() + (7 * 60 * 60 * 1000));
  return {
    date: bangkokTime.toLocaleDateString('th-TH'),
    time: bangkokTime.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false }),
    raw: bangkokTime
  };
};

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
    throw new Error("ไม่สามารถเชื่อมต่อบัญชี Google ของร้านค้าได้");
  }
}

// 2.3 ดาวน์โหลดรูปสลิปจาก LINE Server
async function getLineImage(messageId) {
  console.log(`[LOG] 📥 กำลังดาวน์โหลดรูปภาพจาก LINE (ID: ${messageId})...`);
  const url = `https://api-data.line.me/v2/bot/message/${messageId}/content`;
  const response = await axios.get(url, { ...LINE_HEADER, responseType: 'arraybuffer' });
  return Buffer.from(response.data);
}

// 2.4 สร้างโฟลเดอร์ Google Drive แบบแยกตาม เดือน/ปี
async function getOrCreateDriveFolder(accessToken, parentFolderId, folderName) {
  const query = `name='${folderName}' and '${parentFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)`;
  
  const searchRes = await axios.get(searchUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
  
  if (searchRes.data.files && searchRes.data.files.length > 0) {
    return searchRes.data.files[0].id; // เจอโฟลเดอร์เดิม
  }

  // สร้างโฟลเดอร์ใหม่
  const createUrl = 'https://www.googleapis.com/drive/v3/files';
  const createRes = await axios.post(createUrl, {
    name: folderName,
    mimeType: 'application/vnd.google-apps.folder',
    parents: [parentFolderId]
  }, { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } });
  
  return createRes.data.id;
}

/// 2.5 อัปโหลดรูปลง Google Drive (QC FIXED: แก้บั๊ก 400 Bad Request)
async function uploadToGoogleDrive(imageBuffer, accessToken, folderId, fileName) {
  console.log(`[LOG] ☁️ กำลังอัปโหลดรูปลง Google Drive...`);
  const form = new FormData();
  
  // 1. ยกเลิกการใช้ Blob และเปลี่ยนมาใช้ JSON.stringify มาตรฐานสำหรับ Node.js
  form.append('metadata', JSON.stringify({
    name: fileName,
    parents: [folderId]
  }), { contentType: 'application/json' });
  
  // 2. แนบ Buffer รูปภาพพร้อมระบุนามสกุลไฟล์ให้ชัดเจน
  form.append('file', imageBuffer, { filename: fileName, contentType: 'image/jpeg' });

  // 3. [สำคัญสุด] ต้องใส่ ...form.getHeaders() เพื่อบอก Google ว่านี่คือไฟล์อัปโหลด
  const res = await axios.post('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', form, {
    headers: { 
      ...form.getHeaders(), 
      Authorization: `Bearer ${accessToken}` 
    }
  });
  
  console.log(`[LOG] ✅ อัปโหลดรูปสำเร็จ (Drive ID: ${res.data.id})`);
  return res.data.id;
}

// 2.6 บันทึกข้อมูลลง Google Sheets
async function appendToGoogleSheet(accessToken, spreadsheetId, slipData, imageUrl) {
  console.log(`[LOG] 📊 กำลังบันทึกข้อมูลลง Google Sheet...`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/A1:append?valueInputOption=USER_ENTERED`;
  
  const values = [
    [
      slipData.date,
      slipData.time,
      slipData.type === 'income' ? 'รายรับ' : 'รายจ่าย',
      slipData.amount,
      slipData.sender || '-',
      slipData.receiver || '-',
      slipData.note || '-',
      imageUrl || 'ไม่มีรูปภาพ'
    ]
  ];

  await axios.post(url, { values }, { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } });
  console.log(`[LOG] ✅ บันทึกลง Google Sheet สำเร็จ`);
}

// 2.7 สร้างการ์ด Flex Message (UI ตอบกลับใน LINE)
function createBeautifulFlexMessage(slipData, txId, userId) {
  const dashboardUrl = `${FRONTEND_URL}/dashboard?userId=${encodeURIComponent(userId || '')}`;
  // กันยอดเงินเพี้ยน: ถ้า amount แปลงเป็นตัวเลขไม่ได้ ให้โชว์ค่าดิบแทน "NaN"
  const amountNum = parseFloat(String(slipData.amount).replace(/[^\d.]/g, ''));
  const amountText = Number.isFinite(amountNum)
    ? `฿${amountNum.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`
    : `฿${slipData.amount ?? '-'}`;
  return {
    type: "flex",
    altText: `สแกนสลิปสำเร็จ ยอด ฿${slipData.amount}`,
    contents: {
      type: "bubble",
      header: {
        type: "box", layout: "vertical", contents: [
          { type: "text", text: "✅ ตรวจสอบสลิปเรียบร้อย", weight: "bold", color: "#10B981", size: "sm" }
        ]
      },
      body: {
        type: "box", layout: "vertical", spacing: "md", contents: [
          {
            type: "box", layout: "horizontal", contents: [
              { type: "text", text: "ยอดเงิน", color: "#aaaaaa", size: "sm", flex: 1 },
              { type: "text", text: amountText, weight: "bold", color: "#3b82f6", size: "md", align: "end", flex: 2 }
            ]
          },
          {
            type: "box", layout: "horizontal", contents: [
              { type: "text", text: "ผู้โอน", color: "#aaaaaa", size: "sm", flex: 1 },
              { type: "text", text: slipData.sender || "ไม่ระบุ", color: "#333333", size: "sm", align: "end", flex: 2 }
            ]
          },
          {
            type: "box", layout: "horizontal", contents: [
              { type: "text", text: "วัน-เวลา", color: "#aaaaaa", size: "sm", flex: 1 },
              { type: "text", text: `${slipData.date} ${slipData.time}`, color: "#333333", size: "sm", align: "end", flex: 2 }
            ]
          }
        ]
      },
      footer: {
        type: "box", layout: "vertical", spacing: "sm", contents: [
          { type: "button", style: "primary", color: "#4F46E5", height: "sm", action: { type: "uri", label: "ดูประวัติบัญชี", uri: dashboardUrl } }
        ]
      }
    }
  };
}

async function replyToLine(replyToken, messages) {
  await axios.post('https://api.line.me/v2/bot/message/reply', { replyToken, messages }, LINE_HEADER);
}

// ==========================================
// 3. AI CORE ENGINE (Gemini OCR)
// ==========================================

async function extractDataWithGemini(imageBuffer) {
  const modelVersion = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
  console.log(`[LOG] 🧠 [Gemini] กำลังวิเคราะห์สลิปด้วย ${modelVersion}...`);

  const prompt = `คุณเป็น AI ผู้เชี่ยวชาญอ่านสลิปโอนเงินและใบเสร็จไทย
วิเคราะห์รูปนี้แล้วตอบเป็น JSON เท่านั้น ห้ามมีข้อความอื่นนอกจาก JSON:
{
  "type": "income หรือ expense เท่านั้น",
  "amount": ตัวเลขทศนิยม 2 ตำแหน่ง เช่น 1500.00,
  "date": "วว/ดด/ปปปป เช่น 31/05/2569",
  "time": "นน:นน เช่น 14:30",
  "sender": "ชื่อผู้โอน/ชื่อบัญชีต้นทาง",
  "receiver": "ชื่อผู้รับ/ชื่อบัญชีปลายทาง",
  "note": "หมายเหตุหรือรายการ ถ้าไม่มีให้ใส่ -"
}
กฎ:
- type = income ถ้าเป็นสลิปโอนเงินระหว่างบุคคล
- type = expense ถ้าเป็นใบเสร็จซื้อของ/จ่ายบิล/บิลค่าบริการ
- amount ต้องเป็นตัวเลขเท่านั้น ไม่มีเครื่องหมาย ฿ หรือ THB หรือ ลูกน้ำ
- ถ้าอ่านข้อมูลใดไม่ได้ให้ใส่ "-"`;

  const base64Image = imageBuffer.toString('base64');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelVersion}:generateContent?key=${process.env.GEMINI_API_KEY}`;

  const response = await axios.post(url, {
    contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: "image/jpeg", data: base64Image } }] }],
    generationConfig: { responseMimeType: "application/json" }
  }, { headers: { 'Content-Type': 'application/json' } });

  if (!response.data?.candidates?.[0]?.content) {
    throw new Error("Gemini ไม่ส่งผลลัพธ์กลับมา");
  }

  const parsed = JSON.parse(response.data.candidates[0].content.parts[0].text);
  console.log(`[LOG] ✨ [Gemini] วิเคราะห์สำเร็จ: ${parsed.type} ฿${parsed.amount}`);
  return parsed;
}

// ตรวจสอบและแก้ไขข้อมูลจาก Gemini ก่อนใช้งานจริง
function validateSlipData(data) {
  const amount = parseFloat(String(data.amount).replace(/[^\d.]/g, ''));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`อ่านยอดเงินจากสลิปไม่ได้ (ค่าที่ได้: "${data.amount}") กรุณาลองส่งรูปใหม่`);
  }
  return {
    ...data,
    amount,
    type: ['income', 'expense'].includes(data.type) ? data.type : 'income',
    date: data.date && data.date !== '-' ? data.date : getThaiDateTime().date,
    time: data.time && data.time !== '-' ? data.time : getThaiDateTime().time,
    sender: data.sender || '-',
    receiver: data.receiver || '-',
    note: data.note || '-',
  };
}

// ==========================================
// 4. MAIN WEBHOOK ENDPOINT (LINE RECEIVER)
// ==========================================
app.post('/webhook', async (req, res) => {
  // ตอบ LINE ทันทีก่อนประมวลผล กันกรณี timeout ทำให้ LINE retry แล้วตัดเครดิตซ้ำ
  res.status(200).send('OK');

  const events = req.body.events;
  if (!events || events.length === 0) return;

  for (const event of events) {
    const replyToken = event.replyToken;

    // กัน event ซ้ำจาก LINE retry
    const eventId = event.webhookEventId;
    if (eventId && isDuplicateEvent(eventId)) {
      console.log(`[LOG] ⏭️ ข้าม event ซ้ำ: ${eventId}`);
      continue;
    }

    // ถ้าผู้ใช้อัญเชิญบอทเข้ากลุ่ม
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
        const senderUserId = event.source.userId; 
        console.log(`\n===================================================================`);
        console.log(`[LOG] 📥 ได้รับรูปภาพใหม่จากพิกัด ID: ${sourceId}`);

        // STEP 1: ค้นหาร้านค้าและเช็คแพ็กเกจ (รองรับ Multi-Shop/Group)
        const { data: shop, error: shopErr } = await supabase
          .from('shop_profiles')
          .select('*')
          .or(`line_group_id.eq.${sourceId},owner_line_id.eq.${sourceId}`)
          .maybeSingle();

        if (!shop) {
          await replyToLine(replyToken, [{ type: "text", text: "⚠️ กลุ่มนี้ยังไม่ได้ลงทะเบียนผูกกับระบบ Smile Slip ค่ะ" }]);
          continue;
        }

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

        // STEP 3: ประมวลผลรูปภาพด้วย Gemini + ตรวจสอบความถูกต้อง
        const imageBuffer = await getLineImage(event.message.id);
        const rawSlipData = await extractDataWithGemini(imageBuffer);
        const slipData = validateSlipData(rawSlipData);

        // STEP 4: อัปโหลดรูปลง Google Drive และลง Sheet (ถ้าลูกค้าตั้งค่าไว้)
        let driveFileUrl = null;
        try {
          const { data: gToken } = await supabase.from('google_tokens').select('refresh_token').eq('shop_id', shop.id).maybeSingle();
          if (gToken?.refresh_token && shop.google_folder_id && shop.google_sheet_id) {
            const accessToken = await getAccessToken(gToken.refresh_token);
            const thaiTime = getThaiDateTime();
            const monthYearFolderName = `${thaiTime.date.split('/')[1]}-${thaiTime.date.split('/')[2]}`;
            const currentMonthFolderId = await getOrCreateDriveFolder(accessToken, shop.google_folder_id, monthYearFolderName);
            const fileName = `_${slipData.amount}THB_${thaiTime.date.replace(/\//g, '')}_${Date.now()}.jpg`;
            const driveFileId = await uploadToGoogleDrive(imageBuffer, accessToken, currentMonthFolderId, fileName);
            driveFileUrl = `https://drive.google.com/open?id=${driveFileId}`;
            await appendToGoogleSheet(accessToken, shop.google_sheet_id, slipData, driveFileUrl);
          }
        } catch (googleErr) {
          // Google token หมดอายุหรือ Drive/Sheets ขัดข้อง — ข้ามไป บันทึก Supabase ตามปกติ
          console.error('[WARN] ⚠️ Google Drive/Sheets ขัดข้อง (ข้าม):', googleErr.message);
        }

        // STEP 5: บันทึกข้อมูลธุรกรรมลง Supabase (จับคู่คอลัมน์ให้ตรงเป๊ะ)
        const { data: tx, error: txErr } = await supabase
          .from('ledger_transactions')
          .insert({
            shop_id: shop.id,
            type: slipData.type || 'income',        // เก็บประเภท (เช่น income/expense)
            amount: slipData.amount,                // เก็บนอดเงิน
            category: 'Sales',                      // หมวดหมู่ (ตั้งเป็นค่าเริ่มต้น หรือดึงจาก AI)
            note: slipData.note || slipData.sender, // เก็บโน้ตหรือชื่อคนโอน
            slip_url: driveFileUrl                  // 🎯 แมตช์กับคอลัมน์ slip_url ของคุณพอดี!
          })
          .select('id')
          .single();

        if (txErr) throw txErr;

        // STEP 6: ตัดยอดเครดิต (-1)
        const newBalance = creditData.balance_credits - 1;
        await supabase.from('shop_credits').update({ balance_credits: newBalance }).eq('shop_id', shop.id);
        console.log(`[LOG] 💳 ตัดเครดิตสำเร็จ ยอดคงเหลือ: ${newBalance}`);

        // STEP 7: ตอบกลับด้วย Flex Message
        // ห่อด้วย try/catch แยก: ถึงตรงนี้ธุรกรรมสำเร็จและตัดเครดิตแล้ว
        // ถ้าการตอบกลับ LINE พลาด ต้องไม่ทำให้หล่นไป catch ใหญ่จนแจ้ง error ผิดๆ ให้ลูกค้า
        try {
          const flexMsg = createBeautifulFlexMessage(slipData, tx.id, shop.owner_line_id);
          await replyToLine(replyToken, [flexMsg]);
        } catch (replyErr) {
          console.error('[WARN] ⚠️ ธุรกรรมสำเร็จแล้วแต่ตอบกลับ LINE ไม่สำเร็จ:', replyErr.response?.data || replyErr.message);
        }

        console.log(`=================== 🎉 สิ้นสุดการประมวลผล ===================\n`);

      } catch (error) {
        // log รายละเอียดเต็ม (response body) เพื่อให้ไล่บั๊ก 400/4xx จาก API ภายนอกได้
        const detail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
        console.error('[ERROR] ❌ ระบบทำงานล้มเหลว:', error.message);
        console.error('[LOG FATAL DETAIL]:', detail);
        try { await replyToLine(replyToken, [{ type: "text", text: `❌ ไม่สามารถตรวจสอบสลิปได้: ${error.message}` }]); } catch(e) {}
      }
    }
  }
  res.status(200).send('OK');
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`[SYSTEM] 🚀 Smile Slip Webhook Server รันอยู่ที่พอร์ต ${PORT}`);
});