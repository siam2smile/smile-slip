/**
 * GET    /api/pos/receives-pending?shopId              → รายการรับสินค้าที่รอตรวจสอบ (มาจากบอท LINE #รับสินค้า)
 * DELETE /api/pos/receives-pending { shopId, pending_no } → ลบออกจากคิวรอ (ปฏิเสธ หรือแอดมินยืนยันรับเข้าสต็อคจริงเสร็จแล้ว)
 *
 * ไฟล์นี้ไม่แตะสต็อคเอง — การตัดสต็อคจริงยังผ่าน /api/pos/receives ปกติเท่านั้น
 * (แอดมินตรวจ/แก้ไขรายการที่นี่ก่อน แล้วค่อยกดยืนยันผ่านฟอร์มรับสินค้าปกติ)
 */
import { createClient } from '@supabase/supabase-js';
import { blockIfTrialExpired } from '../../../lib/shop-access';
import {
  getAccessToken, readSheet, updateSheetRow, ensureTabExists,
  rowToPendingReceive, PENDING_RECEIVE_HEADERS,
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

  // เขียนไม่ได้ถ้าทดลองใช้ 30 วันหมดอายุแล้ว (อ่าน/GET ยังทำได้ปกติเสมอ)
  if (req.method !== 'GET' && (await blockIfTrialExpired(req, res, shopId))) return;


  try {
    const { sheetId, token } = await getConfig(shopId);
    await ensureTabExists(token, sheetId, 'รับสินค้ารอยืนยัน', PENDING_RECEIVE_HEADERS);

    if (req.method === 'GET') {
      const rows = await readSheet(token, sheetId, 'รับสินค้ารอยืนยัน!A:I');
      const pending = rows.slice(1)
        .map(r => rowToPendingReceive(r))
        .filter(p => p.pending_no && p.status === 'รอตรวจสอบ')
        .reverse();
      return res.json({ pending });
    }

    if (req.method === 'DELETE') {
      const { pending_no } = req.body;
      if (!pending_no) return res.status(400).json({ error: 'Missing pending_no' });
      const rows = await readSheet(token, sheetId, 'รับสินค้ารอยืนยัน!A:I');
      const idx = rows.slice(1).findIndex(r => r[0] === pending_no);
      if (idx === -1) return res.status(404).json({ error: 'ไม่พบรายการ' });
      await updateSheetRow(token, sheetId, 'รับสินค้ารอยืนยัน', idx + 2, new Array(9).fill(''));
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[pos/receives-pending]', err.message);
    if (err.notSetup) return res.status(400).json({ error: err.message, notSetup: true });
    if (err.notConnected) return res.status(400).json({ error: err.message, notConnected: true });
    return res.status(500).json({ error: err.message });
  }
}
