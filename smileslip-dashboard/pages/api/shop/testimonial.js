/**
 * GET  /api/shop/testimonial?shopId=xxx   — เช็คว่าร้านนี้เคยส่งรีวิวหรือยัง
 * POST /api/shop/testimonial               — ส่งรีวิว (เฉพาะร้านที่จ่ายเงิน ครั้งเดียวต่อร้าน) + แถม 50 เครดิต
 *   body: { shopId, name, role, message, stars }
 */
import { createClient } from '@supabase/supabase-js';
import { requireOwnerAuth } from '../../../lib/owner-auth';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

const PAID_TIERS = ['pro', 'advance', 'business', 'enterprise', 'super'];

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const { shopId } = req.query;
    if (!shopId) return res.status(400).json({ error: 'shopId required' });
    // เรียกจาก useEffect ที่ประกาศต่อจาก fetch-override effect (dashboard.js บรรทัด ~243) —
    // ทั้งคู่ dep บน shopInfo?.id เดียวกัน override ติดตั้งก่อนเสมอตามลำดับ effect ของ React
    if (!requireOwnerAuth(req, res, shopId, { enforce: true })) return;
    const { data } = await supabase.from('shop_testimonials').select('id').eq('shop_id', shopId).maybeSingle();
    return res.status(200).json({ alreadySubmitted: !!data });
  }

  if (req.method === 'POST') {
    const { shopId, name, role, message, stars } = req.body;
    if (!shopId || !name || !message) return res.status(400).json({ error: 'ข้อมูลไม่ครบ' });
    // ป้องกันคนนอกยิงรีวิวปลอม + ฟาร์มเครดิตฟรี 50 เครดิต โดยรู้แค่ shopId
    if (!requireOwnerAuth(req, res, shopId, { enforce: true })) return;
    const starCount = Math.min(5, Math.max(1, parseInt(stars) || 5));

    const { data: shop } = await supabase.from('shop_profiles').select('subscription_tier').eq('id', shopId).maybeSingle();
    if (!shop) return res.status(404).json({ error: 'ไม่พบร้านค้า' });
    if (!PAID_TIERS.includes((shop.subscription_tier || 'normal').toLowerCase())) {
      return res.status(403).json({ error: 'ฟีเจอร์นี้สำหรับร้านที่สมัครแพ็กเกจรายเดือนแล้วเท่านั้น' });
    }

    const { data: existing } = await supabase.from('shop_testimonials').select('id').eq('shop_id', shopId).maybeSingle();
    if (existing) return res.status(409).json({ error: 'ร้านนี้เคยส่งรีวิวไปแล้ว' });

    const { error: insertErr } = await supabase.from('shop_testimonials').insert({
      shop_id: shopId, name, role: role || '', message, stars: starCount, is_hidden: false,
    });
    if (insertErr) return res.status(500).json({ error: insertErr.message });

    // แถม 50 เครดิต (atomic)
    const { data: addResult } = await supabase.rpc('add_shop_credit', { p_shop_id: shopId, p_amount: 50 });

    return res.status(200).json({ success: true, creditsAdded: 50, newBalance: addResult?.[0]?.new_balance });
  }

  return res.status(405).end();
}
