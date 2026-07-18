import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const { shopId } = req.query;
    if (!shopId) return res.status(400).json({ error: 'ไม่พบ shopId' });

    const { data: profile } = await supabase
      .from('shop_profiles')
      .select('stripe_subscription_id, subscription_tier')
      .eq('id', shopId)
      .maybeSingle();

    if (!profile?.stripe_subscription_id) {
      return res.status(200).json({ active: false, tier: profile?.subscription_tier || 'normal' });
    }

    try {
      const sub = await stripe.subscriptions.retrieve(profile.stripe_subscription_id);
      const periodEnd = new Date(sub.current_period_end * 1000);
      const daysLeft = Math.max(0, Math.ceil((periodEnd - Date.now()) / (1000 * 60 * 60 * 24)));
      const interval = sub.items.data[0]?.price?.recurring?.interval || 'month';

      return res.status(200).json({
        active: sub.status === 'active' || sub.status === 'trialing',
        status: sub.status,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        currentPeriodEnd: periodEnd.toISOString(),
        daysLeft,
        interval, // 'month' | 'year'
        tier: profile.subscription_tier,
        subscriptionId: profile.stripe_subscription_id,
      });
    } catch (err) {
      console.error('[Subscription] Stripe error:', err.message);
      return res.status(200).json({ active: false, tier: profile.subscription_tier, error: err.message });
    }
  }

  if (req.method === 'POST') {
    const { shopId, action } = req.body;
    if (!shopId || !action) return res.status(400).json({ error: 'ข้อมูลไม่ครบ' });

    const { data: profile } = await supabase
      .from('shop_profiles')
      .select('stripe_subscription_id')
      .eq('id', shopId)
      .maybeSingle();

    if (!profile?.stripe_subscription_id) {
      return res.status(400).json({ error: 'ไม่มี subscription ที่ active' });
    }

    try {
      if (action === 'cancel') {
        // ยกเลิกเมื่อสิ้นรอบบิล — ไม่ตัดบริการทันที
        await stripe.subscriptions.update(profile.stripe_subscription_id, {
          cancel_at_period_end: true,
        });
        return res.status(200).json({ success: true, cancelled: true });
      }

      if (action === 'resume') {
        // ยกเลิกการยกเลิก (ถ้ายังไม่หมดรอบ)
        await stripe.subscriptions.update(profile.stripe_subscription_id, {
          cancel_at_period_end: false,
        });
        return res.status(200).json({ success: true, resumed: true });
      }

      return res.status(400).json({ error: 'action ไม่ถูกต้อง' });
    } catch (err) {
      console.error('[Subscription] action error:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).end();
}
