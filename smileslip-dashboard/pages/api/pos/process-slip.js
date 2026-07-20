/**
 * POST /api/pos/process-slip
 * Body: { shopId, imageBase64, mimeType }
 * อัปโหลดสลิปไปยัง Google Drive + อ่าน OCR ด้วย Gemini
 * คืน: { ok, url, amount, sender, refNo }
 */
import { createClient } from '@supabase/supabase-js';
import { getAccessToken } from '../../../lib/google-pos';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';

// ขนาด body สูงสุด 10 MB (รูปสลิป)
export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

async function getShopConfig(shopId) {
  const [{ data: gc }, { data: sp }] = await Promise.all([
    supabase.from('shop_google_configs')
      .select('google_refresh_token, google_folder_id')
      .eq('shop_id', shopId).single(),
    supabase.from('shop_profiles')
      .select('google_folder_id')
      .eq('id', shopId).single(),
  ]);
  if (!gc?.google_refresh_token) throw new Error('ยังไม่ได้เชื่อมต่อ Google');
  const folderId = gc.google_folder_id || sp?.google_folder_id || null;
  return { token: await getAccessToken(gc.google_refresh_token), folderId };
}

async function uploadToDrive(token, folderId, imageBuffer, mimeType) {
  const filename = `slip_pos_${Date.now()}.jpg`;
  const metadata = { name: filename, ...(folderId ? { parents: [folderId] } : {}) };
  const boundary = 'slip_boundary_xyz';

  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`),
    Buffer.from(JSON.stringify(metadata)),
    Buffer.from(`\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    imageBuffer,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const res = await fetch(`${DRIVE_UPLOAD}?uploadType=multipart`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary="${boundary}"`,
    },
    body,
  });
  const data = await res.json();
  if (!data.id) throw new Error('Drive upload failed: ' + JSON.stringify(data));

  // ทำให้ดูได้แบบสาธารณะ
  await fetch(`${DRIVE_API}/${data.id}/permissions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
  });

  return `https://drive.google.com/uc?id=${data.id}`;
}

async function ocrWithGemini(imageBase64, mimeType) {
  if (!GEMINI_API_KEY) return null;
  const prompt = `อ่านข้อมูลจากสลิปโอนเงินนี้ ตอบเป็น JSON เท่านั้น ไม่มีข้อความอื่น:
{"amount":ยอดเงินตัวเลข,"sender":"ชื่อผู้โอน","receiver":"ชื่อผู้รับ","ref_no":"เลขอ้างอิง"}
ถ้าไม่พบให้ใส่ null`;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType, data: imageBase64 } },
          ]}],
          // maxOutputTokens ต้องสูงพอสำหรับ "thinking token" ภายในของ gemini-3.5-flash เสมอ
          // (256 เดิมเสี่ยงตัด JSON กลางคันเงียบๆ — พิสูจน์แล้วจริงกับ maxOutputTokens ต่ำแบบเดียวกันใน market-price.js/detectCategory)
          generationConfig: { temperature: 0.1, maxOutputTokens: 1024 },
        }),
      }
    );
    const data = await res.json();
    // รวมทุก part เข้าด้วยกัน — Gemini บางครั้งแบ่งเอาต์พุตเป็นหลาย part ในคำตอบเดียว
    const parts = data.candidates?.[0]?.content?.parts || [];
    const text = parts.map(p => p.text || '').join('');
    const match = text.match(/\{[\s\S]*?\}/);
    if (!match) {
      console.error('[process-slip] Gemini ไม่ตอบ JSON ที่ใช้ได้ — finishReason:', data.candidates?.[0]?.finishReason, 'text:', text.slice(0, 200));
      return null;
    }
    return JSON.parse(match[0]);
  } catch (err) {
    console.error('[process-slip] ocrWithGemini error:', err.message);
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { shopId, imageBase64, mimeType = 'image/jpeg' } = req.body || {};
  if (!shopId || !imageBase64) return res.status(400).json({ error: 'Missing shopId or imageBase64' });

  try {
    const { token, folderId } = await getShopConfig(shopId);
    const imageBuffer = Buffer.from(imageBase64, 'base64');

    // อัปโหลด Drive (fail-safe)
    let driveUrl = null;
    try {
      driveUrl = await uploadToDrive(token, folderId, imageBuffer, mimeType);
    } catch (err) {
      console.error('[process-slip] Drive error:', err.message);
    }

    // OCR ด้วย Gemini
    const ocr = await ocrWithGemini(imageBase64, mimeType);

    return res.json({
      ok: true,
      url: driveUrl,
      amount: ocr?.amount ?? null,
      sender: ocr?.sender ?? null,
      refNo: ocr?.ref_no ?? null,
    });

  } catch (err) {
    console.error('[process-slip]', err.message);
    if (err.message.includes('Google')) return res.status(400).json({ error: err.message, notConnected: true });
    return res.status(500).json({ error: err.message });
  }
}
