/**
 * POST /api/pos/delivery
 * สร้าง delivery order → บันทึก Sheets "ออเดอร์จัดส่ง" → LINE push หาพนักงาน
 *
 * Body: {
 *   shopId, customer_id, customer_name, phone, address, maps_link,
 *   items: [{name, qty, price}], total, payment_method,
 *   staff_id, staff_name, staff_line_id, notes,
 *   cylinders_delivered,  ← จำนวนถังที่ส่งไปกับลูกค้า (สินค้าหมุนเวียน)
 *   created_by            ← LINE user id ของแอดมิน/เจ้าของที่กดสร้างออเดอร์ (audit trail)
 * }
 *
 * GET /api/pos/delivery?shopId               → รายการออเดอร์ทั้งหมด
 * GET /api/pos/delivery?shopId&order_no=xxx  → ดึงออเดอร์เดียว
 * PATCH /api/pos/delivery { shopId, order_no, status, notes, maps_link,
 *   cash_received, goods_received,   ← แอดมิน/ผู้จัดการกดยืนยันรับเงิน/รับของเข้าร้านจริง (Phase B)
 *   confirm_delivery, payment_method, slip_url, confirmed_by, items[].returned_qty  ← พนักงานส่งกดยืนยันจัดส่งสำเร็จ (Phase A)
 * } → อัปเดตสถานะ/พิกัด/รายละเอียด
 */
import { createClient } from '@supabase/supabase-js';
import {
  getAccessToken, readSheet, appendSheet, updateSheetRow, ensureTabExists,
  makeOrderNo, rowToOrder, rowToContact, rowToProduct, ORDER_HEADERS, CONTACT_HEADERS,
} from '../../../lib/google-pos';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

// บังคับให้ Google Sheets เก็บเป็นข้อความล้วน กันเบอร์โทรที่ขึ้นต้นด้วย 0 โดนตัด 0 ทิ้ง
// (valueInputOption=USER_ENTERED ตีความค่าที่หน้าตาเป็นตัวเลขแล้วแปลงเป็นเลขเอง)
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

// ── LINE Flex Message สำหรับพนักงานส่ง ─────────────────────────────────────
function buildDeliveryFlex(order, shopId) {
  const { order_no, customer_name, phone, address, maps_link, items, total, payment_method, notes } = order;

  const itemRows = items.map(item => ({
    type: 'box',
    layout: 'horizontal',
    contents: [
      { type: 'text', text: item.name, flex: 3, size: 'sm', color: '#555555', wrap: true },
      { type: 'text', text: `x${item.qty}`, flex: 1, size: 'sm', align: 'center', color: '#888888' },
      { type: 'text', text: `฿${(item.price * item.qty).toLocaleString()}`, flex: 2, size: 'sm', align: 'end', color: '#111111' },
    ],
  }));

  const payLabel = payment_method === 'ค้างจ่าย' ? '💳 ค้างจ่าย' :
                   payment_method === 'โอนแล้ว'  ? '✅ โอนแล้ว'  : '💵 เก็บเงินปลายทาง';

  const footerContents = [];
  if (maps_link) {
    footerContents.push({
      type: 'button',
      action: { type: 'uri', label: '🗺️ เปิด Google Maps', uri: maps_link },
      style: 'primary',
      color: '#22c55e',
      height: 'sm',
    });
  }

  // ถ้ายังไม่มีพิกัด → เพิ่มปุ่มให้พนักงานบันทึกพิกัด
  if (!maps_link && order_no && shopId) {
    footerContents.push({
      type: 'button',
      action: {
        type: 'uri',
        label: '📍 บันทึกพิกัดส่ง',
        uri: `${process.env.FRONTEND_URL}/pos-location?order_no=${order_no}&shopId=${shopId}`,
      },
      style: 'secondary',
      height: 'sm',
    });
  }

  return {
    type: 'flex',
    altText: `🛵 งานส่งใหม่ ${order_no} — ${customer_name} — ฿${total.toLocaleString()}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '16px',
        backgroundColor: '#16a34a',
        contents: [
          { type: 'text', text: '🛵 งานส่งสินค้า', weight: 'bold', size: 'xl', color: '#ffffff' },
          { type: 'text', text: order_no, size: 'xs', color: '#bbf7d0', margin: 'xs' },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          // ลูกค้า
          {
            type: 'box', layout: 'vertical', spacing: 'xs',
            contents: [
              { type: 'text', text: `👤 ${customer_name}`, weight: 'bold', size: 'md' },
              phone ? { type: 'text', text: `📞 ${phone}`, size: 'sm', color: '#555555' } : null,
              address ? { type: 'text', text: `📍 ${address}`, size: 'sm', color: '#555555', wrap: true } : null,
            ].filter(Boolean),
          },
          { type: 'separator', margin: 'sm' },
          // สินค้า
          ...itemRows,
          { type: 'separator', margin: 'sm' },
          // ยอดและวิธีชำระ
          {
            type: 'box', layout: 'horizontal',
            contents: [
              { type: 'text', text: payLabel, flex: 3, size: 'sm', weight: 'bold' },
              { type: 'text', text: `฿${total.toLocaleString()}`, flex: 2, size: 'lg', align: 'end', weight: 'bold', color: '#16a34a' },
            ],
          },
          // หมายเหตุ
          notes ? { type: 'text', text: `📝 ${notes}`, size: 'sm', color: '#888888', wrap: true, margin: 'xs' } : null,
        ].filter(Boolean),
      },
      footer: footerContents.length ? {
        type: 'box', layout: 'vertical', spacing: 'sm', contents: footerContents,
      } : undefined,
    },
  };
}

async function pushLineMessage(lineId, message) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token || !lineId) return;
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: lineId, messages: [message] }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error('[delivery] LINE push error:', err);
  }
}

export default async function handler(req, res) {
  const shopId = req.query.shopId || req.body?.shopId;
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });

  try {
    const { sheetId, token } = await getConfig(shopId);
    await ensureTabExists(token, sheetId, 'ออเดอร์จัดส่ง', ORDER_HEADERS);

    // ── GET — รายการออเดอร์ ─────────────────────────────────────────────────
    if (req.method === 'GET') {
      const rows = await readSheet(token, sheetId, 'ออเดอร์จัดส่ง!A:T');
      const orders = rows.slice(1)
        .map((r, i) => ({ ...rowToOrder(r), _row: i + 2 }))
        .filter(o => o.order_no)
        .reverse(); // ล่าสุดก่อน

      // ถ้าระบุ order_no → คืนเดี่ยว
      if (req.query.order_no) {
        const order = orders.find(o => o.order_no === req.query.order_no);
        return res.json({ order: order || null });
      }

      return res.json({ orders });
    }

    // ── POST — สร้างออเดอร์ใหม่ ─────────────────────────────────────────────
    if (req.method === 'POST') {
      const {
        customer_id = '', customer_name, phone = '', address = '', maps_link = '',
        items = [], total = 0, payment_method = 'เก็บปลายทาง',
        staff_id = '', staff_name = '', staff_line_id = '', notes = '',
        cylinders_delivered = 0, created_by = '',
      } = req.body;

      if (!customer_name) return res.status(400).json({ error: 'ต้องระบุชื่อลูกค้า' });
      if (!items.length) return res.status(400).json({ error: 'ต้องมีสินค้าอย่างน้อย 1 รายการ' });

      const order_no = makeOrderNo();
      const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });

      await appendSheet(token, sheetId, 'ออเดอร์จัดส่ง', [
        order_no, now, customer_id, customer_name, asText(phone),
        address, maps_link, JSON.stringify(items), total,
        payment_method, staff_id, staff_name, 'รอจัดส่ง', notes,
        '', '', '', '', '', created_by,
      ]);

      // ถ้าค้างจ่าย → อัปเดตยอดหนี้ผู้ติดต่ออัตโนมัติ
      if (payment_method === 'ค้างจ่าย' && customer_id) {
        try {
          await ensureTabExists(token, sheetId, 'ผู้ติดต่อ', CONTACT_HEADERS);
          const custRows = await readSheet(token, sheetId, 'ผู้ติดต่อ!A:T');
          const custDataRows = custRows.slice(1);
          const custIdx = custDataRows.findIndex(r => r[0] === customer_id);
          if (custIdx !== -1) {
            const cust = rowToContact(custDataRows[custIdx]);
            const existing = [...custDataRows[custIdx]];
            while (existing.length < 20) existing.push('');
            existing[13] = (cust.debt || 0) + total; // ยอดค้างชำระ (col N)
            existing[19] = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }); // updated_at
            await updateSheetRow(token, sheetId, 'ผู้ติดต่อ', custIdx + 2, existing);
          }
        } catch (debtErr) {
          console.error('[delivery] update customer debt error:', debtErr.message);
        }
      }

      // อัปเดตจำนวนถังกับลูกค้า (สินค้าหมุนเวียน)
      if (cylinders_delivered > 0 && customer_id) {
        try {
          await ensureTabExists(token, sheetId, 'ผู้ติดต่อ', CONTACT_HEADERS);
          const custRows = await readSheet(token, sheetId, 'ผู้ติดต่อ!A:T');
          const custDataRows = custRows.slice(1);
          const custIdx = custDataRows.findIndex(r => r[0] === customer_id);
          if (custIdx !== -1) {
            const cust = rowToContact(custDataRows[custIdx]);
            const existing = [...custDataRows[custIdx]];
            while (existing.length < 20) existing.push('');
            existing[14] = (cust.cylinders || 0) + cylinders_delivered; // ถังอยู่กับลูกค้า (col O)
            existing[19] = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }); // updated_at
            await updateSheetRow(token, sheetId, 'ผู้ติดต่อ', custIdx + 2, existing);
          }
        } catch (cylErr) {
          console.error('[delivery] update customer cylinders error:', cylErr.message);
        }
      }

      // LINE push หาพนักงาน
      if (staff_line_id) {
        const flexMsg = buildDeliveryFlex({
          order_no, customer_name, phone, address, maps_link,
          items, total, payment_method, notes,
        }, shopId);
        await pushLineMessage(staff_line_id, flexMsg);
      }

      return res.json({ ok: true, order_no });
    }

    // ── PATCH — แก้ไขออเดอร์ (สถานะ, พิกัด, หรือรายละเอียดเต็ม เช่น เปลี่ยนผู้ส่ง) ──
    // confirm_delivery: true → พนักงานส่งกดยืนยันจัดส่งสำเร็จจากหน้า pos-staff
    //   items ที่ส่งมาสามารถมี returned_qty ต่อรายการ (เฉพาะสินค้าประเภทหมุนเวียน) —
    //   ใช้อัปเดตสต็อค "เปล่ารอรีฟิล" ของสินค้า + ลดยอด "ถังอยู่กับลูกค้า" ของผู้ติดต่อ
    if (req.method === 'PATCH') {
      const {
        order_no, status, notes, maps_link,
        customer_id, customer_name, phone, address,
        items, total, payment_method, staff_id, staff_name,
        confirm_delivery, slip_url, confirmed_by, cash_received, goods_received,
      } = req.body;
      if (!order_no) return res.status(400).json({ error: 'Missing order_no' });

      const rows = await readSheet(token, sheetId, 'ออเดอร์จัดส่ง!A:T');
      const dataRows = rows.slice(1);
      const idx = dataRows.findIndex(r => r[0] === order_no);
      if (idx === -1) return res.status(404).json({ error: 'ไม่พบออเดอร์' });

      const existing = [...dataRows[idx]];
      while (existing.length < 20) existing.push('');
      if (customer_id     !== undefined) existing[2]  = customer_id;
      if (customer_name   !== undefined) existing[3]  = customer_name;
      if (phone           !== undefined) existing[4]  = asText(phone);
      if (address         !== undefined) existing[5]  = address;
      if (maps_link       !== undefined) existing[6]  = maps_link;
      if (items           !== undefined) existing[7]  = JSON.stringify(items);
      if (total           !== undefined) existing[8]  = total;
      if (payment_method  !== undefined) existing[9]  = payment_method;
      if (staff_id        !== undefined) existing[10] = staff_id;
      if (staff_name      !== undefined) existing[11] = staff_name;
      if (status          !== undefined) existing[12] = status;
      if (notes           !== undefined) existing[13] = notes;
      if (slip_url        !== undefined) existing[14] = slip_url;
      if (cash_received   !== undefined) existing[17] = cash_received ? 'TRUE' : 'FALSE';
      if (goods_received  !== undefined) existing[18] = goods_received ? 'TRUE' : 'FALSE';

      if (confirm_delivery) {
        existing[12] = 'ส่งแล้ว'; // ใช้ label เดียวกับสถานะที่แอดมินกดเปลี่ยนเองในหน้า pos.js
        existing[15] = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
        if (confirmed_by !== undefined) existing[16] = confirmed_by;

        // อัปเดตสต็อคสินค้าหมุนเวียนที่ลูกค้าคืนถังเปล่ามา + ลดยอดถังค้างที่ลูกค้า
        const cust = customer_id !== undefined ? customer_id : existing[2];
        const returnedTotal = (items || []).reduce((sum, i) => sum + (parseInt(i.returned_qty) || 0), 0);

        if (Array.isArray(items) && items.length) {
          try {
            const prodRows = await readSheet(token, sheetId, 'สินค้า!A:R');
            const prodDataRows = prodRows.slice(1);
            for (const item of items) {
              const returnedQty = parseInt(item.returned_qty) || 0;
              if (returnedQty <= 0 || !item.sku) continue;
              const pIdx = prodDataRows.findIndex(r => r[0] === item.sku);
              if (pIdx === -1) continue;
              const prod = rowToProduct(prodDataRows[pIdx]);
              if (prod.type !== 'หมุนเวียน') continue;
              const prodExisting = [...prodDataRows[pIdx]];
              while (prodExisting.length < 18) prodExisting.push('');
              prodExisting[12] = (prod.empty_waiting || 0) + returnedQty; // เปล่ารอรีฟิล
              prodExisting[9] = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
              await updateSheetRow(token, sheetId, 'สินค้า', pIdx + 2, prodExisting);
              prodDataRows[pIdx] = prodExisting;
            }
          } catch (prodErr) {
            console.error('[delivery] update product empty_waiting error:', prodErr.message);
          }
        }

        if (returnedTotal > 0 && cust) {
          try {
            await ensureTabExists(token, sheetId, 'ผู้ติดต่อ', CONTACT_HEADERS);
            const custRows = await readSheet(token, sheetId, 'ผู้ติดต่อ!A:W');
            const custDataRows = custRows.slice(1);
            const custIdx = custDataRows.findIndex(r => r[0] === cust);
            if (custIdx !== -1) {
              const custRow = rowToContact(custDataRows[custIdx]);
              const custExisting = [...custDataRows[custIdx]];
              while (custExisting.length < 23) custExisting.push('');
              custExisting[14] = Math.max(0, (custRow.cylinders || 0) - returnedTotal); // ถังอยู่กับลูกค้า
              custExisting[19] = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
              await updateSheetRow(token, sheetId, 'ผู้ติดต่อ', custIdx + 2, custExisting);
            }
          } catch (custErr) {
            console.error('[delivery] update customer cylinders on return error:', custErr.message);
          }
        }
      }

      await updateSheetRow(token, sheetId, 'ออเดอร์จัดส่ง', idx + 2, existing);
      return res.json({ ok: true, order_no });
    }

    // ── DELETE — ลบออเดอร์ (เช่น ลูกค้ามารับเองแทนการจัดส่ง) ──────────────────
    if (req.method === 'DELETE') {
      const { order_no } = req.body;
      if (!order_no) return res.status(400).json({ error: 'Missing order_no' });

      const rows = await readSheet(token, sheetId, 'ออเดอร์จัดส่ง!A:T');
      const idx = rows.slice(1).findIndex(r => r[0] === order_no);
      if (idx === -1) return res.status(404).json({ error: 'ไม่พบออเดอร์' });

      await updateSheetRow(token, sheetId, 'ออเดอร์จัดส่ง', idx + 2, Array(20).fill(''));
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('[pos/delivery]', err.message);
    if (err.notSetup) return res.status(400).json({ error: err.message, notSetup: true });
    if (err.notConnected) return res.status(400).json({ error: err.message, notConnected: true });
    return res.status(500).json({ error: err.message });
  }
}
