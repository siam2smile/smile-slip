cat <<EOF > index.js
const express = require('express');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const crypto = require('crypto');

const app = express();
app.use(express.json());

// เชื่อมต่อ Supabase และ Gemini AI
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

app.post('/webhook', async (req, res) => {
  const events = req.body.events;
  for (let event of events) {
    if (event.type === 'message' && event.message.type === 'image') {
      const lineUserId = event.source.userId;
      const replyToken = event.replyToken;

      try {
        // 1. ดึงข้อมูลร้านค้าจาก Line User ID (พนักงานหรือเจ้าของที่ส่งรูปมา)
        const { data: shop, error: shopErr } = await supabase
          .from('shop_profiles')
          .select('*, shop_credits(balance_credits)')
          .eq('owner_line_id', lineUserId)
          .single();

        if (shopErr || !shop) {
          return sendLineReply(replyToken, "⚠️ ไม่พบข้อมูลร้านค้าของคุณ กรุณาลงทะเบียนก่อนใช้งานครับ");
        }

        // 2. เช็คเครดิต (ต้องมีอย่างน้อย 1 เครดิต)
        if (shop.shop_credits.balance_credits <= 0) {
          return sendLineReply(replyToken, "❌ เครดิตของคุณหมดแล้ว กรุณาเติมเงินเพื่อใช้งานต่อครับ");
        }

        // 3. ดึงรูปภาพจาก LINE
        const imageBuffer = await getLineImage(event.message.id);
        
        // 4. สร้าง Hash เพื่อกันสลิปซ้ำ (ใช้ข้อมูลภาพดิบ)
        const slipHash = crypto.createHash('md5').update(imageBuffer).digest('hex');
        const { data: existingSlip } = await supabase.from('ledger_transactions').select('id').eq('slip_hash', slipHash).single();
        
        if (existingSlip) {
          return sendLineReply(replyToken, "⚠️ สลิปนี้ถูกบันทึกไปแล้วครับ ไม่สามารถบันทึกซ้ำได้");
        }

        // 5. ส่งให้ Gemini AI วิเคราะห์สลิป
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const prompt = "นี่คือสลิปธนาคาร ให้สกัดข้อมูลดังนี้ในรูปแบบ JSON: {amount: number, date: string, receiver_name: string, sender_name: string, bank_name: string, ref_id: string, note: string}. ถ้าข้อมูลไหนหาไม่เจอให้ใส่ null";
        
        const result = await model.generateContent([
          prompt,
          { inlineData: { data: imageBuffer.toString("base64"), mimeType: "image/jpeg" } }
        ]);
        
        const aiResponse = JSON.parse(result.response.text().replace(/\\\`json|\\\`/g, ''));
