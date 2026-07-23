/**
 * GET    /api/pos/staff?shopId          → รายชื่อพนักงาน/คนส่ง
 * POST   /api/pos/staff { shopId, name, phone, line_id, role, notes }
 *   → ถ้ามี line_id จะส่งลิงก์ "ตั้งรหัส PIN" ให้พนักงานทาง LINE ทันที
 * PATCH  /api/pos/staff { shopId, staff_id, ...fields, reset_pin, resend_pin_link }
 *   → reset_pin: true = ล้าง PIN เดิมทิ้ง (กันพนักงานที่ออกจากงานแล้วแอบเข้า)
 *   → resend_pin_link: true = ส่งลิงก์ตั้งรหัส PIN ใหม่อีกครั้ง (ต้องมี line_id อยู่แล้ว)
 * DELETE /api/pos/staff { shopId, staff_id }
 */
import { createClient } from '@supabase/supabase-js';
import { blockIfTrialExpired } from '../../../lib/shop-access';
import { requirePermission } from '../../../lib/pos-auth';
import {
  getAccessToken, readSheet, appendSheet, updateSheetRow, ensureTabExists,
  makeStaffId, rowToStaff, STAFF_HEADERS,
} from '../../../lib/google-pos';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

// บังคับให้ Google Sheets เก็บเป็นข้อความล้วน กันเบอร์โทร/วันที่ถูกตีความเป็นตัวเลข
function asText(v) {
  if (v === '' || v == null) return v;
  return `'${v}`;
}

// ส่งลิงก์ "ตั้งรหัส PIN" ให้พนักงานทาง LINE — ลิงก์นี้เองคือตัวยืนยันตัวตน (ส่งหาแค่ line_id
// เจ้าของ PIN เท่านั้น) เหมือน pattern เดียวกับลิงก์ยืนยันงานจัดส่ง/เก็บเงินที่มีอยู่แล้ว
async function sendPinSetupLink(lineId, shopId, staffId, staffName) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token || !lineId) return;
  const url = `${process.env.FRONTEND_URL}/pos-staff?shopId=${shopId}&staff_id=${staffId}&setpin=1`;
  const message = {
    type: 'text',
    text: `🔐 ตั้งรหัส PIN ส่วนตัวของคุณ${staffName ? ` (${staffName})` : ''}\nใช้ PIN นี้เข้าหน้าพนักงานแทนรหัสเดิมของร้าน ตั้งได้ที่ลิงก์นี้เลยค่ะ:\n${url}`,
  };
  try {
    await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: lineId, messages: [message] }),
    });
  } catch (err) {
    console.error('[staff] sendPinSetupLink error:', err.message);
  }
}

async function getConfig(shopId) {
  const [{ data: pc }, { data: gc }] = await Promise.all([
    supabase.from('pos_configs').select('pos_sheet_id').eq('shop_id', shopId).single(),
    supabase.from('shop_google_configs').select('google_refresh_token').eq('shop_id', shopId).single(),
  ]);
  if (!pc?.pos_sheet_id) throw Object.assign(new Error('ยังไม่ได้ตั้งค่า POS'), { notSetup: true });
  if (!gc?.google_refresh_token) throw Object.assign(new Error('ยังไม่ได้เชื่อมต่อ Google'), { notConnected: true });
  return { sheetId: pc.pos_sheet_id, token: await getAccessToken(gc.google_refresh_token) };
}

export default async function handler(req, res) {
  const shopId = req.query.shopId || req.body?.shopId;
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });

  // เขียนไม่ได้ถ้าทดลองใช้ 30 วันหมดอายุแล้ว (อ่าน/GET ยังทำได้ปกติเสมอ)
  if (req.method !== 'GET' && (await blockIfTrialExpired(req, res, shopId))) return;


  try {
    const { sheetId, token } = await getConfig(shopId);
    await ensureTabExists(token, sheetId, 'พนักงาน', STAFF_HEADERS);

    // การจัดการพนักงาน (เพิ่ม/แก้ไข/ลบ) ต้องมีสิทธิ์ perm_manage_staff ถ้าเรียกจาก session
    // แคชเชียร์/พนักงาน (ไม่มี header = เจ้าของ/แอดมิน ทำงานเหมือนเดิมทุกประการ) — นี่คือ
    // endpoint ที่ตั้งค่าสิทธิ์เอง จึงต้องเข้มงวดเป็นพิเศษ กันพนักงานเปิดสิทธิ์ให้ตัวเองหรือคนอื่น
    if (req.method !== 'GET' && !(await requirePermission(req, res, token, sheetId, 'perm_manage_staff'))) return;

    // ── GET ─────────────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      const rows = await readSheet(token, sheetId, 'พนักงาน!A:U');
      const staff = rows.slice(1)
        .map((r, i) => ({ ...rowToStaff(r), _row: i + 2 }))
        .filter(s => s.staff_id && s.name);
      return res.json({ staff });
    }

    // ── POST ─────────────────────────────────────────────────────────────────
    if (req.method === 'POST') {
      const {
        name, phone = '', line_id = '', role = 'พนักงานส่ง', notes = '', branch_name = '',
        perm_view_revenue = false, perm_view_pl = false, perm_manage_stock = false, perm_export_vat = false,
        perm_process_sales = false, perm_void_sales = false, perm_manage_customers = false, perm_manage_expenses = false,
        perm_manage_delivery = false, perm_manage_receiving = false, perm_issue_tax_invoice = false, perm_manage_staff = false,
      } = req.body;
      if (!name) return res.status(400).json({ error: 'ต้องระบุชื่อ' });

      const staff_id = makeStaffId();
      const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
      await appendSheet(token, sheetId, 'พนักงาน', [
        staff_id, name, asText(phone), line_id, role, notes, asText(now), branch_name, '',
        perm_view_revenue ? 'TRUE' : 'FALSE',
        perm_view_pl ? 'TRUE' : 'FALSE',
        perm_manage_stock ? 'TRUE' : 'FALSE',
        perm_export_vat ? 'TRUE' : 'FALSE',
        perm_process_sales ? 'TRUE' : 'FALSE',
        perm_void_sales ? 'TRUE' : 'FALSE',
        perm_manage_customers ? 'TRUE' : 'FALSE',
        perm_manage_expenses ? 'TRUE' : 'FALSE',
        perm_manage_delivery ? 'TRUE' : 'FALSE',
        perm_manage_receiving ? 'TRUE' : 'FALSE',
        perm_issue_tax_invoice ? 'TRUE' : 'FALSE',
        perm_manage_staff ? 'TRUE' : 'FALSE',
      ]);
      if (line_id) sendPinSetupLink(line_id, shopId, staff_id, name).catch(() => {});
      return res.json({ ok: true, staff_id, name });
    }

    // ── PATCH ────────────────────────────────────────────────────────────────
    if (req.method === 'PATCH') {
      const {
        staff_id, name, phone, line_id, role, notes, branch_name, reset_pin, resend_pin_link,
        perm_view_revenue, perm_view_pl, perm_manage_stock, perm_export_vat,
        perm_process_sales, perm_void_sales, perm_manage_customers, perm_manage_expenses,
        perm_manage_delivery, perm_manage_receiving, perm_issue_tax_invoice, perm_manage_staff,
      } = req.body;
      if (!staff_id) return res.status(400).json({ error: 'Missing staff_id' });

      const rows = await readSheet(token, sheetId, 'พนักงาน!A:U');
      const dataRows = rows.slice(1);
      const idx = dataRows.findIndex(r => r[0] === staff_id);
      if (idx === -1) return res.status(404).json({ error: 'ไม่พบพนักงาน' });

      const existing = [...dataRows[idx]];
      while (existing.length < 21) existing.push('');
      if (name        !== undefined) existing[1] = name;
      if (phone       !== undefined) existing[2] = asText(phone);
      if (line_id     !== undefined) existing[3] = line_id;
      if (role        !== undefined) existing[4] = role;
      if (notes       !== undefined) existing[5] = notes;
      if (branch_name !== undefined) existing[7] = branch_name;
      // รีเซ็ต PIN — กันพนักงานที่ออกจากงานแล้วแอบใช้ PIN เดิมเข้าระบบ ต้องตั้งใหม่ถึงจะเข้าได้
      if (reset_pin) existing[8] = '';
      if (perm_view_revenue !== undefined) existing[9]  = perm_view_revenue ? 'TRUE' : 'FALSE';
      if (perm_view_pl      !== undefined) existing[10] = perm_view_pl ? 'TRUE' : 'FALSE';
      if (perm_manage_stock !== undefined) existing[11] = perm_manage_stock ? 'TRUE' : 'FALSE';
      if (perm_export_vat   !== undefined) existing[12] = perm_export_vat ? 'TRUE' : 'FALSE';
      if (perm_process_sales    !== undefined) existing[13] = perm_process_sales ? 'TRUE' : 'FALSE';
      if (perm_void_sales       !== undefined) existing[14] = perm_void_sales ? 'TRUE' : 'FALSE';
      if (perm_manage_customers !== undefined) existing[15] = perm_manage_customers ? 'TRUE' : 'FALSE';
      if (perm_manage_expenses  !== undefined) existing[16] = perm_manage_expenses ? 'TRUE' : 'FALSE';
      if (perm_manage_delivery  !== undefined) existing[17] = perm_manage_delivery ? 'TRUE' : 'FALSE';
      if (perm_manage_receiving !== undefined) existing[18] = perm_manage_receiving ? 'TRUE' : 'FALSE';
      if (perm_issue_tax_invoice!== undefined) existing[19] = perm_issue_tax_invoice ? 'TRUE' : 'FALSE';
      if (perm_manage_staff     !== undefined) existing[20] = perm_manage_staff ? 'TRUE' : 'FALSE';

      await updateSheetRow(token, sheetId, 'พนักงาน', idx + 2, existing);

      if (resend_pin_link) {
        const lineIdForPush = line_id !== undefined ? line_id : existing[3];
        const nameForPush = name !== undefined ? name : existing[1];
        if (lineIdForPush) sendPinSetupLink(lineIdForPush, shopId, staff_id, nameForPush).catch(() => {});
      }

      return res.json({ ok: true, staff_id });
    }

    // ── DELETE ───────────────────────────────────────────────────────────────
    if (req.method === 'DELETE') {
      const { staff_id } = req.body;
      if (!staff_id) return res.status(400).json({ error: 'Missing staff_id' });

      const rows = await readSheet(token, sheetId, 'พนักงาน!A:U');
      const idx = rows.slice(1).findIndex(r => r[0] === staff_id);
      if (idx === -1) return res.status(404).json({ error: 'ไม่พบพนักงาน' });

      await updateSheetRow(token, sheetId, 'พนักงาน', idx + 2, Array(21).fill(''));
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('[pos/staff]', err.message);
    if (err.notSetup) return res.status(400).json({ error: err.message, notSetup: true });
    if (err.notConnected) return res.status(400).json({ error: err.message, notConnected: true });
    return res.status(500).json({ error: err.message });
  }
}
