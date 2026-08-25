/**
 * POST /api/booking/deposit-slip — สาธารณะ ไม่ต้อง login (จากหน้า pages/booking-request.js
 * ทันทีหลังสร้างการจองสำเร็จ, เฉพาะบริการที่ต้องมัดจำ)
 * { shopId, booking_no, imageBase64, mimeType }
 *
 * อัปโหลดสลิปไปยัง Google Drive ของร้าน (pattern เดียวกับ api/pos/process-slip.js) + OCR ด้วย
 * Gemini อ่านยอดเงิน → เทียบกับ deposit_required_amount ที่ snapshot ไว้ตอนจอง:
 *   - ยอดตรง (คลาดเคลื่อนได้ ≤1 บาทกันปัดเศษ) → ยืนยันคิวอัตโนมัติทันที (status:'confirmed',
 *     deposit_status:'auto_confirmed') ตามที่ผู้ใช้ขอ "ได้รับสลิปปุ๊บมันจะจองให้ปั๊บในเวลานั้นเลย"
 *   - ยอดไม่ตรง/OCR อ่านไม่ได้ → deposit_status:'mismatch', status ยังคง 'pending' รอแอดมิน
 *     ตรวจสอบเอง (Phase 4) — ไม่ทิ้งสลิปที่อัปโหลดมาแล้วเลย ยังบันทึกไว้ให้แอดมินดูได้เสมอ
 * กันสลิปใบเดียวถูกเอาไปจองซ้ำผ่าน UNIQUE(shop_id, deposit_slip_hash) ที่ schema กันไว้แล้ว —
 * เช็คซ้ำก่อนเขียนด้วยเพื่อ error message ที่อ่านรู้เรื่อง แล้วพึ่ง DB constraint เป็นด่านสุดท้าย
 * กัน race condition (pattern เดียวกับ lib/ledger-supabase.js's persistLedgerTransaction())
 */
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { hasFeature } from '../../../lib/tier-features';
import { getAccessToken } from '../../../lib/google-pos';
import { configFromRow } from '../../../lib/booking';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
const MATCH_TOLERANCE_BAHT = 1;

export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

// กันสแปม/ยิงรัวจากหน้าเว็บสาธารณะ — pattern เดียวกับ reserve.js/customer-orders.js เป๊ะ
const attempts = new Map();
const MAX_PER_WINDOW = 10;
const WINDOW_MS = 10 * 60 * 1000;
function isRateLimited(key) {
  const now = Date.now();
  const e = attempts.get(key);
  if (!e || now - e.windowStart > WINDOW_MS) return false;
  return e.count >= MAX_PER_WINDOW;
}
function recordAttempt(key) {
  const now = Date.now();
  const e = attempts.get(key);
  if (!e || now - e.windowStart > WINDOW_MS) attempts.set(key, { count: 1, windowStart: now });
  else e.count += 1;
}

async function getShopGoogleConfig(shopId) {
  const [{ data: gc }, { data: sp }] = await Promise.all([
    supabase.from('shop_google_configs').select('google_refresh_token, google_folder_id').eq('shop_id', shopId).maybeSingle(),
    supabase.from('shop_profiles').select('google_folder_id').eq('id', shopId).maybeSingle(),
  ]);
  if (!gc?.google_refresh_token) return null; // ไม่ได้เชื่อมต่อ Google — คืน null แทน throw ให้ caller ตัดสินใจเอง
  const folderId = gc.google_folder_id || sp?.google_folder_id || null;
  return { token: await getAccessToken(gc.google_refresh_token), folderId };
}

async function uploadToDrive(token, folderId, imageBuffer, mimeType, bookingNo) {
  const filename = `deposit_${bookingNo}_${Date.now()}.jpg`;
  const metadata = { name: filename, ...(folderId ? { parents: [folderId] } : {}) };
  const boundary = 'booking_deposit_boundary_xyz';

  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`),
    Buffer.from(JSON.stringify(metadata)),
    Buffer.from(`\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    imageBuffer,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const res = await fetch(`${DRIVE_UPLOAD}?uploadType=multipart`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary="${boundary}"` },
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

async function ocrDepositSlip(imageBase64, mimeType) {
  if (!GEMINI_API_KEY) return null;
  const prompt = `อ่านข้อมูลจากสลิปโอนเงินนี้ ตอบเป็น JSON เท่านั้น ไม่มีข้อความอื่น:
{"amount":ยอดเงินตัวเลข,"ref_no":"เลขอ้างอิง"}
ถ้าไม่พบให้ใส่ null`;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: imageBase64 } }] }],
          // maxOutputTokens ต้องสูงพอสำหรับ "thinking token" ภายในของ gemini-3.5-flash เสมอ (ดู process-slip.js)
          generationConfig: { temperature: 0.1, maxOutputTokens: 1024 },
        }),
      }
    );
    const data = await res.json();
    const parts = data.candidates?.[0]?.content?.parts || [];
    const text = parts.map(p => p.text || '').join('');
    const match = text.match(/\{[\s\S]*?\}/);
    if (!match) {
      console.error('[booking/deposit-slip] Gemini ไม่ตอบ JSON ที่ใช้ได้ — finishReason:', data.candidates?.[0]?.finishReason);
      return null;
    }
    return JSON.parse(match[0]);
  } catch (err) {
    console.error('[booking/deposit-slip] ocrDepositSlip error:', err.message);
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { shopId, booking_no, imageBase64, mimeType = 'image/jpeg' } = req.body || {};
  if (!shopId || !booking_no || !imageBase64) return res.status(400).json({ error: 'ข้อมูลไม่ครบ' });

  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const rlKey = `${shopId}:${ip}`;
  if (isRateLimited(rlKey)) return res.status(429).json({ error: 'ลองบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่' });

  try {
    const [{ data: shop }, { data: configRow }, { data: reservation }] = await Promise.all([
      supabase.from('shop_profiles').select('subscription_tier, status').eq('id', shopId).maybeSingle(),
      supabase.from('booking_configs').select('*').eq('shop_id', shopId).maybeSingle(),
      supabase.from('booking_reservations').select('*').eq('shop_id', shopId).eq('booking_no', booking_no).maybeSingle(),
    ]);
    if (!shop) return res.status(404).json({ error: 'ไม่พบร้านค้านี้' });
    if (!hasFeature(shop.subscription_tier, 'booking')) return res.status(403).json({ error: 'ร้านนี้ยังไม่เปิดใช้งานระบบจอง' });
    const config = configFromRow(configRow) || configFromRow({});
    if (!config.enabled) return res.status(403).json({ error: 'ร้านนี้ยังไม่เปิดรับจองในขณะนี้' });
    if (!reservation) return res.status(404).json({ error: 'ไม่พบรายการจองนี้' });
    if (!(Number(reservation.deposit_required_amount) > 0)) return res.status(400).json({ error: 'การจองนี้ไม่ต้องมัดจำ' });
    if (['auto_confirmed', 'manual_confirmed'].includes(reservation.deposit_status)) {
      return res.status(400).json({ error: 'รายการนี้ยืนยันมัดจำไปแล้ว' });
    }
    if (reservation.status === 'cancelled') return res.status(400).json({ error: 'การจองนี้ถูกยกเลิกไปแล้ว' });

    const imageBuffer = Buffer.from(imageBase64, 'base64');
    const slipHash = crypto.createHash('md5').update(imageBuffer).digest('hex');

    // เช็คสลิปซ้ำล่วงหน้าก่อน (กันเอาสลิปใบเดียวไปจองคิวอื่นในร้านเดียวกันซ้ำ) — DB constraint
    // (UNIQUE shop_id+deposit_slip_hash) เป็นด่านสุดท้ายกัน race condition ถ้าหลุดมาถึงตรงนี้
    const { data: dup } = await supabase.from('booking_reservations').select('booking_no')
      .eq('shop_id', shopId).eq('deposit_slip_hash', slipHash).neq('booking_no', booking_no).maybeSingle();
    if (dup) return res.status(409).json({ error: 'สลิปนี้เคยถูกใช้จองคิวอื่นไปแล้ว กรุณาใช้สลิปที่ยังไม่เคยใช้' });

    const gc = await getShopGoogleConfig(shopId);
    let driveUrl = null;
    if (gc) {
      try {
        driveUrl = await uploadToDrive(gc.token, gc.folderId, imageBuffer, mimeType, booking_no);
      } catch (err) {
        console.error('[booking/deposit-slip] Drive upload error:', err.message);
      }
    }

    const ocr = await ocrDepositSlip(imageBase64, mimeType);
    const ocrAmount = typeof ocr?.amount === 'number' ? ocr.amount : (ocr?.amount ? parseFloat(ocr.amount) : null);
    const required = Number(reservation.deposit_required_amount);
    const matched = ocrAmount != null && !isNaN(ocrAmount) && Math.abs(ocrAmount - required) <= MATCH_TOLERANCE_BAHT;

    const updates = {
      deposit_slip_url: driveUrl,
      deposit_slip_hash: slipHash,
      deposit_verified_amount: ocrAmount != null && !isNaN(ocrAmount) ? ocrAmount : null,
    };
    if (matched) {
      updates.deposit_status = 'auto_confirmed';
      updates.status = 'confirmed';
      updates.confirmed_at = new Date().toISOString();
    } else {
      updates.deposit_status = 'mismatch';
    }

    const { error: updateErr } = await supabase.from('booking_reservations').update(updates)
      .eq('shop_id', shopId).eq('booking_no', booking_no);
    if (updateErr) {
      if (updateErr.code === '23505') return res.status(409).json({ error: 'สลิปนี้เคยถูกใช้จองคิวอื่นไปแล้ว กรุณาใช้สลิปที่ยังไม่เคยใช้' });
      throw updateErr;
    }

    recordAttempt(rlKey);
    return res.json({
      ok: true,
      confirmed: matched,
      deposit_status: updates.deposit_status,
      ocr_amount: updates.deposit_verified_amount,
      required_amount: required,
      google_connected: !!gc,
      message: matched
        ? 'ยืนยันมัดจำสำเร็จ คิวของคุณถูกยืนยันแล้ว!'
        : (ocrAmount == null
          ? 'อัปโหลดสลิปสำเร็จ แต่ระบบอ่านยอดเงินจากรูปไม่ได้ — ทางร้านจะตรวจสอบและยืนยันให้เร็วที่สุด'
          : `อัปโหลดสลิปสำเร็จ แต่ยอดที่อ่านได้ (฿${ocrAmount.toLocaleString()}) ไม่ตรงกับยอดมัดจำที่ต้องชำระ (฿${required.toLocaleString()}) — ทางร้านจะตรวจสอบและยืนยันให้เร็วที่สุด`),
    });
  } catch (err) {
    console.error('[booking/deposit-slip]', err.message);
    return res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' });
  }
}
