/**
 * POST /api/pos/upload-photo
 * Body: { shopId, imageBase64, mimeType, folderLabel }
 * อัปโหลดรูปภาพทั่วไป (บิล/สลิปรายจ่าย ฯลฯ) ไปยัง Google Drive ของร้าน — ไม่มี OCR
 * (คนละ endpoint กับ process-slip.js ที่ทำ OCR สลิปโอนเงินด้วย)
 * คืน: { ok, url }
 */
import { createClient } from '@supabase/supabase-js';
import { getAccessToken } from '../../../lib/google-pos';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';

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

async function uploadToDrive(token, folderId, imageBuffer, mimeType, folderLabel) {
  const filename = `${folderLabel || 'photo'}_pos_${Date.now()}.jpg`;
  const metadata = { name: filename, ...(folderId ? { parents: [folderId] } : {}) };
  const boundary = 'pos_photo_boundary_xyz';

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

  await fetch(`${DRIVE_API}/${data.id}/permissions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
  });

  return `https://drive.google.com/uc?id=${data.id}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { shopId, imageBase64, mimeType = 'image/jpeg', folderLabel = 'expense' } = req.body || {};
  if (!shopId || !imageBase64) return res.status(400).json({ error: 'Missing shopId or imageBase64' });

  try {
    const { token, folderId } = await getShopConfig(shopId);
    const imageBuffer = Buffer.from(imageBase64, 'base64');
    const url = await uploadToDrive(token, folderId, imageBuffer, mimeType, folderLabel);
    return res.json({ ok: true, url });
  } catch (err) {
    console.error('[pos/upload-photo]', err.message);
    if (err.message.includes('Google')) return res.status(400).json({ error: err.message, notConnected: true });
    return res.status(500).json({ error: err.message });
  }
}
