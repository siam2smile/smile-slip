import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const VAT_TAX_RATE_ID = 'txr_1TmUXP3ZvivzvZ6qOAASeKir'; // VAT 7% (exclusive)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

const PRICE_MAP = {
  "price_1TYKnm3ZvivzvZ6qHQpT6tDf": { type: "subscription", plan: "pro",        monthlyCredits: 200  },
  "price_1TYKnm3ZvivzvZ6qmXeH3i2a": { type: "subscription", plan: "pro",        monthlyCredits: 200  },
  "price_1TYKrd3ZvivzvZ6qQ2P0rHIg": { type: "subscription", plan: "advance",    monthlyCredits: 500  },
  "price_1TYKre3ZvivzvZ6qlqgiu8t5": { type: "subscription", plan: "advance",    monthlyCredits: 500  },
  "price_1Tg4zU3ZvivzvZ6ql61Q0szc": { type: "subscription", plan: "business",   monthlyCredits: 1000 },
  "price_1Tg4zU3ZvivzvZ6qP2AE2Yz0": { type: "subscription", plan: "business",   monthlyCredits: 1000 },
  "price_1TYKv33ZvivzvZ6qDs5eBbqA": { type: "subscription", plan: "enterprise", monthlyCredits: 0    },
  "price_1TYKv33ZvivzvZ6q9dIPU3ud": { type: "subscription", plan: "enterprise", monthlyCredits: 0    },
  "price_1TYLy93ZvivzvZ6qMaWLnlhH": { type: "credit", amount: 100  },
  "price_1TYLyA3ZvivzvZ6q78LPY9Fh": { type: "credit", amount: 500  },
  "price_1TYLy93ZvivzvZ6qXziQSdMo": { type: "credit", amount: 1000 },
  "price_1Tg56f3ZvivzvZ6qX4163cg5": { type: "credit", amount: 3000 },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { priceId, shopId } = req.body;
  if (!priceId || !shopId) return res.status(400).json({ error: 'ข้อมูลไม่ครบ' });

  const itemConfig = PRICE_MAP[priceId];
  if (!itemConfig) return res.status(400).json({ error: 'ไม่พบ Price ID นี้ในระบบ' });

  try {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.FRONTEND_URL;
    const isSubscription = itemConfig.type === 'subscription';

    // ─── เช็คโปรโมชั่นที่ active อยู่ (server-side เท่านั้น กันลูกค้าปลอมค่า) ───
    let activeCouponId = null;
    try {
      const { data: promoRow } = await supabase.from('admin_settings').select('value').eq('key', 'active_promotion').maybeSingle();
      if (promoRow?.value) {
        const promo = JSON.parse(promoRow.value);
        const notExpired = !promo.validUntil || new Date().toISOString().slice(0, 10) <= promo.validUntil;
        if (promo.enabled && promo.stripeCouponId && notExpired) activeCouponId = promo.stripeCouponId;
      }
    } catch (e) { console.warn('[Checkout] ดึงโปรโมชั่นไม่สำเร็จ:', e.message); }

    // ─── ดึง Stripe Customer ID ที่บันทึกไว้ (ถ้ามี) เพื่อรองรับ proration ───
    let stripeCustomerId = null;
    let shopData = null;
    try {
      const { data: fetched } = await supabase
        .from('shop_profiles')
        .select('stripe_customer_id, stripe_subscription_id, email, shop_name, owner_line_id')
        .eq('id', shopId)
        .single();
      shopData = fetched;

      if (shopData?.stripe_customer_id) {
        stripeCustomerId = shopData.stripe_customer_id;
      } else if (shopData?.email) {
        // สร้าง Stripe Customer ใหม่ถ้ายังไม่มี
        const customer = await stripe.customers.create({
          email: shopData.email,
          name: shopData.shop_name,
          metadata: { shopId },
        });
        stripeCustomerId = customer.id;
        // บันทึกกลับลง Supabase
        await supabase.from('shop_profiles')
          .update({ stripe_customer_id: stripeCustomerId })
          .eq('id', shopId);
      }
    } catch (e) {
      console.warn('[Checkout] ไม่สามารถดึง/สร้าง Stripe Customer:', e.message);
    }

    const lineUserId = shopData?.owner_line_id || shopId;

    // ─── Upgrade Subscription (มี subscription อยู่แล้ว → update แทนสร้างใหม่ รองรับ proration) ───
    if (isSubscription && shopData?.stripe_subscription_id) {
      try {
        const existingSub = await stripe.subscriptions.retrieve(shopData.stripe_subscription_id);
        // ถ้า subscription ยัง active อยู่ → upgrade โดยตรง
        if (existingSub.status === 'active' || existingSub.status === 'trialing') {
          const currentItemId = existingSub.items.data[0]?.id;
          if (currentItemId) {
            await stripe.subscriptions.update(shopData.stripe_subscription_id, {
              items: [{ id: currentItemId, price: priceId, tax_rates: [VAT_TAX_RATE_ID] }],
              proration_behavior: 'create_prorations',
              payment_behavior: 'allow_incomplete',
              ...(activeCouponId ? { discounts: [{ coupon: activeCouponId }] } : {}),
            });
            // อัปเดต tier + เพิ่มเครดิต
            await supabase.from('shop_profiles')
              .update({ subscription_tier: itemConfig.plan })
              .eq('id', shopId);
            if (itemConfig.monthlyCredits > 0) {
              const { data: addResult } = await supabase.rpc('add_shop_credit', { p_shop_id: shopId, p_amount: itemConfig.monthlyCredits });
              console.log(`[Checkout] upgrade → ${itemConfig.plan}, +${itemConfig.monthlyCredits} credits, shop ${shopId}, balance: ${addResult?.[0]?.new_balance}`);
            }
            return res.status(200).json({ upgraded: true, userId: lineUserId });
          }
        }
      } catch (upgradeErr) {
        console.warn('[Checkout] Upgrade failed, falling back to new checkout:', upgradeErr.message);
        // ถ้า upgrade ล้มเหลว ไปสร้าง checkout session ใหม่ตามปกติ
      }
    }

    // ─── สร้าง Checkout Session (ใหม่หรือ one-time credit) ───
    const sessionConfig = {
      payment_method_types: isSubscription ? ['card'] : ['card', 'promptpay'],
      line_items: [{ price: priceId, quantity: 1, tax_rates: [VAT_TAX_RATE_ID] }],
      mode: isSubscription ? 'subscription' : 'payment',
      success_url: `${baseUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}&userId=${lineUserId}`,
      cancel_url: `${baseUrl}/pricing?userId=${lineUserId}`,
      client_reference_id: shopId,
      metadata: { shopId, priceId },
    };

    // ใส่ customer ถ้ามี — ทำให้ Stripe รู้ว่าเป็นลูกค้าคนเดิม (รองรับ proration)
    if (stripeCustomerId) {
      sessionConfig.customer = stripeCustomerId;
    }

    // แนบโปรโมชั่นถ้ามี active (auto-apply) — Stripe ไม่ยอมให้ใช้คู่กับ allow_promotion_codes
    // ในคำขอเดียวกัน (เลือกได้แค่อย่างใดอย่างหนึ่ง) ถ้าไม่มีโปรที่ร้านตั้งเอง active อยู่ ให้ลูกค้า
    // กรอกคูปองเองได้แทน (ช่องกรอกโค้ดมีอยู่แล้วในหน้า Stripe Checkout เอง ไม่ต้องสร้าง UI เพิ่ม)
    if (activeCouponId) {
      sessionConfig.discounts = [{ coupon: activeCouponId }];
    } else {
      sessionConfig.allow_promotion_codes = true;
    }

    const session = await stripe.checkout.sessions.create(sessionConfig);
    return res.status(200).json({ url: session.url });

  } catch (err) {
    console.error('Checkout error:', err.message);
    return res.status(500).json({ error: 'เกิดข้อผิดพลาดในการสร้าง Session ชำระเงิน' });
  }
}
