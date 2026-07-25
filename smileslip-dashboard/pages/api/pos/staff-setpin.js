/**
 * POST /api/pos/staff-setpin { shopId, staff_id, pin }
 * พนักงานตั้ง/เปลี่ยน PIN ของตัวเอง — เข้าถึงหน้านี้ได้จากลิงก์ที่ส่งทาง LINE เท่านั้น
 * (การมีลิงก์คือการยืนยันตัวตน เหมือน pattern เดียวกับลิงก์ยืนยันงานจัดส่ง/เก็บเงินที่มีอยู่แล้ว)
 */
import { createClient } from '@supabase/supabase-js';
import { getAccessToken, readSheet, updateSheetRow, ensureTabExists, STAFF_HEADERS } from '../../../lib/google-pos';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

// บังคับให้ Google Sheets เก็บเป็นข้อความล้วน กันเบอร์โทรที่ขึ้นต้นด้วย 0 โดนตัด 0 ทิ้ง
function asText(v) {
  if (v === '' || v == null) return v;
  return `'${v}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { shopId, staff_id, pin } = req.body || {};
  if (!shopId || !staff_id || !pin) return res.status(400).json({ error: 'Missing shopId, staff_id, or pin' });
  if (!/^\d{4}$/.test(String(pin))) return res.status(400).json({ error: 'PIN ต้องเป็นตัวเลข 4 หลัก' });

  try {
    const { data: pc } = await supabase.from('pos_configs').select('pos_sheet_id').eq('shop_id', shopId).single();
    const { data: gc } = await supabase.from('shop_google_configs').select('google_refresh_token').eq('shop_id', shopId).single();
    if (!pc?.pos_sheet_id) return res.status(400).json({ error: 'ยังไม่ได้ตั้งค่า POS', notSetup: true });
    if (!gc?.google_refresh_token) return res.status(400).json({ error: 'ยังไม่ได้เชื่อมต่อ Google', notConnected: true });

    const token = await getAccessToken(gc.google_refresh_token);
    await ensureTabExists(token, pc.pos_sheet_id, 'พนักงาน', STAFF_HEADERS);
    const rows = await readSheet(token, pc.pos_sheet_id, 'พนักงาน!A:U');
    const dataRows = rows.slice(1);
    const idx = dataRows.findIndex(r => r[0] === staff_id);
    if (idx === -1) return res.status(404).json({ error: 'ไม่พบพนักงาน' });

    // ไม่ต้องเช็ค PIN ซ้ำกับคนอื่นในร้านอีกต่อไป (เดิมเช็คเพราะ verify-pin.js เคยค้นหา PIN
    // เดี่ยวๆ ข้ามพนักงานทั้งร้าน) — ตอนนี้ verify-pin.js ระบุตัวตนด้วย staff_id/line_id ก่อนเสมอ
    // แล้วเช็ค PIN เฉพาะคนนั้น ทำให้ 2 คนตั้ง PIN ซ้ำกันได้แล้วโดยไม่มีปัญหา (คนละแถวกันในชีต) —
    // การเช็คซ้ำแบบเดิมเป็นช่องโหว่ด้วย (เปิดให้ไล่เดาได้ว่า PIN ไหน "มีคนใช้แล้วบ้าง" ทั้งร้าน
    // โดยไม่จำกัดจำนวนครั้งเลย) จึงตัดออกไปเลยแทนที่จะแค่จำกัดจำนวนครั้ง

    // อ่าน/pad ให้ครบ 21 คอลัมน์ (A-U) เสมอก่อน update ทับทั้งแถว — เดิม pad แค่ 13 (A-M) ทำให้
    // ถ้าพนักงานคนนี้เคยถูกตั้งสิทธิ์เชิงลึก (คอลัมน์ N-U) ไว้แล้ว การตั้ง PIN ใหม่จะเขียนทับ
    // ล้างสิทธิ์ทั้งหมดทิ้งไปเงียบๆ (เจอบั๊กแฝงนี้จากการ grep ทุกจุดที่แตะชีต "พนักงาน" ก่อน commit)
    const existing = [...dataRows[idx]];
    while (existing.length < 21) existing.push('');
    existing[8] = String(pin);
    // เบอร์โทรที่ readSheet() อ่านมาไม่มี apostrophe ต้อง re-wrap เสมอก่อนเขียนทั้งแถวกลับ —
    // endpoint นี้ไม่ได้ตั้งใจแก้เบอร์โทรเลย แต่เขียนทั้งแถวทับทุกครั้งที่ตั้ง PIN
    existing[2] = asText(existing[2]);
    await updateSheetRow(token, pc.pos_sheet_id, 'พนักงาน', idx + 2, existing);

    return res.json({ ok: true, name: existing[1] || '' });
  } catch (err) {
    console.error('[staff-setpin]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
