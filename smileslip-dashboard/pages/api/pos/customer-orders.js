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
 */
import { createClient } from '@supabase/supabase-js';
import { blockIfTrialExpired } from '../../../lib/shop-access';
import {
  getAccessToken, readSheet, appendSheet, updateSheetRow, ensureTabExists,
  rowToCustomerOrder, CUSTOMER_ORDER_HEADERS, makeCustomerOrderNo, rowToProduct,
} from '../../../lib/google-pos';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

function asText(v) {
  if (v === '' || v == null) return v;
  return `'${v}`;
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

  // เขียนไม่ได้ถ้าทดลองใช้ 30 วันหมดอายุแล้ว — ฝั่งลูกค้าจะเห็นข้อความทั่วไปแทน (ดู pages/order.js)
  if (req.method !== 'GET' && (await blockIfTrialExpired(req, res, shopId))) return;

  try {
    const { sheetId, token } = await getConfig(shopId);
    await ensureTabExists(token, sheetId, 'ออเดอร์ลูกค้ารอยืนยัน', CUSTOMER_ORDER_HEADERS);

    // ── GET (แอดมิน/พนักงาน) ─────────────────────────────────────────────────
    if (req.method === 'GET') {
      const rows = await readSheet(token, sheetId, 'ออเดอร์ลูกค้ารอยืนยัน!A:L');
      const pending = rows.slice(1)
        .map(r => rowToCustomerOrder(r))
        .filter(o => o.order_no && o.status === 'รอตรวจสอบ')
        .reverse();
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
      const prodRows = await readSheet(token, sheetId, 'สินค้า!A:T');
      const products = prodRows.slice(1).map(r => rowToProduct(r)).filter(p => p.sku && p.is_active !== false);
      const resolvedItems = [];
      for (const item of items) {
        const prod = products.find(p => p.sku === item.sku);
        if (!prod) continue;
        if (prod.type === 'หมุนเวียน') continue;
        // สินค้าที่ระบุสาขาที่ขายไว้เฉพาะเจาะจง (ไม่ใช่ขายได้ทุกสาขา) ต้องตรงกับสาขาที่ลูกค้าเลือกเท่านั้น
        // กันลูกค้ายิง request ตรงสั่งสินค้าที่สาขานั้นไม่ได้ขาย
        if (branch && prod.branches.length > 0 && !prod.branches.includes(branch)) continue;
        const qty = Math.max(1, parseInt(item.qty) || 0);
        if (qty <= 0) continue;
        resolvedItems.push({ sku: prod.sku, name: prod.name, unit: prod.unit, price: prod.price, qty });
      }
      if (!resolvedItems.length) return res.status(400).json({ error: 'ไม่พบสินค้าที่เลือกในระบบ กรุณาลองใหม่' });

      const total = Math.round(resolvedItems.reduce((s, i) => s + i.price * i.qty, 0) * 100) / 100;
      const order_no = makeCustomerOrderNo();
      const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });

      await appendSheet(token, sheetId, 'ออเดอร์ลูกค้ารอยืนยัน', [
        order_no, now, customer_name.trim(), asText(phone.trim()), address.trim(),
        branch || '', JSON.stringify(resolvedItems), total, payment_method, slip_url, notes, 'รอตรวจสอบ',
      ]);

      recordAttempt(rlKey);
      return res.json({ ok: true, order_no, total });
    }

    // ── DELETE (แอดมิน/พนักงาน) ───────────────────────────────────────────────
    if (req.method === 'DELETE') {
      const { order_no } = req.body;
      if (!order_no) return res.status(400).json({ error: 'Missing order_no' });
      const rows = await readSheet(token, sheetId, 'ออเดอร์ลูกค้ารอยืนยัน!A:L');
      const idx = rows.slice(1).findIndex(r => r[0] === order_no);
      if (idx === -1) return res.status(404).json({ error: 'ไม่พบรายการ' });
      await updateSheetRow(token, sheetId, 'ออเดอร์ลูกค้ารอยืนยัน', idx + 2, new Array(12).fill(''));
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[pos/customer-orders]', err.message);
    if (err.notSetup) return res.status(400).json({ error: err.message, notSetup: true });
    if (err.notConnected) return res.status(400).json({ error: err.message, notConnected: true });
    return res.status(500).json({ error: err.message });
  }
}
