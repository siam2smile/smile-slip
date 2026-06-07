import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { priceId, shopId } = req.body;
  if (!priceId || !shopId) return res.status(400).json({ error: 'ข้อมูลไม่ครบ' });

  const itemConfig = PRICE_MAP[priceId];
  if (!itemConfig) return res.status(400).json({ error: 'ไม่พบ Price ID นี้ในระบบ' });

  try {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.FRONTEND_URL;
    const isSubscription = itemConfig.type === 'subscription';
    const session = await stripe.checkout.sessions.create({
      payment_method_types: isSubscription ? ['card'] : ['card', 'promptpay'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: isSubscription ? 'subscription' : 'payment',
      success_url: `${baseUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/pricing`,
      client_reference_id: shopId,
    });
    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Checkout error:', err.message);
    return res.status(500).json({ error: 'เกิดข้อผิดพลาดในการสร้าง Session ชำระเงิน' });
  }
}
