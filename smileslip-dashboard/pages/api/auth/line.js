import { createClient } from '@supabase/supabase-js';

// เชื่อมต่อฐานข้อมูล Supabase
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_KEY
);

export default async function handler(req, res) {
  // =========================================================
  // กรณีที่ 1: หน้าเว็บส่งข้อมูล Profile มาให้ (POST Request) - นิยมใช้กับ LIFF
  // =========================================================
  if (req.method === 'POST') {
    const { lineUserId, displayName, pictureUrl } = req.body;

    if (!lineUserId) {
      return res.status(400).json({ success: false, error: 'ไม่พบข้อมูล LINE User ID' });
    }

    try {
      // 1. เช็คก่อนว่ามีร้านค้านี้ในระบบหรือยัง
      let { data: shop, error: fetchError } = await supabase
        .from('shop_profiles')
        .select('*')
        .eq('owner_line_id', lineUserId)
        .single();

      // 2. ถ้ายังไม่มีร้านค้า (ล็อคอินครั้งแรก) -> ทำการ "ลงทะเบียน" อัตโนมัติ
      if (!shop) {
        const newShopData = {
          owner_line_id: lineUserId,
          shop_name: displayName || 'ร้านค้าใหม่ (รอกำหนดชื่อ)',
          // ถ้ามีคอลัมน์รูปโปรไฟล์ใน DB สามารถเพิ่ม pictureUrl ไปด้วยได้
        };

        const { data: newShop, error: insertError } = await supabase
          .from('shop_profiles')
          .insert([newShopData])
          .select()
          .single();

        if (insertError) throw insertError;
        shop = newShop;
      }

      // 3. ส่งข้อมูลร้านค้ากลับไปให้หน้าเว็บเพื่อเข้าสู่ระบบ
      return res.status(200).json({ success: true, shop });

    } catch (error) {
      console.error('Login/Register Error:', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  } 
  
  // =========================================================
  // กรณีที่ 2: ใช้สำหรับ Redirect ไปหน้าล็อคอินของ LINE (GET Request)
  // =========================================================
  else if (req.method === 'GET') {
    // ต้องใช้ Channel ID ของ "LINE Login" (ไม่ใช่ Messaging API นะครับ)
    const clientId = "2009797558"; 
    
    // ตั้งค่า URL ที่จะให้ LINE เด้งกลับมาหลังจากลูกค้ากดยืนยัน (ต้องตรงกับใน LINE Developers)
    const redirectUri = encodeURIComponent(`${process.env.NEXT_PUBLIC_BASE_URL}/api/auth/callback/line`);
    
    if (!clientId) {
      return res.status(500).json({ error: 'ยังไม่ได้ตั้งค่า LINE_LOGIN_CHANNEL_ID ใน Environment' });
    }

    const state = Math.random().toString(36).substring(7);
    const lineAuthUrl = `https://access.line.me/oauth2/v2.1/authorize?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&state=${state}&scope=profile%20openid`;
    
    // เด้งไปหน้า LINE ยืนยันตัวตนสีเขียวๆ
    return res.redirect(lineAuthUrl);
  } 
  
  else {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
}