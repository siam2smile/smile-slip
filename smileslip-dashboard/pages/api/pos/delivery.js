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
import { blockIfTrialExpired } from '../../../lib/shop-access';
import { hasFeature, upgradeMessage } from '../../../lib/tier-features';
import {
  getAccessToken, readSheet, appendSheet, updateSheetRow, ensureTabExists,
  makeOrderNo, rowToOrder, rowToContact, rowToProduct, ORDER_HEADERS, CONTACT_HEADERS,
  logCyclicalTransaction,
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
  const [{ data: pc }, { data: gc }, { data: sp }] = await Promise.all([
    supabase.from('pos_configs').select('pos_sheet_id').eq('shop_id', shopId).single(),
    supabase.from('shop_google_configs').select('google_refresh_token').eq('shop_id', shopId).single(),
    supabase.from('shop_profiles').select('subscription_tier').eq('id', shopId).maybeSingle(),
  ]);
  if (!pc?.pos_sheet_id) throw Object.assign(new Error('ยังไม่ได้ตั้งค่า POS'), { notSetup: true });
  if (!gc?.google_refresh_token) throw Object.assign(new Error('ยังไม่ได้เชื่อมต่อ Google'), { notConnected: true });
  return { sheetId: pc.pos_sheet_id, tier: sp?.subscription_tier || 'normal', token: await getAccessToken(gc.google_refresh_token) };
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
  // ปุ่มหลัก: เปิดหน้ายืนยันจัดส่ง (pos-staff) — เข้าด้วย PIN ร้าน แล้วพากดยืนยันจัดส่งออเดอร์นี้ได้ทันที
  if (order_no && shopId) {
    footerContents.push({
      type: 'button',
      action: {
        type: 'uri',
        label: '✅ เปิดหน้ายืนยันจัดส่ง',
        uri: `${process.env.FRONTEND_URL}/pos-staff?shopId=${shopId}&order_no=${order_no}`,
      },
      style: 'primary',
      color: '#2563eb',
      height: 'sm',
    });
  }
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

  // เขียนไม่ได้ถ้าทดลองใช้ 30 วันหมดอายุแล้ว (อ่าน/GET ยังทำได้ปกติเสมอ)
  if (req.method !== 'GET' && (await blockIfTrialExpired(req, res, shopId))) return;


  try {
    const { sheetId, tier, token } = await getConfig(shopId);
    await ensureTabExists(token, sheetId, 'ออเดอร์จัดส่ง', ORDER_HEADERS);

    // ── GET — รายการออเดอร์ ─────────────────────────────────────────────────
    if (req.method === 'GET') {
      const rows = await readSheet(token, sheetId, 'ออเดอร์จัดส่ง!A:U');
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
      // จำนวน/ราคาต้องไม่ติดลบ (แบบเดียวกับ sales.js — กันสต็อคเพี้ยนตอนยืนยันจัดส่งภายหลัง)
      if (items.some(i => !(parseFloat(i.qty) > 0))) {
        return res.status(400).json({ error: 'จำนวนสินค้าต้องมากกว่า 0 ทุกรายการ' });
      }
      if (items.some(i => parseFloat(i.price) < 0)) {
        return res.status(400).json({ error: 'ราคาสินค้าต้องไม่ติดลบ' });
      }
      if (payment_method === 'ค้างจ่าย' && !hasFeature(tier, 'credit_ar')) {
        return res.status(403).json({ error: upgradeMessage('credit_ar'), featureLocked: true });
      }

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

      // อัปเดตจำนวนถังกับลูกค้า (สินค้าหมุนเวียน) + เช็ควงเงินยืมสูงสุด (soft warning ไม่บล็อค)
      const deliveryWarnings = [];
      // เตือน (ไม่บล็อค) ถ้าสร้างออเดอร์โดยไม่มีที่อยู่/เบอร์โทร/ลิงก์แผนที่ — พนักงานส่งของจะเปิดมาเจอ
      // ไม่มีทางติดต่อ/หาที่อยู่ลูกค้าเลย และถ้ายอดรวมเป็น 0 ทั้งที่มีสินค้า อาจเป็นราคาที่กรอกผิด
      if (!address.trim()) deliveryWarnings.push('⚠️ ไม่ได้กรอกที่อยู่จัดส่ง');
      if (!maps_link.trim()) deliveryWarnings.push('⚠️ ไม่ได้ปักหมุดแผนที่ — พนักงานส่งจะไม่มีลิงก์แผนที่ให้กด');
      if (!phone.trim()) deliveryWarnings.push('⚠️ ไม่ได้กรอกเบอร์โทรลูกค้า');
      if (total <= 0 && items.length) deliveryWarnings.push('⚠️ ยอดรวมออเดอร์เป็น 0 บาท ทั้งที่มีรายการสินค้า');
      if (cylinders_delivered > 0 && customer_id) {
        try {
          await ensureTabExists(token, sheetId, 'ผู้ติดต่อ', CONTACT_HEADERS);
          const custRows = await readSheet(token, sheetId, 'ผู้ติดต่อ!A:X');
          const custDataRows = custRows.slice(1);
          const custIdx = custDataRows.findIndex(r => r[0] === customer_id);
          if (custIdx !== -1) {
            const cust = rowToContact(custDataRows[custIdx]);
            const existing = [...custDataRows[custIdx]];
            while (existing.length < 24) existing.push('');
            const newCylinders = (cust.cylinders || 0) + cylinders_delivered;
            existing[14] = newCylinders; // ถังอยู่กับลูกค้า (col O)
            existing[19] = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }); // updated_at
            if (cust.cylinder_limit > 0 && newCylinders > cust.cylinder_limit) {
              deliveryWarnings.push(`⚠️ ลูกค้ายืมสินค้าหมุนเวียนเกินวงเงินที่ตั้งไว้ (${newCylinders}/${cust.cylinder_limit})`);
            }
            await updateSheetRow(token, sheetId, 'ผู้ติดต่อ', custIdx + 2, existing);
          }
        } catch (cylErr) {
          console.error('[delivery] update customer cylinders error:', cylErr.message);
        }
        // audit log — ยืมสินค้าหมุนเวียนไปกับออเดอร์จัดส่งนี้ (รวมเป็นยอดเดียว ไม่แยกราย SKU
        // เพราะ cylinders_delivered ที่ส่งมาเป็นยอดรวมอยู่แล้ว ไม่ได้แยกต่อสินค้า)
        await logCyclicalTransaction(token, sheetId, {
          shopId,
          sku: '', name: 'สินค้าหมุนเวียน (รวม)', source: 'จัดส่ง', action: 'ยืม',
          qty: cylinders_delivered, customerId: customer_id, customerName: customer_name,
          performedBy: staff_name || created_by,
        });
      }

      // LINE push หาพนักงาน
      if (staff_line_id) {
        const flexMsg = buildDeliveryFlex({
          order_no, customer_name, phone, address, maps_link,
          items, total, payment_method, notes,
        }, shopId);
        await pushLineMessage(staff_line_id, flexMsg);
      }

      return res.json({ ok: true, order_no, warnings: deliveryWarnings });
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
        confirm_delivery, slip_url, confirmed_by, cash_received, goods_received, credit_settled,
        partial_paid_amount,
      } = req.body;
      if (!order_no) return res.status(400).json({ error: 'Missing order_no' });

      const rows = await readSheet(token, sheetId, 'ออเดอร์จัดส่ง!A:U');
      const dataRows = rows.slice(1);
      const idx = dataRows.findIndex(r => r[0] === order_no);
      if (idx === -1) return res.status(404).json({ error: 'ไม่พบออเดอร์' });

      const existing = [...dataRows[idx]];
      while (existing.length < 21) existing.push('');
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

      // ── ยืนยันรับชำระเงินเชื่อ (ออเดอร์จัดส่งที่จ่ายแบบ "ค้างจ่าย") ──────────────
      // ลดยอด "ยอดค้างชำระ" ของผู้ติดต่อกลับลง (ตอนสร้างออเดอร์ ค้างจ่าย เคยบวกยอดนี้ไว้แล้ว)
      if (credit_settled === true && !existing[20]) {
        existing[20] = 'TRUE';
        const custId = customer_id !== undefined ? customer_id : existing[2];
        const orderTotal = parseFloat(existing[8]) || 0;
        if (custId && orderTotal > 0) {
          try {
            await ensureTabExists(token, sheetId, 'ผู้ติดต่อ', CONTACT_HEADERS);
            const custRows = await readSheet(token, sheetId, 'ผู้ติดต่อ!A:W');
            const custDataRows = custRows.slice(1);
            const custIdx = custDataRows.findIndex(r => r[0] === custId);
            if (custIdx !== -1) {
              const custRow = rowToContact(custDataRows[custIdx]);
              const custExisting = [...custDataRows[custIdx]];
              while (custExisting.length < 23) custExisting.push('');
              custExisting[13] = Math.max(0, (custRow.debt || 0) - orderTotal); // ยอดค้างชำระ
              custExisting[19] = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
              await updateSheetRow(token, sheetId, 'ผู้ติดต่อ', custIdx + 2, custExisting);
            }
          } catch (debtErr) {
            console.error('[delivery] settle credit debt error:', debtErr.message);
          }
        }
      }

      let debtAdded = 0;
      if (confirm_delivery) {
        existing[12] = 'ส่งแล้ว'; // ใช้ label เดียวกับสถานะที่แอดมินกดเปลี่ยนเองในหน้า pos.js
        existing[15] = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
        if (confirmed_by !== undefined) existing[16] = confirmed_by;

        // อัปเดตสต็อคสินค้าหมุนเวียน + ยอดถังอยู่กับลูกค้า — mirror ตรรกะเดียวกับ api/pos/sales.js checkout
        // เดิมโค้ดนี้ทำงานเฉพาะตอนมี returnedQty>0 (ลูกค้าคืนถังมา) เท่านั้น ทำให้:
        //   (1) เคสยืมล้วนๆ (returned_qty=0/ไม่ส่งมา) ไม่ถูกนับเป็น "กับลูกค้า" ที่สินค้าเลย (at_customer ค้างเดิม)
        //   (2) contact.cylinders ถูกลบด้วย returnedTotal ตรงๆ ทั้งที่ไม่เคยถูกบวกเพิ่มตอนส่งของเลยสักครั้ง
        // แก้โดยไล่ทุกรายการสินค้าหมุนเวียนในออเดอร์เสมอ คำนวณ netBorrow = qty - returnedQty ต่อชิ้น
        // แล้วอัปเดตทั้งสต็อคสินค้า (เต็ม/กับลูกค้า/เปล่ารอรีฟิล) และยอดถังของลูกค้าด้วยผลสุทธิจริง
        const cust = customer_id !== undefined ? customer_id : existing[2];
        let netCylinderDeltaForCustomer = 0;

        // พนักงานเลือก "ค้างจ่าย" ตอนยืนยันจัดส่ง (คนละจุดกับตอนสร้างออเดอร์ — อาจเลือกวิธีจ่ายจริง
        // ไม่ตรงกับตอนสร้างออเดอร์ก็ได้ เช่น สร้างไว้เป็น "เก็บปลายทาง" แต่ลูกค้าจ่ายไม่ครบตอนส่งจริง)
        // เดิมกรณีนี้ไม่เคยเพิ่มยอดค้างชำระของลูกค้าเลยสักครั้ง (บั๊กจริง เจอระหว่างทำฟีเจอร์จ่ายบางส่วน)
        // — รองรับจ่ายมาบางส่วนได้ด้วย: ค้างชำระ = ยอดสุทธิ - จ่ายมาแล้ว (ไม่ต่ำกว่า 0)
        if (payment_method === 'ค้างจ่าย' && cust) {
          const orderTotal = total !== undefined ? parseFloat(total) || 0 : parseFloat(existing[8]) || 0;
          const paidNow = Math.min(orderTotal, Math.max(0, parseFloat(partial_paid_amount) || 0));
          debtAdded = Math.round((orderTotal - paidNow) * 100) / 100;
          if (debtAdded > 0) {
            try {
              await ensureTabExists(token, sheetId, 'ผู้ติดต่อ', CONTACT_HEADERS);
              const custRows = await readSheet(token, sheetId, 'ผู้ติดต่อ!A:W');
              const custDataRows = custRows.slice(1);
              const custIdx = custDataRows.findIndex(r => r[0] === cust);
              if (custIdx !== -1) {
                const custRow = rowToContact(custDataRows[custIdx]);
                const custExisting = [...custDataRows[custIdx]];
                while (custExisting.length < 23) custExisting.push('');
                custExisting[13] = (custRow.debt || 0) + debtAdded; // ยอดค้างชำระ
                custExisting[19] = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
                await updateSheetRow(token, sheetId, 'ผู้ติดต่อ', custIdx + 2, custExisting);
              }
            } catch (debtErr) {
              console.error('[delivery] confirm_delivery add debt error:', debtErr.message);
            }
          }
        }

        if (Array.isArray(items) && items.length) {
          try {
            const prodRows = await readSheet(token, sheetId, 'สินค้า!A:R');
            const prodDataRows = prodRows.slice(1);
            for (const item of items) {
              if (!item.sku) continue;
              const pIdx = prodDataRows.findIndex(r => r[0] === item.sku);
              if (pIdx === -1) continue;
              const prod = rowToProduct(prodDataRows[pIdx]);
              if (prod.type !== 'หมุนเวียน') continue;

              // qty ติดลบเคยทำให้ยืนยันจัดส่ง "เพิ่ม" สต็อคแทนที่จะลด (stock - (-qty) = stock + qty)
              const qty = Math.max(0, parseInt(item.qty) || 0);
              const returnedQty = Math.min(qty, Math.max(0, parseInt(item.returned_qty) || 0));
              const netBorrow = qty - returnedQty;

              const prodExisting = [...prodDataRows[pIdx]];
              while (prodExisting.length < 18) prodExisting.push('');
              prodExisting[5]  = Math.max(0, (parseFloat(prodExisting[5]) || 0) - qty); // เต็ม — ออกจากร้านไปกับลูกค้า
              prodExisting[11] = Math.max(0, (parseFloat(prodExisting[11]) || 0) + netBorrow); // กับลูกค้า สุทธิ
              prodExisting[12] = (parseFloat(prodExisting[12]) || 0) + returnedQty; // เปล่ารอรีฟิล
              prodExisting[9]  = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
              await updateSheetRow(token, sheetId, 'สินค้า', pIdx + 2, prodExisting);
              prodDataRows[pIdx] = prodExisting;
              netCylinderDeltaForCustomer += netBorrow;

              if (returnedQty > 0) {
                await logCyclicalTransaction(token, sheetId, {
                  shopId,
                  sku: item.sku, name: item.name || prod.name, source: 'จัดส่ง',
                  action: netBorrow > 0 ? 'แลกเปลี่ยน' : 'คืน',
                  qty: returnedQty, customerId: cust, customerName: existing[3],
                  performedBy: confirmed_by,
                });
              }
              if (netBorrow > 0) {
                await logCyclicalTransaction(token, sheetId, {
                  shopId,
                  sku: item.sku, name: item.name || prod.name, source: 'จัดส่ง', action: 'ยืม',
                  qty: netBorrow, customerId: cust, customerName: existing[3],
                  performedBy: confirmed_by,
                });
              }
            }
          } catch (prodErr) {
            console.error('[delivery] update product cyclical stock error:', prodErr.message);
          }
        }

        if (netCylinderDeltaForCustomer !== 0 && cust) {
          try {
            await ensureTabExists(token, sheetId, 'ผู้ติดต่อ', CONTACT_HEADERS);
            const custRows = await readSheet(token, sheetId, 'ผู้ติดต่อ!A:W');
            const custDataRows = custRows.slice(1);
            const custIdx = custDataRows.findIndex(r => r[0] === cust);
            if (custIdx !== -1) {
              const custRow = rowToContact(custDataRows[custIdx]);
              const custExisting = [...custDataRows[custIdx]];
              while (custExisting.length < 23) custExisting.push('');
              custExisting[14] = Math.max(0, (custRow.cylinders || 0) + netCylinderDeltaForCustomer); // ถังอยู่กับลูกค้า
              custExisting[19] = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
              await updateSheetRow(token, sheetId, 'ผู้ติดต่อ', custIdx + 2, custExisting);
            }
          } catch (custErr) {
            console.error('[delivery] update customer cylinders error:', custErr.message);
          }
        }
      }

      await updateSheetRow(token, sheetId, 'ออเดอร์จัดส่ง', idx + 2, existing);
      return res.json({ ok: true, order_no, debtAdded });
    }

    // ── DELETE — ลบออเดอร์ (เช่น ลูกค้ามารับเองแทนการจัดส่ง) ──────────────────
    if (req.method === 'DELETE') {
      const { order_no } = req.body;
      if (!order_no) return res.status(400).json({ error: 'Missing order_no' });

      const rows = await readSheet(token, sheetId, 'ออเดอร์จัดส่ง!A:U');
      const idx = rows.slice(1).findIndex(r => r[0] === order_no);
      if (idx === -1) return res.status(404).json({ error: 'ไม่พบออเดอร์' });

      await updateSheetRow(token, sheetId, 'ออเดอร์จัดส่ง', idx + 2, Array(21).fill(''));
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
