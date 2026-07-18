/**
 * GET  /api/admin/promotion        — ดึง config โปรโมชั่นปัจจุบัน (admin only)
 * POST /api/admin/promotion        — เปิด/ปิด/แก้ไขโปรโมชั่น (admin only)
 *   body: { enabled, title, badgeText, discountPercent, validUntil }
 *   เมื่อ enabled=true จะสร้าง Stripe Coupon ใหม่อัตโนมัติตาม discountPercent
 */
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

function verifyAdmin(req) {
  const token = req.headers['x-admin-token'];
  if (!token) return false;
  try { return Buffer.from(token, 'base64').toString('utf8').startsWith('smileslip-admin:'); }
  catch { return false; }
}

const SETTING_KEY = 'active_promotion';

export default async function handler(req, res) {
  if (!verifyAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });

  if (req.method === 'GET') {
    const { data } = await supabase.from('admin_settings').select('value').eq('key', SETTING_KEY).maybeSingle();
    const promo = data?.value ? JSON.parse(data.value) : null;
    return res.status(200).json({ promotion: promo });
  }

  if (req.method === 'POST') {
    const { enabled, title, badgeText, discountPercent, validUntil } = req.body;

    if (!enabled) {
      // ปิดโปร — เก็บ record ไว้แต่ enabled=false (ไม่ลบ coupon ทิ้ง เผื่อใช้ซ้ำ)
      await supabase.from('admin_settings').upsert({
        key: SETTING_KEY,
        value: JSON.stringify({ enabled: false }),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });
      return res.status(200).json({ success: true, promotion: { enabled: false } });
    }

    const pct = parseInt(discountPercent);
    if (!title || isNaN(pct) || pct <= 0 || pct > 90) {
      return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง (% ส่วนลดต้อง 1-90)' });
    }

    try {
      // สร้าง Stripe Coupon ใหม่ทุกครั้งที่เปิดโปร (กัน % ค้างจากครั้งก่อน)
      const coupon = await stripe.coupons.create({
        percent_off: pct,
        duration: 'once',
        name: title,
      });

      const promo = {
        enabled: true,
        title,
        badgeText: badgeText || `ลด ${pct}%`,
        discountPercent: pct,
        stripeCouponId: coupon.id,
        validUntil: validUntil || null,
      };

      await supabase.from('admin_settings').upsert({
        key: SETTING_KEY,
        value: JSON.stringify(promo),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });

      return res.status(200).json({ success: true, promotion: promo });
    } catch (err) {
      console.error('[Promotion] Stripe coupon error:', err.message);
      return res.status(500).json({ error: 'สร้าง Stripe Coupon ไม่สำเร็จ: ' + err.message });
    }
  }

  return res.status(405).end();
}
