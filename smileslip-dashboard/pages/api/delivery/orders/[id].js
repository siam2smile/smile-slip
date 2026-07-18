/**
 * PATCH /api/delivery/orders/[id]
 *   id = orderNo เช่น ORD20260703143022
 *   อัปเดต status / driver_name / payment_method / delivered_at / paid_at
 *
 * ข้อมูลทั้งหมดเก็บใน Google Sheets ของร้านค้า (PDPA compliant)
 */
import { createClient } from '@supabase/supabase-js';
import {
  getAccessToken, readSheet, updateSheetRow,
} from '../../../../lib/google-delivery';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  const { id: orderNo } = req.query;
  if (!orderNo) return res.status(400).json({ error: 'Missing order id' });

  const { shopId, ...updates } = req.body || {};
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });

  if (req.method !== 'PATCH') {
    res.setHeader('Allow', ['PATCH']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const [{ data: dc }, { data: gc }] = await Promise.all([
      supabase.from('delivery_configs').select('order_sheet_id').eq('shop_id', shopId).single(),
      supabase.from('shop_google_configs').select('google_refresh_token').eq('shop_id', shopId).single(),
    ]);
    if (!dc?.order_sheet_id) return res.status(400).json({ error: 'ยังไม่ได้ตั้งค่า Delivery', notSetup: true });
    if (!gc?.google_refresh_token) return res.status(400).json({ error: 'ยังไม่ได้เชื่อมต่อ Google', notConnected: true });

    const accessToken = await getAccessToken(gc.google_refresh_token);

    // หาแถวของ order นี้
    const rows = await readSheet(accessToken, dc.order_sheet_id, 'Sheet1!A:N');
    const dataRows = rows.slice(1);
    const rowIdx = dataRows.findIndex(r => (r[0] || '').trim() === orderNo.trim());

    if (rowIdx === -1) return res.status(404).json({ error: `ไม่พบออเดอร์ ${orderNo}` });

    const existing = [...dataRows[rowIdx]];
    // เติม empty ถ้า array สั้นกว่า 14 col
    while (existing.length < 14) existing.push('');

    const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });

    // อัปเดตแต่ละ field
    if (updates.status !== undefined)         existing[8]  = updates.status;
    if (updates.driver_name !== undefined)    existing[9]  = updates.driver_name;
    if (updates.payment_method !== undefined) existing[10] = updates.payment_method;
    if (updates.status === 'delivered')       existing[11] = existing[11] || now;  // delivered_at
    if (updates.status === 'paid')            existing[12] = existing[12] || now;  // paid_at
    if (updates.notes !== undefined)          existing[13] = updates.notes;

    await updateSheetRow(accessToken, dc.order_sheet_id, 'Sheet1', rowIdx + 2, existing);

    return res.json({ ok: true, orderNo, status: existing[8] });

  } catch (err) {
    console.error('[delivery/orders/[id]]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
