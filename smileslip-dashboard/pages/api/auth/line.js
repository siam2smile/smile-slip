import { createClient } from '@supabase/supabase-js';
import { getRolesForLineId } from '../../../lib/identity';

// ใช้ service role key เสมอสำหรับ API route (bypass RLS)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
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
      // 1. เช็คก่อนว่าไลไอดีนี้ผูกกับร้านไหนอยู่แล้วบ้าง (เจ้าของ/แอดมิน) — ใช้ helper กลาง
      //    แทน .single() เดิม ที่จะ throw ทันทีถ้าเจอแถวซ้ำ (เคยเกิดจริงจากบั๊กจุดนี้เอง)
      const roles = await getRolesForLineId(lineUserId);
      const ownerRole = roles.find(r => r.role === 'owner');

      let shop;
      if (ownerRole) {
        // เป็นเจ้าของร้านอยู่แล้ว — ดึงข้อมูลเต็มมาคืน (ไม่ insert ซ้ำ)
        const { data: existingShop, error: fetchError } = await supabase
          .from('shop_profiles')
          .select('*')
          .eq('id', ownerRole.shopId)
          .maybeSingle();
        if (fetchError) throw fetchError;
        shop = existingShop;
      } else if (roles.length === 0) {
        // ยังไม่มีบทบาทใดๆ เลย (ไม่ใช่ทั้งเจ้าของและแอดมิน) → ลงทะเบียนร้านใหม่อัตโนมัติ
        const newShopData = {
          owner_line_id: lineUserId,
          shop_name: displayName || 'ร้านค้าใหม่ (รอกำหนดชื่อ)',
        };

        const { data: newShop, error: insertError } = await supabase
          .from('shop_profiles')
          .insert([newShopData])
          .select()
          .single();

        if (insertError) throw insertError;
        shop = newShop;

        // สร้าง shop_credits ให้ร้านใหม่ (ป้องกัน bot crash ตอนเช็คเครดิต)
        await supabase.from('shop_credits').insert({
          shop_id: shop.id,
          balance_credits: 20
        });
      } else {
        // มีบทบาทเป็นแอดมินร้านอื่นอยู่แล้วแต่ไม่ใช่เจ้าของที่ไหนเลย — endpoint นี้ออกแบบมา
        // สำหรับ flow เจ้าของร้านเท่านั้น คืน roles กลับไปให้ฝั่งเว็บตัดสินใจแทน (ไม่เดา/ไม่สร้างร้านทับ)
        return res.status(200).json({ success: true, requiresRoleSelection: true, roles });
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
    const redirectUri = encodeURIComponent(`${process.env.NEXT_PUBLIC_BASE_URL || process.env.FRONTEND_URL}/api/auth/callback/line`);
    
    if (!clientId) {
      return res.status(500).json({ error: 'ยังไม่ได้ตั้งค่า LINE_LOGIN_CHANNEL_ID ใน Environment' });
    }

    // state เดิมเป็นแค่ค่าสุ่มไม่มีความหมาย ไม่เคยถูกตรวจสอบฝั่ง callback เลยด้วยซ้ำ — ใช้ตรงนี้
    // แทนเพื่อพก "เจตนา" (register/login) ข้ามรอบ OAuth ไปให้ callback/line.js รู้ว่าจะให้ทำอะไร
    // ถ้าเจอไลไอดีที่มีบทบาทอยู่แล้วพอดี 1 ร้าน (ปัญหาเดิม: ปุ่ม "สมัครสมาชิก" จาก register.js
    // กับปุ่ม "เข้าสู่ระบบ" จาก login.js ยิงไป endpoint เดียวกันนี้ทั้งคู่ callback แยกไม่ออกว่า
    // ใครตั้งใจจะสมัครร้านใหม่ ใครแค่จะ login ร้านเดิม เลยพา auto เข้าร้านเดิมเสมอไม่ว่าใครก็ตาม)
    const intent = req.query.intent === 'register' ? 'register' : 'login';
    const randomSuffix = Math.random().toString(36).substring(7);
    const state = `${intent}:${randomSuffix}`;
    const lineAuthUrl = `https://access.line.me/oauth2/v2.1/authorize?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&state=${state}&scope=profile%20openid`;
    
    // เด้งไปหน้า LINE ยืนยันตัวตนสีเขียวๆ
    return res.redirect(lineAuthUrl);
  } 
  
  else {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
}