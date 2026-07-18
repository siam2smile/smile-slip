/**
 * GET /api/delivery/orders?shopId=xxx&status=pending&driver=xxx&phone=xxx
 *   → อ่านจาก Order Sheet กรองตาม status/driver/phone
 * POST /api/delivery/orders { shopId, phone, customerName, deliveryAddress, coords, items, totalAmount, notes, driverName }
 *   → append row ลง Order Sheet + upsert Customer Sheet
 *
 * ข้อมูลทั้งหมดเก็บใน Google Sheets ของร้านค้า (PDPA compliant)
 */
import { createClient } from '@supabase/supabase-js';
import {
  getAccessToken, readSheet, appendSheet,
  rowToOrder, makeOrderNo,
} from '../../../lib/google-delivery';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

async function getSheetAccess(shopId) {
  const [{ data: dc }, { data: gc }] = await Promise.all([
    supabase.from('delivery_configs').select('order_sheet_id, customer_sheet_id').eq('shop_id', shopId).single(),
    supabase.from('shop_google_configs').select('google_refresh_token').eq('shop_id', shopId).single(),
  ]);
  if (!dc?.order_sheet_id) throw { status: 400, message: 'ยังไม่ได้ตั้งค่า Delivery', notSetup: true };
  if (!gc?.google_refresh_token) throw { status: 400, message: 'ยังไม่ได้เชื่อมต่อ Google', notConnected: true };
  const accessToken = await getAccessToken(gc.google_refresh_token);
  return { accessToken, orderSheetId: dc.order_sheet_id, customerSheetId: dc.customer_sheet_id };
}

export default async function handler(req, res) {
  const shopId = req.query.shopId || req.body?.shopId;
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });

  try {
    const { accessToken, orderSheetId, customerSheetId } = await getSheetAccess(shopId);

    // GET
    if (req.method === 'GET') {
      const rows = await readSheet(accessToken, orderSheetId, 'Sheet1!A:N');
      const dataRows = rows.slice(1);

      const { status, driver, phone } = req.query;

      let orders = dataRows.map((row, i) => ({ ...rowToOrder(row), _rowIndex: i + 2 }));

      if (status && status !== 'all') orders = orders.filter(o => o.status === status);
      if (driver)  orders = orders.filter(o => o.driver_name === driver);
      if (phone)   orders = orders.filter(o => o.customer_phone === phone);

      // เรียงจากใหม่สุด
      orders.reverse();

      // แปลง items_text กลับเป็น array สำหรับ UI
      orders = orders.map(o => ({
        ...o,
        items: parseItems(o.items_text),
      }));

      return res.json({ orders });
    }

    // POST — สร้างออเดอร์
    if (req.method === 'POST') {
      const {
        phone, customerName, deliveryAddress, coords,
        items, totalAmount, notes, driverName,
      } = req.body;

      if (!phone || !customerName) return res.status(400).json({ error: 'Missing phone or customerName' });

      const orderNo = makeOrderNo();
      const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
      const status = driverName ? 'assigned' : 'pending';
      const itemsText = (items || [])
        .map(it => `${it.name} x${it.qty} = ฿${(parseFloat(it.price || 0) * parseInt(it.qty || 1)).toFixed(0)}`)
        .join(', ');

      const orderRow = [
        orderNo,
        now,
        phone.trim(),
        customerName.trim(),
        deliveryAddress || '',
        coords || '',
        itemsText,
        parseFloat(totalAmount || 0).toFixed(2),
        status,
        driverName || '',
        '',   // payment_method
        '',   // delivered_at
        '',   // paid_at
        notes || '',
      ];

      await appendSheet(accessToken, orderSheetId, 'Sheet1', orderRow);

      // upsert customer (อัปเดตที่อยู่ถ้าส่งมา)
      if (customerSheetId) {
        try {
          const { default: custHandler } = await import('./customers.js');
          // เรียกตรงๆ ผ่าน Sheets helper แทน
          const { readSheet: rs, appendSheet: as, updateSheetRow: us, rowToCustomer: rc } = await import('../../../lib/google-delivery.js');
          const custRows = await rs(accessToken, customerSheetId, 'Sheet1!A:G');
          const custData = custRows.slice(1);
          const existIdx = custData.findIndex(r => (r[0] || '').trim() === phone.trim());
          const nowStr = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });

          if (existIdx >= 0) {
            const ex = custData[existIdx];
            await us(accessToken, customerSheetId, 'Sheet1', existIdx + 2, [
              phone.trim(), customerName.trim(),
              deliveryAddress || ex[2] || '',
              coords || ex[3] || '',
              ex[4] || '', ex[5] || nowStr, nowStr,
            ]);
          } else {
            await as(accessToken, customerSheetId, 'Sheet1', [
              phone.trim(), customerName.trim(),
              deliveryAddress || '', coords || '', '', nowStr, nowStr,
            ]);
          }
        } catch (e) {
          console.warn('[delivery/orders] customer upsert failed:', e.message);
        }
      }

      return res.json({ ok: true, orderNo, status });
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, ...err });
    console.error('[delivery/orders]', err.message);
    return res.status(500).json({ error: err.message });
  }
}

// แปลง items text กลับเป็น array
function parseItems(text) {
  if (!text) return [];
  return text.split(', ').map(part => {
    const m = part.match(/^(.+) x(\d+) = ฿([\d.]+)$/);
    if (!m) return { name: part, qty: 1, price: '0' };
    return { name: m[1], qty: parseInt(m[2]), price: (parseFloat(m[3]) / parseInt(m[2])).toFixed(0) };
  });
}
