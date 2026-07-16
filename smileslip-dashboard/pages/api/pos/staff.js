/**
 * GET    /api/pos/staff?shopId          → รายชื่อพนักงาน/คนส่ง
 * POST   /api/pos/staff { shopId, name, phone, line_id, role, notes }
 * PATCH  /api/pos/staff { shopId, staff_id, ...fields }
 * DELETE /api/pos/staff { shopId, staff_id }
 */
import { createClient } from '@supabase/supabase-js';
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

  try {
    const { sheetId, token } = await getConfig(shopId);
    await ensureTabExists(token, sheetId, 'พนักงาน', STAFF_HEADERS);

    // ── GET ─────────────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      const rows = await readSheet(token, sheetId, 'พนักงาน!A:H');
      const staff = rows.slice(1)
        .map((r, i) => ({ ...rowToStaff(r), _row: i + 2 }))
        .filter(s => s.staff_id && s.name);
      return res.json({ staff });
    }

    // ── POST ─────────────────────────────────────────────────────────────────
    if (req.method === 'POST') {
      const { name, phone = '', line_id = '', role = 'พนักงานส่ง', notes = '', branch_name = '' } = req.body;
      if (!name) return res.status(400).json({ error: 'ต้องระบุชื่อ' });

      const staff_id = makeStaffId();
      const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
      await appendSheet(token, sheetId, 'พนักงาน', [
        staff_id, name, asText(phone), line_id, role, notes, asText(now), branch_name,
      ]);
      return res.json({ ok: true, staff_id, name });
    }

    // ── PATCH ────────────────────────────────────────────────────────────────
    if (req.method === 'PATCH') {
      const { staff_id, name, phone, line_id, role, notes, branch_name } = req.body;
      if (!staff_id) return res.status(400).json({ error: 'Missing staff_id' });

      const rows = await readSheet(token, sheetId, 'พนักงาน!A:H');
      const dataRows = rows.slice(1);
      const idx = dataRows.findIndex(r => r[0] === staff_id);
      if (idx === -1) return res.status(404).json({ error: 'ไม่พบพนักงาน' });

      const existing = [...dataRows[idx]];
      while (existing.length < 8) existing.push('');
      if (name        !== undefined) existing[1] = name;
      if (phone       !== undefined) existing[2] = asText(phone);
      if (line_id     !== undefined) existing[3] = line_id;
      if (role        !== undefined) existing[4] = role;
      if (notes       !== undefined) existing[5] = notes;
      if (branch_name !== undefined) existing[7] = branch_name;

      await updateSheetRow(token, sheetId, 'พนักงาน', idx + 2, existing);
      return res.json({ ok: true, staff_id });
    }

    // ── DELETE ───────────────────────────────────────────────────────────────
    if (req.method === 'DELETE') {
      const { staff_id } = req.body;
      if (!staff_id) return res.status(400).json({ error: 'Missing staff_id' });

      const rows = await readSheet(token, sheetId, 'พนักงาน!A:H');
      const idx = rows.slice(1).findIndex(r => r[0] === staff_id);
      if (idx === -1) return res.status(404).json({ error: 'ไม่พบพนักงาน' });

      await updateSheetRow(token, sheetId, 'พนักงาน', idx + 2, Array(8).fill(''));
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
