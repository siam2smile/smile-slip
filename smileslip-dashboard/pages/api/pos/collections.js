/**
 * POST /api/pos/collections
 * ส่งงานให้พนักงานไปเก็บเงินเชื่อค้างชำระ และ/หรือสินค้าหมุนเวียนที่ลูกค้ายืมค้างอยู่
 *
 * Body: {
 *   shopId, customer_id, customer_name, phone,
 *   task_type: 'เงินเชื่อ' | 'สินค้ายืม' | 'ทั้งคู่',
 *   debt_amount, items: [{sku,name,qty,unit}],   ← สินค้าที่ต้องเก็บคืน (สินค้าหมุนเวียน)
 *   staff_id, staff_name, staff_line_id, notes, created_by
 * }
 *
 * GET  /api/pos/collections?shopId                     → รายการงานทั้งหมด
 * GET  /api/pos/collections?shopId&collection_no=xxx    → ดึงงานเดียว
 * PATCH /api/pos/collections { shopId, collection_no,
 *   result: 'success' | 'failed',                        ← พนักงานตอบกลับ (Phase staff)
 *   collected_amount, collected_items, slip_url, confirmed_by, staff_note,
 *   cash_received, goods_received,                       ← แอดมิน/ผู้จัดการยืนยันรับเข้าร้านจริง (Phase admin)
 * } → อัปเดตสถานะ/ผลลัพธ์
 *
 * Phase 2 (write-primary flip, 2026-07-29): อ่าน/เขียนจาก Supabase (pos_collections/pos_products/
 * pos_contacts/pos_cyclical_log) โดยตรงแล้ว ไม่ผ่าน Google Sheets/Google connection อีกต่อไป
 */
import { createClient } from '@supabase/supabase-js';
import { blockIfTrialExpired } from '../../../lib/shop-access';
import { hasFeature, upgradeMessage } from '../../../lib/tier-features';
import {
  makeCollectionNo, collectionFromRow, productFromRow, logCyclicalTransaction,
} from '../../../lib/google-pos';
import { requirePermission } from '../../../lib/pos-auth';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

// คำนวณจำนวนสินค้าหมุนเวียนที่ลูกค้าคนนี้ถืออยู่จริง แยกตาม SKU (ไม่ใช่แค่ยอดรวมเดียว) จากประวัติ
// "บันทึกแลกเปลี่ยน" (pos_cyclical_log) — ยืม = +qty (ถืออยู่เพิ่ม), คืน = -qty (คืนแล้ว),
// แลกเปลี่ยน = สุทธิ 0 (คืนเก่า+ยืมใหม่พร้อมกัน) — ใช้เติมจำนวนอัตโนมัติตอนส่งพนักงานไปเก็บ
async function getCustomerCyclicalHoldings(shopId, customerId) {
  if (!customerId) return {};
  try {
    const { data, error } = await supabase.from('pos_cyclical_log').select('*')
      .eq('shop_id', shopId).eq('customer_id', customerId);
    if (error) throw error;
    const holdings = {};
    for (const log of data || []) {
      if (!log.sku) continue;
      if (log.action === 'ยืม') holdings[log.sku] = (holdings[log.sku] || 0) + Number(log.qty);
      else if (log.action === 'คืน') holdings[log.sku] = (holdings[log.sku] || 0) - Number(log.qty);
    }
    for (const sku of Object.keys(holdings)) holdings[sku] = Math.max(0, Math.round(holdings[sku]));
    return holdings;
  } catch (err) {
    console.error('[pos/collections] getCustomerCyclicalHoldings error:', err.message);
    return {};
  }
}

async function getTier(shopId) {
  const { data: sp } = await supabase.from('shop_profiles').select('subscription_tier').eq('id', shopId).maybeSingle();
  return sp?.subscription_tier || 'normal';
}

// ── LINE Flex Message สำหรับพนักงานที่ถูกส่งไปเก็บเงิน/ของ ─────────────────────
function buildCollectionFlex(task, shopId) {
  const { collection_no, customer_name, phone, task_type, debt_amount, items, notes } = task;

  const bodyContents = [
    { type: 'text', text: `👤 ${customer_name}`, weight: 'bold', size: 'md' },
    phone ? { type: 'text', text: `📞 ${phone}`, size: 'sm', color: '#555555' } : null,
    { type: 'separator', margin: 'sm' },
  ];

  if (task_type !== 'สินค้ายืม' && debt_amount > 0) {
    bodyContents.push({
      type: 'box', layout: 'horizontal', margin: 'sm',
      contents: [
        { type: 'text', text: '💳 เงินเชื่อค้าง', flex: 3, size: 'sm', weight: 'bold' },
        { type: 'text', text: `฿${debt_amount.toLocaleString()}`, flex: 2, size: 'md', align: 'end', weight: 'bold', color: '#f97316' },
      ],
    });
  }

  if (task_type !== 'เงินเชื่อ' && Array.isArray(items) && items.length) {
    bodyContents.push({ type: 'text', text: '🔄 สินค้าที่ต้องเก็บคืน', size: 'sm', weight: 'bold', margin: 'sm', color: '#f97316' });
    items.forEach(item => {
      bodyContents.push({
        type: 'box', layout: 'horizontal',
        contents: [
          { type: 'text', text: item.name, flex: 3, size: 'sm', color: '#555555', wrap: true },
          { type: 'text', text: `×${item.qty}`, flex: 1, size: 'sm', align: 'end', color: '#888888' },
        ],
      });
    });
  }

  if (notes) bodyContents.push({ type: 'text', text: `📝 ${notes}`, size: 'sm', color: '#888888', wrap: true, margin: 'sm' });

  return {
    type: 'flex',
    altText: `🧾 งานเก็บเงิน/ของ ${collection_no} — ${customer_name}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', paddingAll: '16px', backgroundColor: '#ea580c',
        contents: [
          { type: 'text', text: '🧾 งานเก็บเงิน/ของคืน', weight: 'bold', size: 'xl', color: '#ffffff' },
          { type: 'text', text: collection_no, size: 'xs', color: '#fed7aa', margin: 'xs' },
        ],
      },
      body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: bodyContents.filter(Boolean) },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [{
          type: 'button',
          action: {
            type: 'uri',
            label: '✅ เปิดหน้ายืนยันงาน',
            uri: `${process.env.FRONTEND_URL}/pos-staff?shopId=${shopId}&collection_no=${collection_no}`,
          },
          style: 'primary',
          color: '#ea580c',
          height: 'sm',
        }],
      },
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
    console.error('[collections] LINE push error:', err);
  }
}

export default async function handler(req, res) {
  const shopId = req.query.shopId || req.body?.shopId;
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });

  // เขียนไม่ได้ถ้าทดลองใช้ 30 วันหมดอายุแล้ว (อ่าน/GET ยังทำได้ปกติเสมอ)
  if (req.method !== 'GET' && (await blockIfTrialExpired(req, res, shopId))) return;

  try {
    // ── GET — รายการงาน ────────────────────────────────────────────────────
    if (req.method === 'GET') {
      // ดึงจำนวนสินค้าหมุนเวียนที่ลูกค้าคนนี้ถืออยู่จริงแยกตาม SKU — ใช้เติมฟอร์มส่งพนักงานไปเก็บอัตโนมัติ
      if (req.query.holdingsFor) {
        const holdings = await getCustomerCyclicalHoldings(shopId, req.query.holdingsFor);
        return res.json({ holdings });
      }

      const { data, error } = await supabase.from('pos_collections').select('*')
        .eq('shop_id', shopId).is('deleted_at', null).order('created_at', { ascending: false });
      if (error) throw error;
      const tasks = (data || []).map(collectionFromRow).filter(t => t.collection_no);

      if (req.query.collection_no) {
        const task = tasks.find(t => t.collection_no === req.query.collection_no);
        return res.json({ task: task || null });
      }

      return res.json({ tasks });
    }

    const tier = await getTier(shopId);

    // ── POST — สร้างงานใหม่ ─────────────────────────────────────────────────
    if (req.method === 'POST') {
      if (!(await requirePermission(req, res, shopId, 'perm_manage_delivery'))) return;
      const {
        customer_id = '', customer_name, phone = '',
        task_type = 'เงินเชื่อ', debt_amount = 0, items = [],
        staff_id = '', staff_name = '', staff_line_id = '', notes = '', created_by = '',
      } = req.body;

      if (!customer_name) return res.status(400).json({ error: 'ต้องระบุลูกค้า' });
      // ฟีเจอร์นี้เป็นส่วนขยายของทั้งระบบเงินเชื่อและสต็อคหมุนเวียน (ล็อกเหมือนกันที่ Shop Pro)
      if (!hasFeature(tier, 'credit_ar') || !hasFeature(tier, 'cyclical_stock')) {
        return res.status(403).json({ error: upgradeMessage('credit_ar'), featureLocked: true });
      }
      if (!staff_id) return res.status(400).json({ error: 'ต้องเลือกพนักงาน' });

      const collection_no = makeCollectionNo();
      const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });

      const { error } = await supabase.from('pos_collections').insert({
        shop_id: shopId, collection_no, transaction_at: now, customer_id, customer_name,
        phone, task_type, debt_amount, items, staff_id, staff_name, status: 'รอดำเนินการ',
        notes, created_by,
      });
      if (error) throw error;

      if (staff_line_id) {
        const flexMsg = buildCollectionFlex({ collection_no, customer_name, phone, task_type, debt_amount, items, notes }, shopId);
        await pushLineMessage(staff_line_id, flexMsg);
      }

      return res.json({ ok: true, collection_no });
    }

    // ── PATCH — พนักงานตอบกลับ / แอดมินยืนยันรับเข้าร้าน ───────────────────────
    if (req.method === 'PATCH') {
      if (!(await requirePermission(req, res, shopId, 'perm_manage_delivery'))) return;
      const {
        collection_no, result, collected_amount, collected_items, slip_url,
        confirmed_by, staff_note, cash_received, goods_received,
      } = req.body;
      if (!collection_no) return res.status(400).json({ error: 'Missing collection_no' });

      const { data: taskRow, error: fetchErr } = await supabase.from('pos_collections').select('*')
        .eq('shop_id', shopId).eq('collection_no', collection_no).is('deleted_at', null).maybeSingle();
      if (fetchErr) throw fetchErr;
      if (!taskRow) return res.status(404).json({ error: 'ไม่พบงาน' });

      const existing = collectionFromRow(taskRow);
      const updates = {};

      // ── พนักงานตอบกลับผลการเก็บ (ครั้งเดียว) ────────────────────────────────
      if (result !== undefined && existing.status === 'รอดำเนินการ') {
        updates.status = result === 'success' ? 'เก็บสำเร็จ' : 'เก็บไม่ได้';
        updates.collected_amount = collected_amount || 0;
        updates.collected_items = collected_items || [];
        updates.slip_url = slip_url || '';
        updates.confirmed_at = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
        if (confirmed_by !== undefined) updates.confirmed_by = confirmed_by;
        updates.staff_note = staff_note || '';

        if (result === 'success') {
          const custId = existing.customer_id;
          // ค่าติดลบเคยทำให้ "เก็บเงิน/ของ" กลับเพิ่มยอดค้าง/ถังลูกค้าแทนที่จะลด (debt - (-x) = debt + x)
          const amountCollected = Math.max(0, parseFloat(collected_amount) || 0);
          const itemsCollected = Array.isArray(collected_items) ? collected_items : [];
          const totalItemsQty = itemsCollected.reduce((s, i) => s + Math.max(0, parseInt(i.qty) || 0), 0);

          if (custId && (amountCollected > 0 || totalItemsQty > 0)) {
            try {
              const { data: custRow } = await supabase.from('pos_contacts').select('debt, cylinders')
                .eq('shop_id', shopId).eq('contact_id', custId).is('deleted_at', null).maybeSingle();
              if (custRow) {
                const custUpdates = { contact_updated_at: new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) };
                if (amountCollected > 0) custUpdates.debt = Math.max(0, (Number(custRow.debt) || 0) - amountCollected);
                if (totalItemsQty > 0) custUpdates.cylinders = Math.max(0, (Number(custRow.cylinders) || 0) - totalItemsQty);
                await supabase.from('pos_contacts').update(custUpdates)
                  .eq('shop_id', shopId).eq('contact_id', custId);
              }
            } catch (custErr) {
              console.error('[collections] update customer debt/cylinders error:', custErr.message);
            }
          }

          // สินค้าหมุนเวียนที่เก็บคืนมา → เพิ่ม "เปล่ารอรีฟิล" ของสินค้านั้น
          if (itemsCollected.length) {
            for (const item of itemsCollected) {
              const qty = parseInt(item.qty) || 0;
              if (qty <= 0 || !item.sku) continue;
              try {
                const { data: prodRow } = await supabase.from('pos_products').select('*')
                  .eq('shop_id', shopId).eq('sku', item.sku).is('deleted_at', null).maybeSingle();
                if (!prodRow) continue;
                const prod = productFromRow(prodRow);
                if (prod.type !== 'หมุนเวียน') continue;
                await supabase.from('pos_products').update({
                  empty_waiting: (prod.empty_waiting || 0) + qty,
                  product_updated_at: new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }),
                }).eq('shop_id', shopId).eq('sku', item.sku);

                await logCyclicalTransaction({
                  shopId,
                  sku: item.sku, name: item.name || prod.name, source: 'เก็บเงิน/ของ', action: 'คืน',
                  qty, customerId: custId, customerName: existing.customer_name,
                  performedBy: confirmed_by,
                });
              } catch (prodErr) {
                console.error('[collections] update product empty_waiting error:', prodErr.message);
              }
            }
          }
        }
      }

      // ── แอดมิน/ผู้จัดการยืนยันรับเข้าร้านจริง (สองชั้นกันเงิน/ของหาย) ────────────
      if (cash_received !== undefined) updates.cash_received = !!cash_received;
      if (goods_received !== undefined) updates.goods_received = !!goods_received;

      const { error } = await supabase.from('pos_collections').update(updates)
        .eq('shop_id', shopId).eq('collection_no', collection_no);
      if (error) throw error;
      return res.json({ ok: true, collection_no });
    }

    // ── DELETE — ยกเลิกงาน ──────────────────────────────────────────────────
    if (req.method === 'DELETE') {
      if (!(await requirePermission(req, res, shopId, 'perm_manage_delivery'))) return;
      const { collection_no } = req.body;
      if (!collection_no) return res.status(400).json({ error: 'Missing collection_no' });

      const { data: existing, error: fetchErr } = await supabase.from('pos_collections').select('collection_no')
        .eq('shop_id', shopId).eq('collection_no', collection_no).is('deleted_at', null).maybeSingle();
      if (fetchErr) throw fetchErr;
      if (!existing) return res.status(404).json({ error: 'ไม่พบงาน' });

      const { error } = await supabase.from('pos_collections')
        .update({ deleted_at: new Date().toISOString() })
        .eq('shop_id', shopId).eq('collection_no', collection_no);
      if (error) throw error;
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('[pos/collections]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
