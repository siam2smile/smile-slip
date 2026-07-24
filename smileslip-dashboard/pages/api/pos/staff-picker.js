/**
 * GET /api/pos/staff-picker?shopId=xxx
 * → รายชื่อพนักงานขั้นต่ำสุดสำหรับหน้า "เลือกชื่อตัวเอง" ก่อนใส่ PIN (แทนการพิมพ์ PIN เดี่ยวๆ
 *   แล้วให้ระบบไล่หาว่าใครในร้านตั้งไว้ — ดู verify-pin.js/staff-setpin.js สำหรับเหตุผลเต็ม)
 *
 * ไม่ต้องยืนยันตัวตนใดๆ (เรียกได้ก่อนรู้ว่าใครกำลังใช้เครื่อง) แต่คืนแค่ชื่อ+สาขา เท่านั้น —
 * ไม่คืนเบอร์โทร/LINE ID/สิทธิ์ต่างๆ เพื่อไม่เปิดเผยข้อมูลเกินจำเป็นที่หน้าจอนี้ยังไม่มีใครยืนยัน
 * ตัวตนเลย (แม้ endpoint อื่นในระบบ POS ส่วนใหญ่จะไม่บังคับ auth เหมือนกันอยู่แล้วก็ตาม)
 */
import { createClient } from '@supabase/supabase-js';
import { getAccessToken, readSheet, ensureTabExists, rowToStaff, STAFF_HEADERS } from '../../../lib/google-pos';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { shopId } = req.query;
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });

  try {
    const { data: pc } = await supabase.from('pos_configs').select('pos_sheet_id').eq('shop_id', shopId).single();
    const { data: gc } = await supabase.from('shop_google_configs').select('google_refresh_token').eq('shop_id', shopId).single();
    if (!pc?.pos_sheet_id) return res.status(400).json({ error: 'ยังไม่ได้ตั้งค่า POS', notSetup: true });
    if (!gc?.google_refresh_token) return res.status(400).json({ error: 'ยังไม่ได้เชื่อมต่อ Google', notConnected: true });

    const token = await getAccessToken(gc.google_refresh_token);
    await ensureTabExists(token, pc.pos_sheet_id, 'พนักงาน', STAFF_HEADERS);
    const rows = await readSheet(token, pc.pos_sheet_id, 'พนักงาน!A:U');
    const staff = rows.slice(1)
      .map(rowToStaff)
      .filter(s => s.staff_id && s.name && s.has_pin) // ยังไม่ตั้ง PIN = เลือกแล้วก็ล็อกอินไม่ได้อยู่ดี ไม่ต้องโชว์
      .map(s => ({ staff_id: s.staff_id, name: s.name.trim(), branch_name: s.branch_name || '' }));

    return res.json({ staff });
  } catch (err) {
    console.error('[staff-picker]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
