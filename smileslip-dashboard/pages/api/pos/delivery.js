/**
 * POST /api/pos/delivery
 * สร้าง delivery order → บันทึก Supabase (pos_delivery_orders) → LINE push หาพนักงาน
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
 *
 * Phase 2 (write-primary flip, 2026-07-29): อ่าน/เขียนจาก Supabase (pos_delivery_orders/
 * pos_products/pos_contacts) โดยตรงแล้ว ไม่ผ่าน Google Sheets/Google connection อีกต่อไป
 */
import { createClient } from '@supabase/supabase-js';
import { blockIfTrialExpired } from '../../../lib/shop-access';
import { hasFeature, upgradeMessage } from '../../../lib/tier-features';
import { makeOrderNo, deliveryOrderFromRow, productFromRow, logCyclicalTransaction } from '../../../lib/google-pos';
import { requirePermission, getSessionStaffId } from '../../../lib/pos-auth';
import { adjustBranchStock } from '../../../lib/pos-stock';

// โอนย้ายสต็อกข้ามสาขา Phase 1: delivery.js ไม่เคยมี branch ในคำขอเลยตั้งแต่แรก (ไม่เหมือน
// sales.js/receives.js/loans.js) — ใช้ branch_name ของพนักงานที่ยืนยันจัดส่งแทน (มาจาก session
// ที่เซ็นชื่อ ปลอมไม่ได้ ต่างจาก staff_id/staff_name ที่ client ส่งมาซึ่งเป็นแค่ label แสดงผล)
// ไม่มี session (เจ้าของร้านยืนยันเอง กรณีหายาก) → กองกลาง/ไม่ระบุสาขา ('')
async function resolveConfirmingStaffBranch(req, shopId) {
  const staffId = getSessionStaffId(req);
  if (!staffId) return '';
  const { data } = await supabase.from('pos_staff').select('branch_name')
    .eq('shop_id', shopId).eq('staff_id', staffId).is('deleted_at', null).maybeSingle();
  return data?.branch_name || '';
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

async function getTier(shopId) {
  const { data: sp } = await supabase.from('shop_profiles').select('subscription_tier').eq('id', shopId).maybeSingle();
  return sp?.subscription_tier || 'normal';
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
    // ── GET — รายการออเดอร์ ─────────────────────────────────────────────────
    if (req.method === 'GET') {
      const { data, error } = await supabase.from('pos_delivery_orders').select('*')
        .eq('shop_id', shopId).is('deleted_at', null).order('created_at', { ascending: false });
      if (error) throw error;
      const orders = (data || []).map(deliveryOrderFromRow).filter(o => o.order_no);

      // ถ้าระบุ order_no → คืนเดี่ยว
      if (req.query.order_no) {
        const order = orders.find(o => o.order_no === req.query.order_no);
        return res.json({ order: order || null });
      }

      return res.json({ orders });
    }

    const tier = await getTier(shopId);

    // ── POST — สร้างออเดอร์ใหม่ ─────────────────────────────────────────────
    if (req.method === 'POST') {
      if (!(await requirePermission(req, res, shopId, 'perm_manage_delivery'))) return;
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

      const { error } = await supabase.from('pos_delivery_orders').insert({
        shop_id: shopId, order_no, transaction_at: now, customer_id, customer_name,
        phone, address, maps_link, items, total, payment_method,
        staff_id, staff_name, status: 'รอจัดส่ง', notes, created_by,
      });
      if (error) throw error;

      // ถ้าค้างจ่าย → อัปเดตยอดหนี้ผู้ติดต่ออัตโนมัติ
      if (payment_method === 'ค้างจ่าย' && customer_id) {
        try {
          const { data: cust } = await supabase.from('pos_contacts').select('debt')
            .eq('shop_id', shopId).eq('contact_id', customer_id).is('deleted_at', null).maybeSingle();
          if (cust) {
            await supabase.from('pos_contacts').update({
              debt: (Number(cust.debt) || 0) + total,
              contact_updated_at: now,
            }).eq('shop_id', shopId).eq('contact_id', customer_id);
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
          const { data: cust } = await supabase.from('pos_contacts').select('cylinders, cylinder_limit')
            .eq('shop_id', shopId).eq('contact_id', customer_id).is('deleted_at', null).maybeSingle();
          if (cust) {
            const newCylinders = (Number(cust.cylinders) || 0) + cylinders_delivered;
            await supabase.from('pos_contacts').update({
              cylinders: newCylinders, contact_updated_at: now,
            }).eq('shop_id', shopId).eq('contact_id', customer_id);
            if (Number(cust.cylinder_limit) > 0 && newCylinders > Number(cust.cylinder_limit)) {
              deliveryWarnings.push(`⚠️ ลูกค้ายืมสินค้าหมุนเวียนเกินวงเงินที่ตั้งไว้ (${newCylinders}/${cust.cylinder_limit})`);
            }
          }
        } catch (cylErr) {
          console.error('[delivery] update customer cylinders error:', cylErr.message);
        }
        // audit log — ยืมสินค้าหมุนเวียนไปกับออเดอร์จัดส่งนี้ (รวมเป็นยอดเดียว ไม่แยกราย SKU
        // เพราะ cylinders_delivered ที่ส่งมาเป็นยอดรวมอยู่แล้ว ไม่ได้แยกต่อสินค้า)
        await logCyclicalTransaction({
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
      if (!(await requirePermission(req, res, shopId, 'perm_manage_delivery'))) return;
      const {
        order_no, status, notes, maps_link,
        customer_id, customer_name, phone, address,
        items, total, payment_method, staff_id, staff_name,
        confirm_delivery, slip_url, confirmed_by, cash_received, goods_received, credit_settled,
        partial_paid_amount,
      } = req.body;
      if (!order_no) return res.status(400).json({ error: 'Missing order_no' });

      const { data: orderRow, error: fetchErr } = await supabase.from('pos_delivery_orders').select('*')
        .eq('shop_id', shopId).eq('order_no', order_no).is('deleted_at', null).maybeSingle();
      if (fetchErr) throw fetchErr;
      if (!orderRow) return res.status(404).json({ error: 'ไม่พบออเดอร์' });

      const existing = deliveryOrderFromRow(orderRow);
      const updates = {};
      if (customer_id     !== undefined) updates.customer_id  = customer_id;
      if (customer_name   !== undefined) updates.customer_name = customer_name;
      if (phone           !== undefined) updates.phone        = phone;
      if (address         !== undefined) updates.address      = address;
      if (maps_link       !== undefined) updates.maps_link     = maps_link;
      if (items           !== undefined) updates.items        = items;
      if (total           !== undefined) updates.total        = total;
      if (payment_method  !== undefined) updates.payment_method = payment_method;
      if (staff_id        !== undefined) updates.staff_id      = staff_id;
      if (staff_name      !== undefined) updates.staff_name    = staff_name;
      if (status          !== undefined) updates.status        = status;
      if (notes           !== undefined) updates.notes         = notes;
      if (slip_url        !== undefined) updates.slip_url       = slip_url;
      if (cash_received   !== undefined) updates.cash_received  = !!cash_received;
      if (goods_received  !== undefined) updates.goods_received = !!goods_received;

      // ── ยืนยันรับชำระเงินเชื่อ (ออเดอร์จัดส่งที่จ่ายแบบ "ค้างจ่าย") ──────────────
      // ลดยอด "ยอดค้างชำระ" ของผู้ติดต่อกลับลง (ตอนสร้างออเดอร์ ค้างจ่าย เคยบวกยอดนี้ไว้แล้ว)
      if (credit_settled === true && !existing.credit_settled) {
        updates.credit_settled = true;
        const custId = customer_id !== undefined ? customer_id : existing.customer_id;
        const orderTotal = total !== undefined ? parseFloat(total) || 0 : existing.total;
        if (custId && orderTotal > 0) {
          try {
            const { data: cust } = await supabase.from('pos_contacts').select('debt')
              .eq('shop_id', shopId).eq('contact_id', custId).is('deleted_at', null).maybeSingle();
            if (cust) {
              await supabase.from('pos_contacts').update({
                debt: Math.max(0, (Number(cust.debt) || 0) - orderTotal),
                contact_updated_at: new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }),
              }).eq('shop_id', shopId).eq('contact_id', custId);
            }
          } catch (debtErr) {
            console.error('[delivery] settle credit debt error:', debtErr.message);
          }
        }
      }

      let debtAdded = 0;
      if (confirm_delivery) {
        updates.status = 'ส่งแล้ว'; // ใช้ label เดียวกับสถานะที่แอดมินกดเปลี่ยนเองในหน้า pos.js
        updates.confirmed_at = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
        if (confirmed_by !== undefined) updates.confirmed_by = confirmed_by;

        // อัปเดตสต็อคสินค้าหมุนเวียน + ยอดถังอยู่กับลูกค้า — mirror ตรรกะเดียวกับ api/pos/sales.js checkout
        const cust = customer_id !== undefined ? customer_id : existing.customer_id;
        let netCylinderDeltaForCustomer = 0;

        // พนักงานเลือก "ค้างจ่าย" ตอนยืนยันจัดส่ง (คนละจุดกับตอนสร้างออเดอร์) — รองรับจ่ายมาบางส่วนได้ด้วย:
        // ค้างชำระ = ยอดสุทธิ - จ่ายมาแล้ว (ไม่ต่ำกว่า 0)
        if (payment_method === 'ค้างจ่าย' && cust) {
          const orderTotal = total !== undefined ? parseFloat(total) || 0 : existing.total;
          const paidNow = Math.min(orderTotal, Math.max(0, parseFloat(partial_paid_amount) || 0));
          debtAdded = Math.round((orderTotal - paidNow) * 100) / 100;
          if (debtAdded > 0) {
            try {
              const { data: custRow } = await supabase.from('pos_contacts').select('debt')
                .eq('shop_id', shopId).eq('contact_id', cust).is('deleted_at', null).maybeSingle();
              if (custRow) {
                await supabase.from('pos_contacts').update({
                  debt: (Number(custRow.debt) || 0) + debtAdded,
                  contact_updated_at: new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }),
                }).eq('shop_id', shopId).eq('contact_id', cust);
              }
            } catch (debtErr) {
              console.error('[delivery] confirm_delivery add debt error:', debtErr.message);
            }
          }
        }

        if (Array.isArray(items) && items.length) {
          const confirmBranch = await resolveConfirmingStaffBranch(req, shopId);
          for (const item of items) {
            if (!item.sku) continue;
            try {
              const { data: prodRow } = await supabase.from('pos_products').select('*')
                .eq('shop_id', shopId).eq('sku', item.sku).is('deleted_at', null).maybeSingle();
              if (!prodRow) continue;
              const prod = productFromRow(prodRow);
              if (prod.type === 'ไม่นับสต็อค') continue; // บริการ ไม่มีสต็อคให้หัก

              // qty ติดลบเคยทำให้ยืนยันจัดส่ง "เพิ่ม" สต็อคแทนที่จะลด (stock - (-qty) = stock + qty)
              const qty = Math.max(0, parseInt(item.qty) || 0);

              if (prod.type === 'หมุนเวียน') {
                const returnedQty = Math.min(qty, Math.max(0, parseInt(item.returned_qty) || 0));
                const netBorrow = qty - returnedQty;

                // โอนย้ายสต็อกข้ามสาขา Phase 1: หักออกจากสาขาของพนักงานที่ยืนยันจัดส่ง
                await adjustBranchStock(shopId, item.sku, confirmBranch, {
                  qtyDelta: -qty, atCustomerDelta: netBorrow, emptyWaitingDelta: returnedQty,
                });
                await supabase.from('pos_products').update({
                  product_updated_at: new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }),
                }).eq('shop_id', shopId).eq('sku', item.sku);
                netCylinderDeltaForCustomer += netBorrow;

                if (returnedQty > 0) {
                  await logCyclicalTransaction({
                    shopId,
                    sku: item.sku, name: item.name || prod.name, source: 'จัดส่ง',
                    action: netBorrow > 0 ? 'แลกเปลี่ยน' : 'คืน',
                    qty: returnedQty, customerId: cust, customerName: existing.customer_name,
                    performedBy: confirmed_by,
                  });
                }
                if (netBorrow > 0) {
                  await logCyclicalTransaction({
                    shopId,
                    sku: item.sku, name: item.name || prod.name, source: 'จัดส่ง', action: 'ยืม',
                    qty: netBorrow, customerId: cust, customerName: existing.customer_name,
                    performedBy: confirmed_by,
                  });
                }
              } else {
                // นับสต็อค (สินค้าทั่วไป) — เดิมไม่เคยหักสต็อคเลยตั้งแต่สร้างโมดูล delivery
                // (ต่างจากขายหน้าร้าน/api/pos/sales.js ที่หักตั้งแต่ checkout) หักตรงๆ ไม่มี
                // at_customer/empty_waiting/audit log เหมือนสินค้าหมุนเวียน เพราะไม่ใช่แนวคิด
                // "แลกเปลี่ยน/ยืม" — ของถูกส่งออกจากร้านไปแล้วจริงถือว่าออกจากสต็อคทันที
                await adjustBranchStock(shopId, item.sku, confirmBranch, { qtyDelta: -qty });
                await supabase.from('pos_products').update({
                  product_updated_at: new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }),
                }).eq('shop_id', shopId).eq('sku', item.sku);
              }
            } catch (prodErr) {
              console.error('[delivery] update product stock error:', prodErr.message);
            }
          }
        }

        if (netCylinderDeltaForCustomer !== 0 && cust) {
          try {
            const { data: custRow } = await supabase.from('pos_contacts').select('cylinders')
              .eq('shop_id', shopId).eq('contact_id', cust).is('deleted_at', null).maybeSingle();
            if (custRow) {
              await supabase.from('pos_contacts').update({
                cylinders: Math.max(0, (Number(custRow.cylinders) || 0) + netCylinderDeltaForCustomer),
                contact_updated_at: new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }),
              }).eq('shop_id', shopId).eq('contact_id', cust);
            }
          } catch (custErr) {
            console.error('[delivery] update customer cylinders error:', custErr.message);
          }
        }
      }

      const { error } = await supabase.from('pos_delivery_orders').update(updates)
        .eq('shop_id', shopId).eq('order_no', order_no);
      if (error) throw error;
      return res.json({ ok: true, order_no, debtAdded });
    }

    // ── DELETE — ลบออเดอร์ (เช่น ลูกค้ามารับเองแทนการจัดส่ง) ──────────────────
    if (req.method === 'DELETE') {
      if (!(await requirePermission(req, res, shopId, 'perm_manage_delivery'))) return;
      const { order_no } = req.body;
      if (!order_no) return res.status(400).json({ error: 'Missing order_no' });

      const { data: existing, error: fetchErr } = await supabase.from('pos_delivery_orders').select('order_no')
        .eq('shop_id', shopId).eq('order_no', order_no).is('deleted_at', null).maybeSingle();
      if (fetchErr) throw fetchErr;
      if (!existing) return res.status(404).json({ error: 'ไม่พบออเดอร์' });

      const { error } = await supabase.from('pos_delivery_orders')
        .update({ deleted_at: new Date().toISOString() })
        .eq('shop_id', shopId).eq('order_no', order_no);
      if (error) throw error;
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('[pos/delivery]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
