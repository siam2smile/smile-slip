/**
 * GET /api/delivery/customers?shopId=xxx&phone=0812345678  → ค้นหา exact
 * GET /api/delivery/customers?shopId=xxx&q=ชื่อ           → ค้นหา fuzzy
 * POST /api/delivery/customers { shopId, phone, name, address, coords, notes }
 *   → upsert (อัปเดตถ้ามีเบอร์นี้อยู่แล้ว / เพิ่มใหม่ถ้าไม่มี)
 *
 * ข้อมูลทั้งหมดเก็บใน Google Sheets ของร้านค้า (PDPA compliant)
 */
import { createClient } from '@supabase/supabase-js';
import {
  getAccessToken, readSheet, appendSheet, updateSheetRow,
  rowToCustomer, CUSTOMER_HEADERS,
} from '../../../lib/google-delivery';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

async function getSheetAccess(shopId) {
  const [{ data: dc }, { data: gc }] = await Promise.all([
    supabase.from('delivery_configs').select('customer_sheet_id').eq('shop_id', shopId).single(),
    supabase.from('shop_google_configs').select('google_refresh_token').eq('shop_id', shopId).single(),
  ]);
  if (!dc?.customer_sheet_id) throw { status: 400, message: 'ยังไม่ได้ตั้งค่า Delivery', notSetup: true };
  if (!gc?.google_refresh_token) throw { status: 400, message: 'ยังไม่ได้เชื่อมต่อ Google', notConnected: true };
  const accessToken = await getAccessToken(gc.google_refresh_token);
  return { accessToken, sheetId: dc.customer_sheet_id };
}

export default async function handler(req, res) {
  const shopId = req.query.shopId || req.body?.shopId;
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });

  try {
    const { accessToken, sheetId } = await getSheetAccess(shopId);

    // GET — ค้นหาลูกค้า
    if (req.method === 'GET') {
      const rows = await readSheet(accessToken, sheetId, 'Sheet1!A:G');
      const dataRows = rows.slice(1); // ข้าม header

      const { phone, q } = req.query;

      // exact match ด้วยเบอร์โทร
      if (phone) {
        const rowIndex = dataRows.findIndex(r => (r[0] || '').trim() === phone.trim());
        if (rowIndex === -1) return res.json({ customer: null });
        const customer = rowToCustomer(dataRows[rowIndex]);

        // นับออเดอร์ (อ่านจาก order sheet)
        const { data: dc } = await supabase
          .from('delivery_configs').select('order_sheet_id').eq('shop_id', shopId).single();
        let orderCount = 0;
        if (dc?.order_sheet_id) {
          const orderRows = await readSheet(accessToken, dc.order_sheet_id, 'Sheet1!C:C');
          orderCount = orderRows.slice(1).filter(r => (r[0] || '').trim() === phone.trim()).length;
        }

        return res.json({ customer: { ...customer, order_count: orderCount, rowIndex: rowIndex + 2 } });
      }

      // fuzzy search
      const searchTerm = (q || '').toLowerCase();
      const customers = dataRows
        .map((row, i) => ({ ...rowToCustomer(row), rowIndex: i + 2 }))
        .filter(c =>
          !searchTerm ||
          c.phone.includes(searchTerm) ||
          c.name.toLowerCase().includes(searchTerm)
        )
        .slice(0, 100);

      return res.json({ customers });
    }

    // POST — upsert ลูกค้า
    if (req.method === 'POST') {
      const { phone, name, address, coords, notes } = req.body;
      if (!phone) return res.status(400).json({ error: 'Missing phone' });

      const rows = await readSheet(accessToken, sheetId, 'Sheet1!A:G');
      const dataRows = rows.slice(1);
      const existingIndex = dataRows.findIndex(r => (r[0] || '').trim() === phone.trim());
      const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });

      if (existingIndex >= 0) {
        // อัปเดตแถวที่มีอยู่ (เก็บ created_at เดิม)
        const existing = dataRows[existingIndex];
        const updatedRow = [
          phone.trim(),
          name || existing[1] || '',
          address || existing[2] || '',
          coords || existing[3] || '',
          notes !== undefined ? notes : (existing[4] || ''),
          existing[5] || now, // created_at เดิม
          now,               // updated_at
        ];
        await updateSheetRow(accessToken, sheetId, 'Sheet1', existingIndex + 2, updatedRow);
        return res.json({ ok: true, action: 'updated', customer: rowToCustomer(updatedRow) });
      } else {
        // เพิ่มใหม่
        const newRow = [
          phone.trim(),
          name || '',
          address || '',
          coords || '',
          notes || '',
          now,
          now,
        ];
        await appendSheet(accessToken, sheetId, 'Sheet1', newRow);
        return res.json({ ok: true, action: 'created', customer: rowToCustomer(newRow) });
      }
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, ...err });
    console.error('[delivery/customers]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
