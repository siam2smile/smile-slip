import { createClient } from '@supabase/supabase-js';
import axios from 'axios';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  // รับค่า email เพิ่มเข้ามาจากหน้าฟอร์มลงทะเบียน
  const { shopName, userType, taxId, phone, address, lineUserId, ownerName, email } = req.body;

  try {
    // 1. บันทึกหรืออัปเดตข้อมูลลง shop_profiles
    const { data: profile, error: profileError } = await supabase
      .from('shop_profiles')
      .upsert({ 
        owner_line_id: lineUserId, // นี่คือ ID จาก LINE ของจริง
        shop_name: shopName,
        user_type: userType,
        tax_id: taxId,
        phone: phone,
        address: address,
        email: email, // เก็บ Email แยกไว้เพื่อใช้ล็อกอินหรือติดต่อ Google Drive
        owner_name: ownerName
      }, { onConflict: 'owner_line_id' })
      .select()
      .single();

    if (profileError) {
      console.error('Supabase Profile Error:', profileError);
      return res.status(400).json({ error: "บันทึกโปรไฟล์ไม่สำเร็จ: " + profileError.message });
    }

    // 2. ตรวจสอบ/สร้างกระเป๋าเครดิต (shop_credits)
    const { error: creditError } = await supabase
      .from('shop_credits')
      .upsert({ 
        shop_id: profile.id,
        updated_at: new Date()
      }, { onConflict: 'shop_id' });

    if (creditError) console.error('Credit Init Error:', creditError);

    // 3. ส่ง LINE แจ้งเตือนความสำเร็จ (เป็นการยืนยันการสมัครแทนรหัสผ่าน)
    try {
      await axios.post('https://api.line.me/v2/bot/message/push', {
        to: lineUserId,
        messages: [{
          type: 'text',
          text: `ยินดีต้อนรับคุณ ${ownerName} เข้าสู่ Smile Slip Pro ค่ะ! 😊\n\nลงทะเบียนร้าน ${shopName} เรียบร้อยแล้ว\n📧 อีเมลระบบ: ${email}\n📍 สถานะ: เชื่อมต่อ LINE สำเร็จ\n\nคุณสามารถใช้ LINE หรืออีเมลนี้ในการเข้าสู่หน้า Dashboard ได้ทันทีค่ะ! ✨`
        }]
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
        }
      });
    } catch (lineErr) {
      console.error('LINE Notify Error:', lineErr.response?.data || lineErr.message);
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Final API Error:', err);
    return res.status(500).json({ error: "ระบบขัดข้อง: " + err.message });
  }
}