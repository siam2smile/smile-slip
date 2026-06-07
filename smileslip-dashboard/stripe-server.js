const express = require('express');
const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
// ใช้ Service Role Key เพื่อให้ Webhook มีสิทธิ์จัดการข้ามกำแพง RLS ได้สมบูรณ์
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Map ข้อมูล Price ID ให้ตรงกับใน Frontend (คงไว้ตามโครงสร้างเดิมของคุณ)
const PRICE_MAP = {
  "price_1TYKnm3ZvivzvZ6qHQpT6tDf": { type: "subscription", plan: "Shop Pro" },
  "price_1TYKnm3ZvivzvZ6qmXeH3i2a": { type: "subscription", plan: "Shop Pro" },
  "price_1TYKrd3ZvivzvZ6qQ2P0rHIg": { type: "subscription", plan: "Advance" },
  "price_1TYKre3ZvivzvZ6qlqgiu8t5": { type: "subscription", plan: "Advance" },
  "price_1TYKv33ZvivzvZ6qDs5eBbqA": { type: "subscription", plan: "Super" },
  "price_1TYKv33ZvivzvZ6q9dIPU3ud": { type: "subscription", plan: "Super" },
  
  "price_1TYLy93ZvivzvZ6qMaWLnlhH": { type: "credit", amount: 100 },
  "price_1TYLyA3ZvivzvZ6q78LPY9Fh": { type: "credit", amount: 500 },
  "price_1TYLy93ZvivzvZ6qXziQSdMo": { type: "credit", amount: 1000 }
};

// ==========================================
// API 1: สร้าง Checkout Session (ส่งไปให้หน้า Pricing เรียกใช้)
// ==========================================
app.post('/api/create-checkout-session', express.json(), async (req, res) => {
  try {
    const { priceId, shopId } = req.body;

    if (!priceId || !shopId) {
      return res.status(400).json({ error: 'ข้อมูล priceId หรือ shopId ไม่ครบถ้วน' });
    }

    const itemConfig = PRICE_MAP[priceId];
    if (!itemConfig) {
      return res.status(400).json({ error: 'ไม่พบข้อมูล Price ID นี้ในระบบ' });
    }

    const mode = itemConfig.type === 'subscription' ? 'subscription' : 'payment';

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card', 'promptpay'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: mode,
      success_url: `${process.env.FRONTEND_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/pricing`,
      client_reference_id: shopId, // ส่ง ID ของร้านไป
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error('Error creating checkout session:', error);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดในการสร้าง Session ชำระเงิน' });
  }
});

// ==========================================
// API 2: Webhook รับแจ้งเตือนเมื่อลูกค้าจ่ายเงินสำเร็จ (แก้ไขจุดพังทั้งหมดแล้ว)
// ==========================================
app.post('/webhook/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error(`Webhook Signature Error: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const shopId = session.client_reference_id; 
    
    try {
      const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
      const priceId = lineItems.data[0].price.id;
      const purchasedItem = PRICE_MAP[priceId];

      if (purchasedItem) {
        if (purchasedItem.type === 'subscription') {
          const PLAN_TO_TIER = { 'Shop Pro': 'pro', 'Advance': 'advance', 'Super': 'super' };
          const newTier = PLAN_TO_TIER[purchasedItem.plan];

          // อัปเดต subscription_tier ใน shop_profiles
          const { error: tierError } = await supabase
            .from('shop_profiles')
            .update({ subscription_tier: newTier })
            .eq('id', shopId);
          if (tierError) throw tierError;

          // บันทึกประวัติการซื้อ
          const { error } = await supabase
            .from('credit_purchase_history')
            .insert({
              shop_id: shopId,
              amount_paid: session.amount_total / 100,
              status: 'completed',
              created_at: new Date().toISOString()
            });

          if (error) throw error;
          console.log(`[Success] อัปเดต tier → ${newTier} และบันทึกประวัติซื้อแพ็กเกจ ${purchasedItem.plan} สำหรับร้านค้า ${shopId}`);

        } else if (purchasedItem.type === 'credit') {
          // [💡 แก้ไขจุดที่ 1] เปลี่ยนชื่อคอลัมน์จาก credit_balance -> balance_credits ให้ตรงกับ SQL ล่าสุด
          const { data: shop, error: fetchError } = await supabase
            .from('shop_credits')
            .select('balance_credits')
            .eq('shop_id', shopId)
            .maybeSingle(); // ปรับจาก .single() เพื่อป้องกันพังกรณีหาระเบียนไม่เจอ
          
          if (fetchError) throw fetchError; 
          
          const currentBalance = shop ? shop.balance_credits : 0;
          const newBalance = currentBalance + purchasedItem.amount;

          // บันทึกยอดเครดิตใหม่ลงตารางตรงๆ ด้วยคอลัมน์ที่ถูกต้องตามกฎเหล็ก SQL
          const { error: updateError } = await supabase
            .from('shop_credits')
            .upsert({ 
              shop_id: shopId, 
              balance_credits: newBalance, // แก้ชื่อคอลัมน์ให้ถูก
              updated_at: new Date().toISOString()
            }, { onConflict: 'shop_id' });
            
          if (updateError) throw updateError;
          console.log(`[Success] เติมเครดิต ${purchasedItem.amount} ให้ร้านค้า ${shopId} ยอดรวมใหม่: ${newBalance}`);
        }
      }
    } catch (error) {
      console.error('Database Update Error:', error);
      return res.status(500).end();
    }
  }

  res.json({ received: true });
});

// เปลี่ยนจาก const PORT = process.env.PORT || 3001; ให้เป็นด้านล่างนี้:
const PORT = parseInt(process.env.PORT) || 8080;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Smile Slip Backend รันอย่างเสถียรที่พอร์ต ${PORT}`);
});