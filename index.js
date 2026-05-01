const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

app.post('/webhook', async (req, res) => {
  const event = req.body.events && req.body.events[0];
  if (!event) return res.sendStatus(200);

  const lineUserId = event.source.userId;
  const replyToken = event.replyToken;

  // 1. จัดการข้อความ (สรุปยอด)
  if (event.type === 'message' && event.message.type === 'text') {
    const userMsg = event.message.text;
    if (userMsg === 'สรุปวันนี้') {
        const today = new Date().toISOString().split('T')[0];
        const { data } = await supabase.from('ledger_transactions').select('amount, type').gte('created_at', today);
        const inc = data ? data.filter(d => d.type === 'income').reduce((s, d) => s + Number(d.amount), 0) : 0;
        const exp = data ? data.filter(d => d.type === 'expense').reduce((s, d) => s + Number(d.amount), 0) : 0;
        return await reply(replyToken, `📊 สรุปยอดวันนี้\n🟢 รายรับ: ${inc} บ.\n🔴 รายจ่าย: ${exp} บ.\n⚖️ คงเหลือ: ${inc - exp} บ.`);
    }
  }

  // 2. จัดการรูปภาพ (สลิป/บิล + อัปโหลด Storage)
  if (event.type === 'message' && event.message.type === 'image') {
    try {
      let { data: shop } = await supabase.from('shop_profiles').select('id').eq('owner_line_id', lineUserId).single();
      if (!shop) return await reply(replyToken, "ยังไม่พบร้านค้าของคุณในระบบครับ");

      // ดึงรูปจาก LINE
      const lineRes = await axios.get(`https://api-data.line.me/v2/bot/message/${event.message.id}/content`, {
        headers: { 'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` },
        responseType: 'arraybuffer'
      });
      const imageBuffer = Buffer.from(lineRes.data);
      const slipHash = crypto.createHash('md5').update(imageBuffer).digest('hex');
      const fileName = `${shop.id}/${slipHash}.jpg`;

      // อัปโหลดรูปขึ้น Storage (Bucket: slips)
      const { error: uploadError } = await supabase.storage
        .from('slips')
        .upload(fileName, imageBuffer, { contentType: 'image/jpeg', upsert: true });

      const { data: urlData } = supabase.storage.from('slips').getPublicUrl(fileName);
      const publicUrl = urlData.publicUrl;

      // ใช้ Gemini 3 Flash อ่านข้อมูล
      const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
      const prompt = "Analyze image. If it is a bank slip: type='income'. If it is a receipt/bill: type='expense'. JSON ONLY: { 'type': 'income'|'expense', 'amount': number, 'sender_or_vendor': 'string', 'note': 'string' }";
      
      const result = await model.generateContent([
        prompt,
        { inlineData: { data: imageBuffer.toString('base64'), mimeType: "image/jpeg" } }
      ]);
      const aiData = JSON.parse(result.response.text().replace(/```json|```/g, "").trim());

      // บันทึกลงตาราง ledger_transactions
      const { error: dbError } = await supabase.from('ledger_transactions').insert([{ 
        shop_id: shop.id,
        amount: aiData.amount,
        type: aiData.type,
        sender_name: aiData.sender_or_vendor,
        note: aiData.note,
        slip_hash: slipHash,
        slip_url: publicUrl,
        raw_data: aiData
      }]);

      if (dbError) {
        if (dbError.code === '23505') return await reply(replyToken, "⚠️ รายการนี้เคยบันทึกไปแล้วครับ");
        throw dbError;
      }

      await supabase.rpc('decrement_credit', { shop_id_input: shop.id });

      const statusIcon = aiData.type === 'income' ? '🟢' : '🔴';
      await reply(replyToken, `${statusIcon} บันทึกเรียบร้อย!\nประเภท: ${aiData.type === 'income' ? 'รายรับ' : 'รายจ่าย'}\nยอดเงิน: ${aiData.amount} บาท\nบันทึกรูปลงคลังเรียบร้อยครับ`);

    } catch (err) {
      console.error(err);
      await reply(replyToken, "⚠️ ขออภัย AI ประมวลผลภาพไม่สำเร็จครับ");
    }
  }
  res.sendStatus(200);
});

async function reply(token, message) {
  return axios.post('https://api.line.me/v2/bot/message/reply', {
    replyToken: token,
    messages: [{ type: 'text', text: message }]
  }, { headers: { 'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` } });
}

app.listen(8080);
