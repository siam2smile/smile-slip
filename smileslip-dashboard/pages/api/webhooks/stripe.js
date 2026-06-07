import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

export const config = { api: { bodyParser: false } };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

const PRICE_MAP = {
  "price_1TfERr3ZvivzvZ6qPXOhc10t": { type: "subscription", plan: "pro" },
  "price_1TfERr3ZvivzvZ6qbsLKKPlV": { type: "subscription", plan: "pro" },
  "price_1TfERs3ZvivzvZ6qw9SB10YE": { type: "subscription", plan: "advance" },
  "price_1TfERs3ZvivzvZ6qPKQaBSHQ": { type: "subscription", plan: "advance" },
  "price_1TfERs3ZvivzvZ6qrTxPwYKs": { type: "subscription", plan: "super" },
  "price_1TfERt3ZvivzvZ6qgpoAJvaU": { type: "subscription", plan: "super" },
  "price_1TfERt3ZvivzvZ6qfbOMCZnp": { type: "credit", amount: 100 },
  "price_1TfERu3ZvivzvZ6q96qkkfKx": { type: "credit", amount: 500 },
  "price_1TfERu3ZvivzvZ6qpTZDUhHZ": { type: "credit", amount: 1000 },
};

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const shopId = session.client_reference_id;
    if (!shopId) return res.status(200).json({ received: true });

    try {
      const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
      const priceId = lineItems.data[0]?.price?.id;
      const item = PRICE_MAP[priceId];
      if (!item) return res.status(200).json({ received: true });

      if (item.type === 'subscription') {
        const newTier = item.plan;
        await supabase.from('shop_profiles').update({ subscription_tier: newTier }).eq('id', shopId);
        await supabase.from('credit_purchase_history').insert({
          shop_id: shopId, amount_paid: session.amount_total / 100,
          status: 'completed', created_at: new Date().toISOString()
        });
        console.log(`[Stripe] tier → ${newTier} for shop ${shopId}`);

      } else if (item.type === 'credit') {
        const { data: creditRow } = await supabase.from('shop_credits').select('balance_credits').eq('shop_id', shopId).maybeSingle();
        const newBalance = (creditRow?.balance_credits || 0) + item.amount;
        await supabase.from('shop_credits').upsert({ shop_id: shopId, balance_credits: newBalance }, { onConflict: 'shop_id' });
        console.log(`[Stripe] +${item.amount} credits for shop ${shopId}, new total: ${newBalance}`);
      }
    } catch (err) {
      console.error('Stripe webhook DB error:', err.message);
      return res.status(500).end();
    }
  }

  return res.status(200).json({ received: true });
}
