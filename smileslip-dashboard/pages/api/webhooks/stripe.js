import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

export const config = { api: { bodyParser: false } };

// Rate Limiting — in-memory per IP (ป้องกัน flood จาก non-Stripe)
const rateLimitMap = new Map();
function checkRateLimit(ip) {
  const now = Date.now();
  const record = rateLimitMap.get(ip) || { count: 0, resetAt: now + 60000 };
  if (now > record.resetAt) { record.count = 0; record.resetAt = now + 60000; }
  record.count++;
  rateLimitMap.set(ip, record);
  if (rateLimitMap.size > 500) {
    for (const [k, v] of rateLimitMap) { if (now > v.resetAt) rateLimitMap.delete(k); }
  }
  return record.count <= 20;
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

// ══════════════════════════════════════════
// PRICE MAP — อัปเดตเมื่อสร้าง Price ใหม่ใน Stripe Dashboard
// ══════════════════════════════════════════
const PRICE_MAP = {
  // ─── Shop Pro ฿199/เดือน ───
  "price_1TYKnm3ZvivzvZ6qHQpT6tDf": { type: "subscription", plan: "pro",        monthlyCredits: 200 },
  "price_1TYKnm3ZvivzvZ6qmXeH3i2a": { type: "subscription", plan: "pro",        monthlyCredits: 200 },
  // ─── Advance ฿499/เดือน ───
  "price_1TYKrd3ZvivzvZ6qQ2P0rHIg": { type: "subscription", plan: "advance",    monthlyCredits: 500 },
  "price_1TYKre3ZvivzvZ6qlqgiu8t5": { type: "subscription", plan: "advance",    monthlyCredits: 500 },
  // ─── Business ฿999/เดือน ───
  "price_1Tg4zU3ZvivzvZ6ql61Q0szc": { type: "subscription", plan: "business",   monthlyCredits: 1000 },
  "price_1Tg4zU3ZvivzvZ6qP2AE2Yz0": { type: "subscription", plan: "business",   monthlyCredits: 1000 },
  // ─── Enterprise ฿2,990/เดือน ───
  "price_1TYKv33ZvivzvZ6qDs5eBbqA": { type: "subscription", plan: "enterprise", monthlyCredits: 0 },
  "price_1TYKv33ZvivzvZ6q9dIPU3ud": { type: "subscription", plan: "enterprise", monthlyCredits: 0 },
  // ─── เติมเครดิต (One-time) ───
  "price_1TYLy93ZvivzvZ6qMaWLnlhH": { type: "credit", amount: 100 },
  "price_1TYLyA3ZvivzvZ6q78LPY9Fh": { type: "credit", amount: 500 },
  "price_1TYLy93ZvivzvZ6qXziQSdMo": { type: "credit", amount: 1000 },
  "price_1Tg56f3ZvivzvZ6qX4163cg5": { type: "credit", amount: 3000 },
};

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// เพิ่มเครดิตให้ร้านค้า (ใช้ร่วมกันหลายที่) — atomic กัน race condition ตอน event ซ้อนกัน
async function addCreditsToShop(shopId, amount) {
  if (!shopId || amount <= 0) return;
  const { data } = await supabase.rpc('add_shop_credit', { p_shop_id: shopId, p_amount: amount });
  return data?.[0]?.new_balance;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // ── Rate Limiting ──
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  if (!checkRateLimit(ip)) {
    console.warn(`[SECURITY] Stripe webhook rate limited: ${ip}`);
    return res.status(429).send('Too Many Requests');
  }

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // ── Idempotency guard: กัน Stripe ส่ง event ซ้ำ (retry ตอน response ช้า/หลุดกลางทาง)
  // แล้วเติมเครดิต/อัปเดต tier ซ้ำ — insert event.id ก่อน ถ้าชนซ้ำ (unique violation) แปลว่า
  // เคยประมวลผลไปแล้ว ข้ามได้เลย ถ้า error เป็นแบบอื่น (เช่น ตารางยังไม่ถูกสร้าง) ให้ทำงานต่อไป
  // แบบ fail-open กันไม่ให้ webhook พังทั้งระบบเพราะ migration ยังไม่รัน
  const { error: dupError } = await supabase
    .from('stripe_processed_events')
    .insert({ event_id: event.id, event_type: event.type });
  if (dupError) {
    if (dupError.code === '23505') {
      console.log(`[Stripe] duplicate event ${event.id} (${event.type}) — skipped`);
      return res.status(200).json({ received: true, duplicate: true });
    }
    console.warn('[Stripe] idempotency check failed (non-duplicate error), proceeding anyway:', dupError.message);
  }

  try {
    // ══════════════════════════════════════
    // checkout.session.completed
    // → อัปเดต tier + บันทึก customer_id + เพิ่มเครดิต (กรณีซื้อเครดิต)
    // ══════════════════════════════════════
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const shopId = session.client_reference_id;
      if (!shopId) return res.status(200).json({ received: true });

      // บันทึก Stripe Customer ID เพื่อใช้กับ proration ในอนาคต
      if (session.customer) {
        await supabase.from('shop_profiles')
          .update({ stripe_customer_id: session.customer })
          .eq('id', shopId);
      }

      // บันทึก Stripe Subscription ID
      if (session.subscription) {
        await supabase.from('shop_profiles')
          .update({ stripe_subscription_id: session.subscription })
          .eq('id', shopId);
      }

      // อ่าน priceId จาก metadata ก่อน (เร็วกว่า ไม่ต้องเรียก API เพิ่ม)
      // fallback: listLineItems สำหรับ session เก่าที่ไม่มี metadata
      let priceId = session.metadata?.priceId;
      if (!priceId) {
        try {
          const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 1 });
          priceId = lineItems.data[0]?.price?.id;
        } catch (e) {
          console.warn('[Stripe] listLineItems failed:', e.message);
        }
      }
      const item = PRICE_MAP[priceId];
      if (!item) return res.status(200).json({ received: true });

      if (item.type === 'subscription') {
        // อัปเดต tier + บันทึก tier ที่ Stripe เก็บเงินจริง (เทียบกับ tier ที่ Admin อาจตั้งมือทับ)
        let periodEnd = null;
        if (session.subscription) {
          try {
            const sub = await stripe.subscriptions.retrieve(session.subscription);
            periodEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;
          } catch (e) { console.warn('[Stripe] subscriptions.retrieve failed:', e.message); }
        }
        await supabase.from('shop_profiles')
          .update({ subscription_tier: item.plan, stripe_billed_tier: item.plan, stripe_period_end: periodEnd })
          .eq('id', shopId);
        // ปลดล็อกทันทีถ้าร้านนี้เคย trial_expired มาก่อน (ไม่ต้องรอ cron รอบถัดไป) — แยก update
        // ต่างหากกันพัง เผื่อคอลัมน์ status ยังไม่ถูกสร้าง (ไม่ให้กระทบการอัปเดต tier หลักด้านบน)
        try {
          await supabase.from('shop_profiles').update({ status: 'active' }).eq('id', shopId);
        } catch (e) { console.warn('[Stripe] reset trial status failed (non-fatal):', e.message); }
        // เพิ่มเครดิตทันที — ไม่รอ invoice.payment_succeeded เพราะ event อาจ fire ก่อน customer_id ถูกบันทึก
        if (item.monthlyCredits > 0) {
          const newBalance = await addCreditsToShop(shopId, item.monthlyCredits);
          console.log(`[Stripe] +${item.monthlyCredits} credits (initial sub) → shop ${shopId}, balance: ${newBalance}`);
        }
        await supabase.from('credit_purchase_history').insert({
          shop_id: shopId,
          amount_paid: (session.amount_total || 0) / 100,
          status: 'completed',
          created_at: new Date().toISOString()
        }).then(() => {});
        console.log(`[Stripe] subscription tier → ${item.plan} for shop ${shopId}`);

      } else if (item.type === 'credit') {
        // เติมเครดิต one-time
        const newBalance = await addCreditsToShop(shopId, item.amount);
        console.log(`[Stripe] +${item.amount} credits → shop ${shopId}, balance: ${newBalance}`);
      }
    }

    // ══════════════════════════════════════
    // invoice.payment_succeeded
    // → เติมเครดิตรายเดือนอัตโนมัติเมื่อ subscription ต่ออายุ
    // ══════════════════════════════════════
    if (event.type === 'invoice.payment_succeeded') {
      const invoice = event.data.object;

      if (!invoice.subscription) return res.status(200).json({ received: true });
      // subscription_create = invoice แรก จัดการใน checkout.session.completed แล้ว
      // subscription_cycle = ต่ออายุรายเดือน/รายปี → เพิ่มเครดิต
      if (invoice.billing_reason === 'subscription_create') {
        console.log(`[Stripe] invoice.payment_succeeded subscription_create → skipped (handled by checkout handler)`);
        return res.status(200).json({ received: true });
      }
      const customerId = invoice.customer;
      if (!customerId) return res.status(200).json({ received: true });

      // หาร้านค้าจาก stripe_customer_id
      const { data: shop } = await supabase
        .from('shop_profiles')
        .select('id, subscription_tier, stripe_customer_id')
        .eq('stripe_customer_id', customerId)
        .maybeSingle();

      if (!shop) {
        console.warn(`[Stripe] invoice.payment_succeeded: ไม่พบร้านค้าสำหรับ customer ${customerId}`);
        return res.status(200).json({ received: true });
      }

      // หา price ID จาก invoice lines เพื่อรู้ว่า plan ไหน
      const lineItem = invoice.lines?.data?.[0];
      const priceId = lineItem?.price?.id;
      const item = priceId ? PRICE_MAP[priceId] : null;
      const monthlyCredits = item?.monthlyCredits ?? 0;

      // บันทึก tier ที่ Stripe เก็บเงินจริง + วันต่ออายุครั้งถัดไป (เทียบกับ tier ที่ Admin อาจตั้งมือทับ)
      const periodEnd = lineItem?.period?.end ? new Date(lineItem.period.end * 1000).toISOString() : null;
      if (item?.plan) {
        await supabase.from('shop_profiles')
          .update({ stripe_billed_tier: item.plan, stripe_period_end: periodEnd })
          .eq('id', shop.id);
      }

      if (monthlyCredits > 0) {
        const newBalance = await addCreditsToShop(shop.id, monthlyCredits);
        console.log(`[Stripe] monthly +${monthlyCredits} credits → shop ${shop.id} (${shop.subscription_tier}), balance: ${newBalance}`);
      } else {
        console.log(`[Stripe] invoice.payment_succeeded for ${shop.subscription_tier} plan — no credit addition needed`);
      }
    }

    // ══════════════════════════════════════
    // customer.subscription.updated
    // → log เมื่อมีการ cancel_at_period_end (ไม่ downgrade ทันที ให้ deleted event จัดการ)
    // ══════════════════════════════════════
    if (event.type === 'customer.subscription.updated') {
      const subscription = event.data.object;
      if (subscription.cancel_at_period_end) {
        const customerId = subscription.customer;
        const { data: shop } = await supabase
          .from('shop_profiles').select('id').eq('stripe_customer_id', customerId).maybeSingle();
        if (shop) {
          console.log(`[Stripe] subscription set to cancel at period end → shop ${shop.id}`);
        }
      }
    }

    // ══════════════════════════════════════
    // customer.subscription.deleted
    // → Downgrade กลับ normal เมื่อ subscription ถูกยกเลิก
    // ══════════════════════════════════════
    if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object;
      const customerId = subscription.customer;

      const { data: shop } = await supabase
        .from('shop_profiles')
        .select('id')
        .eq('stripe_customer_id', customerId)
        .maybeSingle();

      if (shop) {
        await supabase.from('shop_profiles')
          .update({ subscription_tier: 'normal', stripe_subscription_id: null, stripe_billed_tier: null, stripe_period_end: null })
          .eq('id', shop.id);
        console.log(`[Stripe] subscription cancelled → shop ${shop.id} downgraded to normal`);
      }
    }

  } catch (err) {
    console.error(`[Stripe] Webhook DB error (${event.type}):`, err.message);
    return res.status(500).end();
  }

  return res.status(200).json({ received: true });
}
