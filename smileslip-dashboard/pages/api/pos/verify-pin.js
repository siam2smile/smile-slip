/**
 * POST /api/pos/verify-pin { shopId, pin }
 * ค้นหาพนักงานที่ PIN ตรงกันในชีต "พนักงาน" ของร้าน (แทน PIN ร้านเดียวใช้ร่วมกันแบบเดิม —
 * ยกเลิกไปแล้ว) → คืนตัวตนพนักงานคนนั้น (staff_id, name, role) ให้ pos-staff.js ใช้ต่อ
 */
import { createClient } from '@supabase/supabase-js';
import { getAccessToken, readSheet, ensureTabExists, rowToStaff, STAFF_HEADERS } from '../../../lib/google-pos';
import { hasFeature, upgradeMessage } from '../../../lib/tier-features';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

// กัน brute-force เดา PIN 4 หลัก (10,000 ความเป็นไปได้) — จำกัดจำนวนครั้งที่ผิดต่อร้านต่อหน้าต่างเวลา
// (in-memory ต่อ instance — เพียงพอสำหรับสเกลของแอปนี้ ไม่ต้องพึ่ง Redis เหมือนฝั่งบอท)
const failedAttempts = new Map(); // shopId -> { count, windowStart }
const MAX_ATTEMPTS = 15;
const WINDOW_MS = 15 * 60 * 1000;

function isRateLimited(shopId) {
  const now = Date.now();
  const entry = failedAttempts.get(shopId);
  if (!entry || now - entry.windowStart > WINDOW_MS) return false;
  return entry.count >= MAX_ATTEMPTS;
}
function recordFailedAttempt(shopId) {
  const now = Date.now();
  const entry = failedAttempts.get(shopId);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    failedAttempts.set(shopId, { count: 1, windowStart: now });
  } else {
    entry.count += 1;
  }
}
function clearFailedAttempts(shopId) {
  failedAttempts.delete(shopId);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { shopId, pin } = req.body || {};
  if (!shopId || !pin) return res.status(400).json({ error: 'Missing shopId or pin' });

  if (isRateLimited(shopId)) {
    return res.status(429).json({ error: 'ลองผิดหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่' });
  }

  try {
    // แอปพนักงานส่งของ (pos-staff.js) ล็อกที่ Shop Pro ตาม feature gating matrix — advance ขึ้นไปใช้ได้
    const { data: sp } = await supabase.from('shop_profiles').select('subscription_tier').eq('id', shopId).maybeSingle();
    if (sp && !hasFeature(sp.subscription_tier, 'delivery_staff_app')) {
      return res.status(403).json({ error: upgradeMessage('delivery_staff_app'), featureLocked: true });
    }

    const { data: pc } = await supabase.from('pos_configs').select('pos_sheet_id').eq('shop_id', shopId).single();
    const { data: gc } = await supabase.from('shop_google_configs').select('google_refresh_token').eq('shop_id', shopId).single();
    if (!pc?.pos_sheet_id) return res.status(400).json({ error: 'ยังไม่ได้ตั้งค่า POS', notSetup: true });
    if (!gc?.google_refresh_token) return res.status(400).json({ error: 'ยังไม่ได้เชื่อมต่อ Google', notConnected: true });

    const token = await getAccessToken(gc.google_refresh_token);
    await ensureTabExists(token, pc.pos_sheet_id, 'พนักงาน', STAFF_HEADERS);
    const rows = await readSheet(token, pc.pos_sheet_id, 'พนักงาน!A:M');
    const staffRow = rows.slice(1).find(r => r[0] && r[8] && String(r[8]) === String(pin));

    if (!staffRow) {
      recordFailedAttempt(shopId);
      return res.status(401).json({ error: 'PIN ไม่ถูกต้อง' });
    }

    clearFailedAttempts(shopId);
    const staff = rowToStaff(staffRow);
    return res.json({
      ok: true, hasSheet: !!pc.pos_sheet_id,
      isWhiteLabel: hasFeature(sp?.subscription_tier, 'white_label'),
      staff: {
        staff_id: staff.staff_id, name: staff.name, role: staff.role, line_id: staff.line_id, branch_name: staff.branch_name,
        perm_view_revenue: staff.perm_view_revenue, perm_view_pl: staff.perm_view_pl,
        perm_manage_stock: staff.perm_manage_stock, perm_export_vat: staff.perm_export_vat,
      },
    });
  } catch (err) {
    console.error('[verify-pin]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
