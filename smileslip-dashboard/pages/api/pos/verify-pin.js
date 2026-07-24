/**
 * POST /api/pos/verify-pin { shopId, pin, purpose, staff_id? , line_id? }
 *
 * ต้องระบุ `staff_id` (เลือกจากรายชื่อในหน้า "เลือกชื่อตัวเอง" — ดู staff-picker.js) หรือ
 * `line_id` (LIFF รู้อัตโนมัติตอนเปิดจากในแอปไลน์ — ดู pos-staff.js) มาด้วยเสมอ แล้วเช็คว่า PIN
 * ตรงกับ "คนคนนั้นคนเดียว" เท่านั้น — เดิมค้นหา PIN เดี่ยวๆ ข้ามพนักงานทั้งร้าน (ไล่หาว่า PIN นี้
 * เป็นของใคร) ซึ่งบังคับให้ PIN ต้องไม่ซ้ำกันทั้งร้าน และเปิดช่องให้ไล่เดาผ่าน staff-setpin.js ได้ว่า
 * PIN ไหน "มีคนใช้แล้วบ้าง" — เปลี่ยนมาระบุตัวตนก่อนแล้วค่อยเช็ค PIN เฉพาะคนนั้น ปิดช่องโหว่ทั้งสอง
 * และทำให้ 2 คนตั้ง PIN ซ้ำกันได้แล้วโดยไม่มีปัญหา (คนละแถวกันในชีต แยกกันด้วย staff_id/line_id)
 */
import { createClient } from '@supabase/supabase-js';
import { getAccessToken, readSheet, ensureTabExists, rowToStaff, STAFF_HEADERS } from '../../../lib/google-pos';
import { hasFeature, upgradeMessage } from '../../../lib/tier-features';
import { issueStaffSession } from '../../../lib/staff-session';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

// กัน brute-force เดา PIN 4 หลัก (10,000 ความเป็นไปได้) — จำกัดจำนวนครั้งที่ผิดต่อ "คนคนเดียว"
// ต่อหน้าต่างเวลา (คนละ key กับคนอื่น กันคนหนึ่งโดนลองผิดจนล็อกไปกระทบคนอื่นในร้านเดียวกัน)
const failedAttempts = new Map(); // `${shopId}:${who}` -> { count, windowStart }
const MAX_ATTEMPTS = 15;
const WINDOW_MS = 15 * 60 * 1000;

function isRateLimited(key) {
  const now = Date.now();
  const entry = failedAttempts.get(key);
  if (!entry || now - entry.windowStart > WINDOW_MS) return false;
  return entry.count >= MAX_ATTEMPTS;
}
function recordFailedAttempt(key) {
  const now = Date.now();
  const entry = failedAttempts.get(key);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    failedAttempts.set(key, { count: 1, windowStart: now });
  } else {
    entry.count += 1;
  }
}
function clearFailedAttempts(key) {
  failedAttempts.delete(key);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { shopId, pin, purpose = '', staff_id, line_id } = req.body || {};
  if (!shopId || !pin) return res.status(400).json({ error: 'Missing shopId or pin' });
  if (!staff_id && !line_id) return res.status(400).json({ error: 'ต้องเลือกชื่อพนักงานก่อนใส่ PIN' });

  const rateLimitKey = `${shopId}:${staff_id || line_id}`;
  if (isRateLimited(rateLimitKey)) {
    return res.status(429).json({ error: 'ลองผิดหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่' });
  }

  try {
    // แอปพนักงานส่งของ (pos-staff.js) ล็อกที่ Shop Pro ตาม feature gating matrix — advance ขึ้นไปใช้ได้
    // purpose='cash_shift' (เปิด/ปิดกะเงินสดจากหน้า pos.js เอง) และ purpose='pos_cashier' (ลิงก์
    // แคชเชียร์ที่ /pos?mode=cashier) ไม่เกี่ยวกับแอปพนักงานส่งของเลย ทั้งสองเป็นฟีเจอร์ความปลอดภัย
    // พื้นฐาน (แยกสิทธิ์แคชเชียร์ออกจากบัญชีเจ้าของร้าน) ที่ต้องเปิดให้ทุก tier ใช้ได้เสมอ — ไม่ผูก
    // กับกลยุทธ์ upsell ของแอปพนักงานส่งของแบบเต็มรูปแบบ (งานจัดส่ง/เก็บเงิน ฯลฯ ยังคงล็อกตามเดิม)
    const { data: sp } = await supabase.from('shop_profiles').select('subscription_tier').eq('id', shopId).maybeSingle();
    const skipTierGate = purpose === 'cash_shift' || purpose === 'pos_cashier';
    if (!skipTierGate && sp && !hasFeature(sp.subscription_tier, 'delivery_staff_app')) {
      return res.status(403).json({ error: upgradeMessage('delivery_staff_app'), featureLocked: true });
    }

    const { data: pc } = await supabase.from('pos_configs').select('pos_sheet_id').eq('shop_id', shopId).single();
    const { data: gc } = await supabase.from('shop_google_configs').select('google_refresh_token').eq('shop_id', shopId).single();
    if (!pc?.pos_sheet_id) return res.status(400).json({ error: 'ยังไม่ได้ตั้งค่า POS', notSetup: true });
    if (!gc?.google_refresh_token) return res.status(400).json({ error: 'ยังไม่ได้เชื่อมต่อ Google', notConnected: true });

    const token = await getAccessToken(gc.google_refresh_token);
    await ensureTabExists(token, pc.pos_sheet_id, 'พนักงาน', STAFF_HEADERS);
    const rows = await readSheet(token, pc.pos_sheet_id, 'พนักงาน!A:U');
    const staffRow = staff_id
      ? rows.slice(1).find(r => r[0] === staff_id)
      : rows.slice(1).find(r => r[3] && r[3] === line_id);

    if (!staffRow || !staffRow[8] || String(staffRow[8]) !== String(pin)) {
      recordFailedAttempt(rateLimitKey);
      return res.status(401).json({ error: 'PIN ไม่ถูกต้อง' });
    }

    clearFailedAttempts(rateLimitKey);
    const staff = rowToStaff(staffRow);
    // ออก session ที่เซ็นชื่อ (HMAC) ผูก shopId+staffId — ใช้แนบ header `x-staff-session` กับ
    // ทุกคำขอถัดไปแทนการส่ง staffId เปล่าๆ (ปลอมได้ตรงๆ แบบเดิม) ทั้ง /pos?mode=cashier และ
    // /pos-staff ใช้ session เดียวกันนี้ร่วมกัน — คืน null ถ้ายังไม่ได้ตั้ง STAFF_SESSION_SECRET
    // (fail-closed, ฝั่งเว็บจะ fallback เป็นไม่มี session แนบ = ทำงานเหมือนไม่มีสิทธิ์อะไรเลย)
    const sessionToken = issueStaffSession(shopId, staff.staff_id);
    return res.json({
      ok: true, hasSheet: !!pc.pos_sheet_id,
      isWhiteLabel: hasFeature(sp?.subscription_tier, 'white_label'),
      sessionToken,
      staff: {
        staff_id: staff.staff_id, name: staff.name, role: staff.role, line_id: staff.line_id, branch_name: staff.branch_name,
        perm_view_revenue: staff.perm_view_revenue, perm_view_pl: staff.perm_view_pl,
        perm_manage_stock: staff.perm_manage_stock, perm_export_vat: staff.perm_export_vat,
        perm_process_sales: staff.perm_process_sales, perm_void_sales: staff.perm_void_sales,
        perm_manage_customers: staff.perm_manage_customers, perm_manage_expenses: staff.perm_manage_expenses,
        perm_manage_delivery: staff.perm_manage_delivery, perm_manage_receiving: staff.perm_manage_receiving,
        perm_issue_tax_invoice: staff.perm_issue_tax_invoice, perm_manage_staff: staff.perm_manage_staff,
      },
    });
  } catch (err) {
    console.error('[verify-pin]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
