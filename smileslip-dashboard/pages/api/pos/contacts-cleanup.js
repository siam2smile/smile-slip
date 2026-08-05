/**
 * GET /api/pos/contacts-cleanup?shopId=xxx
 * → คำนวณข้อมูลเสริมสำหรับเครื่องมือ "เช็ครายการซ้ำ + กรองผู้ติดต่อไม่มีความเคลื่อนไหว" ใน pos.js
 *   คืนแค่ contact_id + ข้อมูลที่คำนวณ (ไม่ใช่ contact เต็ม เพราะฝั่งเว็บมี state ผู้ติดต่อเต็มอยู่
 *   แล้ว) ให้ฝั่งเว็บ merge เข้ากับ contacts ที่โหลดไว้แล้วเองด้วย contact_id
 *
 * - is_duplicate: true ถ้าชื่อ+เบอร์ (normalize แล้ว) ตรงกับผู้ติดต่อรายอื่นอย่างน้อย 1 คน —
 *   นับทุกคนในกลุ่มรวมคนแรกด้วย (ให้ผู้ใช้เห็นครบทั้งกลุ่มตอนรีวิว แล้วเลือกเองว่าจะเก็บ/ลบตัวไหน)
 * - last_activity_at: วันที่ล่าสุดที่มีธุรกรรมจริงผูกกับผู้ติดต่อคนนี้ (ขายเชื่อ/จัดส่ง/งานเก็บเงิน
 *   ที่ระบุ customer_id) — null = ไม่เคยมีธุรกรรมเลย (ส่วนใหญ่คือผู้ติดต่อที่นำเข้ามาเป็นชุดใหญ่
 *   ยังไม่เคยซื้อขายจริงกับร้าน — ถือเป็น "ไม่มีความเคลื่อนไหว" มากที่สุด ไม่ว่าเลือก threshold ใด)
 */
import { supabase } from '../../../lib/supabase-pos';

async function fetchAllPaginated(table, columns, shopId) {
  const PAGE = 1000;
  let all = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select(columns)
      .eq('shop_id', shopId).range(from, from + PAGE - 1);
    if (error) throw error;
    all = all.concat(data || []);
    if (!data || data.length < PAGE) break;
  }
  return all;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const { shopId } = req.query;
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });

  try {
    const contactRows = [];
    {
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase.from('pos_contacts')
          .select('contact_id,name,phone,created_at').eq('shop_id', shopId).is('deleted_at', null)
          .range(from, from + PAGE - 1);
        if (error) throw error;
        contactRows.push(...(data || []));
        if (!data || data.length < PAGE) break;
      }
    }

    // ── หากิจกรรมล่าสุดต่อผู้ติดต่อ จาก 3 แหล่งที่ผูก customer_id (ขาย/จัดส่ง/เก็บเงิน) ──
    const activityMap = new Map(); // contact_id -> timestamp (ms)
    const bump = (id, dateStr) => {
      if (!id || !dateStr) return;
      const t = new Date(dateStr).getTime();
      if (Number.isNaN(t)) return;
      const cur = activityMap.get(id);
      if (!cur || t > cur) activityMap.set(id, t);
    };
    const [sales, deliveries, collections] = await Promise.all([
      fetchAllPaginated('pos_sales', 'customer_id,transaction_at', shopId),
      fetchAllPaginated('pos_delivery_orders', 'customer_id,transaction_at', shopId),
      fetchAllPaginated('pos_collections', 'customer_id,transaction_at', shopId),
    ]);
    for (const r of sales) bump(r.customer_id, r.transaction_at);
    for (const r of deliveries) bump(r.customer_id, r.transaction_at);
    for (const r of collections) bump(r.customer_id, r.transaction_at);

    // ── กลุ่มซ้ำ: normalize ชื่อ+เบอร์ (ตัดวรรค/ตัวพิมพ์เล็กใหญ่) ──
    const groups = new Map();
    const keyOf = c => (c.name || '').trim().toLowerCase() + '|' + (c.phone || '').replace(/[\s-]/g, '');
    for (const c of contactRows) {
      const k = keyOf(c);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(c);
    }

    const result = contactRows.map(c => {
      const group = groups.get(keyOf(c));
      const last = activityMap.get(c.contact_id);
      return {
        contact_id: c.contact_id,
        is_duplicate: group.length > 1,
        duplicate_group_size: group.length,
        last_activity_at: last ? new Date(last).toISOString() : null,
        created_at: c.created_at || null,
      };
    });

    return res.json({ contacts: result });
  } catch (err) {
    console.error('[pos/contacts-cleanup]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
