/**
 * GET    /api/pos/customer-orders?shopId                → รายการคำสั่งซื้อจากลูกค้าที่รอตรวจสอบ (ฝั่งแอดมิน/พนักงาน)
 * POST   /api/pos/customer-orders { shopId, customer_name, phone, address, branch,
 *                                   items:[{sku,qty}], payment_method, slip_url, notes } → สาธารณะ ไม่ต้อง login
 *   → ลูกค้าสั่งจากหน้าเว็บ /order (pages/order.js) เข้ามาที่นี่ก่อนเสมอ (สถานะ 'รอตรวจสอบ')
 *     ไม่กลายเป็นออเดอร์จัดส่งจริงทันที กันสแปม/พิมพ์ผิดจากคนนอกที่ไม่มีคนตรวจก่อน
 *   → ราคา/ยอดรวมคำนวณใหม่จากราคาสินค้าจริงในระบบเสมอ (ไม่เชื่อราคาที่ฝั่งลูกค้าส่งมา กันปลอมราคา)
 * DELETE /api/pos/customer-orders { shopId, order_no }   → ลบออกจากคิวรอ (ปฏิเสธ หรือแอดมินยืนยันสร้างเป็น
 *                                                            ออเดอร์จัดส่งจริงผ่าน /api/pos/delivery แล้ว)
 *
 * ไฟล์นี้ไม่สร้างออเดอร์จัดส่งจริงเอง — แอดมินตรวจ/แก้ไขที่นี่ก่อน แล้วกดยืนยันผ่านฟอร์มสร้างออเดอร์จัดส่งปกติ
 * ใน pos.js (พรีฟิลข้อมูลจากที่นี่ให้) เหมือน pattern เดียวกับ รับสินค้ารอยืนยัน/รายจ่ายรอยืนยัน จาก LINE
 *
 * Phase 2 (write-primary flip, 2026-07-29): อ่าน/เขียนจาก Supabase (pos_customer_orders/pos_products)
 * โดยตรงแล้ว ไม่ผ่าน Google Sheets/Google connection อีกต่อไป
 */
import { supabase } from '../../../lib/supabase-pos';
import { blockIfTrialExpired } from '../../../lib/shop-access';
import { makeCustomerOrderNo, productFromRow } from '../../../lib/google-pos';
import { requirePermission } from '../../../lib/pos-auth';
import { getBranchStock } from '../../../lib/pos-stock';

function orderFromRow(r) {
  return {
    order_no: r.order_no,
    created_at: r.transaction_at,
    customer_name: r.customer_name,
    phone: r.phone,
    address: r.address,
    branch: r.branch_name,
    items: r.items || [],
    total: parseFloat(r.total) || 0,
    payment_method: r.payment_method,
    slip_url: r.slip_url || '',
    notes: r.notes || '',
    status: r.status,
  };
}

// กันสแปม/ยิงรัวจากหน้าเว็บสาธารณะที่ไม่ต้อง login — จำกัดจำนวนคำสั่งซื้อต่อ IP ต่อร้านต่อหน้าต่างเวลา
// (in-memory ต่อ instance — เพียงพอสำหรับสเกลของแอปนี้ pattern เดียวกับ verify-pin.js)
const orderAttempts = new Map(); // `${shopId}:${ip}` -> { count, windowStart }
const MAX_ORDERS_PER_WINDOW = 10;
const WINDOW_MS = 10 * 60 * 1000;

function isRateLimited(key) {
  const now = Date.now();
  const entry = orderAttempts.get(key);
  if (!entry || now - entry.windowStart > WINDOW_MS) return false;
  return entry.count >= MAX_ORDERS_PER_WINDOW;
}
function recordAttempt(key) {
  const now = Date.now();
  const entry = orderAttempts.get(key);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    orderAttempts.set(key, { count: 1, windowStart: now });
  } else {
    entry.count += 1;
  }
}

export default async function handler(req, res) {
  const shopId = req.query.shopId || req.body?.shopId;
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });

  // เขียนไม่ได้ถ้าทดลองใช้ 30 วันหมดอายุแล้ว — ฝั่งลูกค้าจะเห็นข้อความทั่วไปแทน (ดู pages/order.js)
  if (req.method !== 'GET' && (await blockIfTrialExpired(req, res, shopId))) return;

  try {
    // ── GET (แอดมิน/พนักงาน) ─────────────────────────────────────────────────
    if (req.method === 'GET') {
      const { data, error } = await supabase.from('pos_customer_orders').select('*')
        .eq('shop_id', shopId).is('deleted_at', null).eq('status', 'รอตรวจสอบ')
        .order('created_at', { ascending: false });
      if (error) throw error;
      const pending = (data || []).map(orderFromRow).filter(o => o.order_no);
      return res.json({ pending });
    }

    // ── POST (สาธารณะ — จากหน้า /order) ──────────────────────────────────────
    if (req.method === 'POST') {
      const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
      const rlKey = `${shopId}:${ip}`;
      if (isRateLimited(rlKey)) {
        return res.status(429).json({ error: 'สั่งซื้อบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่' });
      }

      const {
        customer_name = '', phone = '', address = '', branch = '',
        items = [], payment_method = 'เก็บปลายทาง', slip_url = '', notes = '',
      } = req.body;

      if (!customer_name.trim()) return res.status(400).json({ error: 'กรุณาระบุชื่อผู้สั่งซื้อ' });
      if (!phone.trim()) return res.status(400).json({ error: 'กรุณาระบุเบอร์โทร' });
      if (!address.trim()) return res.status(400).json({ error: 'กรุณาระบุที่อยู่จัดส่ง' });
      if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'กรุณาเลือกสินค้าอย่างน้อย 1 รายการ' });

      // คำนวณยอดรวมใหม่จากราคาสินค้าจริงเสมอ (ไม่เชื่อราคาที่ฝั่งลูกค้าส่งมา กันปลอมราคา) —
      // ไม่รับสินค้าประเภท "หมุนเวียน" จากช่องทางนี้ (ต้องมีพนักงานคุยเรื่องแลก/ยืมของเก่าโดยตรง)
      const { data: prodRows, error: prodErr } = await supabase.from('pos_products').select('*')
        .eq('shop_id', shopId).is('deleted_at', null);
      if (prodErr) throw prodErr;
      const products = (prodRows || []).map(productFromRow).filter(p => p.sku && p.is_active !== false);
      const resolvedItems = [];
      for (const item of items) {
        const prod = products.find(p => p.sku === item.sku);
        if (!prod) continue;
        if (prod.type === 'หมุนเวียน') continue;
        // สินค้าที่ระบุสาขาที่ขายไว้เฉพาะเจาะจง (ไม่ใช่ขายได้ทุกสาขา) ต้องตรงกับสาขาที่ลูกค้าเลือกเท่านั้น
        // กันลูกค้ายิง request ตรงสั่งสินค้าที่สาขานั้นไม่ได้ขาย
        if (branch && prod.branches.length > 0 && !prod.branches.includes(branch)) continue;
        // จำกัดจำนวนสูงสุดต่อรายการ (10,000) กันแบบฟอร์มสาธารณะที่ไม่ต้อง login ถูกกรอกเลขมั่ว/สแปม
        // ทำให้คิวรอตรวจสอบมียอดเพี้ยนเกินจริงเป็นเรื่องยากต่อแอดมินตรวจสอบ
        const qty = Math.min(10000, Math.max(1, parseInt(item.qty) || 0));
        if (qty <= 0) continue;
        // โอนย้ายสต็อกข้ามสาขา Phase 5 — เช็คสต็อกจริงที่สาขานี้ (ไม่ใช่แค่ visibility เหมือนเดิม) แนบ
        // ไว้เป็น flag เฉยๆ ให้แอดมินเห็นตอนตรวจสอบ **ไม่บล็อคการสั่งซื้อ** เพราะออเดอร์จากช่องทางนี้
        // เข้าคิว "รอตรวจสอบ" เสมออยู่แล้ว มีคนตรวจก่อนสร้างเป็นออเดอร์จัดส่งจริงทุกครั้ง (แอดมินตัดสินใจ
        // เองได้ว่าจะยืนยัน/ติดต่อลูกค้าก่อน/ปฏิเสธ ไม่ควรบล็อคลูกค้าจากการสั่งซื้อเพราะตัวเลขสต็อคอาจผิดจริง)
        const branchStock = await getBranchStock(shopId, prod.sku, branch);
        resolvedItems.push({ sku: prod.sku, name: prod.name, unit: prod.unit, price: prod.price, qty, low_stock: qty > branchStock.qty });
      }
      if (!resolvedItems.length) return res.status(400).json({ error: 'ไม่พบสินค้าที่เลือกในระบบ กรุณาลองใหม่' });

      const total = Math.round(resolvedItems.reduce((s, i) => s + i.price * i.qty, 0) * 100) / 100;
      const order_no = makeCustomerOrderNo();
      const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });

      const { error } = await supabase.from('pos_customer_orders').insert({
        shop_id: shopId, order_no, transaction_at: now, customer_name: customer_name.trim(),
        phone: phone.trim(), address: address.trim(), branch_name: branch || '',
        items: resolvedItems, total, payment_method, slip_url, notes, status: 'รอตรวจสอบ',
      });
      if (error) throw error;

      recordAttempt(rlKey);
      return res.json({ ok: true, order_no, total });
    }

    // ── DELETE (แอดมิน/พนักงาน) ───────────────────────────────────────────────
    if (req.method === 'DELETE') {
      if (!(await requirePermission(req, res, shopId, 'perm_manage_delivery'))) return;
      const { order_no } = req.body;
      if (!order_no) return res.status(400).json({ error: 'Missing order_no' });

      const { data: existing, error: fetchErr } = await supabase.from('pos_customer_orders').select('order_no')
        .eq('shop_id', shopId).eq('order_no', order_no).is('deleted_at', null).maybeSingle();
      if (fetchErr) throw fetchErr;
      if (!existing) return res.status(404).json({ error: 'ไม่พบรายการ' });

      const { error } = await supabase.from('pos_customer_orders')
        .update({ deleted_at: new Date().toISOString() })
        .eq('shop_id', shopId).eq('order_no', order_no);
      if (error) throw error;
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[pos/customer-orders]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
