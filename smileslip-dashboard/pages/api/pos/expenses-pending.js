/**
 * GET    /api/pos/expenses-pending?shopId               → รายการรายจ่ายที่รอตรวจสอบ (มาจากบอท LINE #รายจ่าย)
 * DELETE /api/pos/expenses-pending { shopId, pending_no } → ลบออกจากคิวรอ (ปฏิเสธ หรือแอดมินยืนยันบันทึกจริงเสร็จแล้ว)
 *
 * ไฟล์นี้ไม่บันทึกรายจ่ายจริงเอง — การบันทึกจริงยังผ่าน /api/pos/expenses ปกติเท่านั้น
 * (แอดมินตรวจ/แก้ไขรายการที่นี่ก่อน แล้วค่อยกดยืนยันผ่านฟอร์มรายจ่ายปกติ)
 */
import { createClient } from '@supabase/supabase-js';
import {
  getAccessToken, readSheet, updateSheetRow, ensureTabExists,
  rowToPendingExpense, PENDING_EXPENSE_HEADERS,
} from '../../../lib/google-pos';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

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
    await ensureTabExists(token, sheetId, 'รายจ่ายรอยืนยัน', PENDING_EXPENSE_HEADERS);

    if (req.method === 'GET') {
      const rows = await readSheet(token, sheetId, 'รายจ่ายรอยืนยัน!A:K');
      const pending = rows.slice(1)
        .map(r => rowToPendingExpense(r))
        .filter(p => p.pending_no && p.status === 'รอตรวจสอบ')
        .reverse();
      return res.json({ pending });
    }

    if (req.method === 'DELETE') {
      const { pending_no } = req.body;
      if (!pending_no) return res.status(400).json({ error: 'Missing pending_no' });
      const rows = await readSheet(token, sheetId, 'รายจ่ายรอยืนยัน!A:K');
      const idx = rows.slice(1).findIndex(r => r[0] === pending_no);
      if (idx === -1) return res.status(404).json({ error: 'ไม่พบรายการ' });
      await updateSheetRow(token, sheetId, 'รายจ่ายรอยืนยัน', idx + 2, new Array(11).fill(''));
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[pos/expenses-pending]', err.message);
    if (err.notSetup) return res.status(400).json({ error: err.message, notSetup: true });
    if (err.notConnected) return res.status(400).json({ error: err.message, notConnected: true });
    return res.status(500).json({ error: err.message });
  }
}
