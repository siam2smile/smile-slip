import axios from 'axios';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export default async function handler(req, res) {
  const { code } = req.query;
  
  try {
    // 1. แลกเปลี่ยน code เป็น Access Token
    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: 'https://smileslip-dashboard-832247688217.asia-southeast1.run.app/api/auth/callback/line',
      client_id: process.env.LINE_LOGIN_ID,
      client_secret: process.env.LINE_LOGIN_SECRET
    });

    const tokenRes = await axios.post('https://api.line.me/oauth2/v2.1/token', tokenParams);
    
    // 2. ดึงข้อมูล Profile ของเจ้าของร้าน
    const profileRes = await axios.get('https://api.line.me/v2/profile', {
      headers: { Authorization: `Bearer ${tokenRes.data.access_token}` }
    });

    const { userId, displayName } = profileRes.data;

    // 3. ตรวจสอบใน Supabase ว่า LINE ID นี้เคยลงทะเบียนหรือยัง
    const { data: existingShop, error } = await supabase
      .from('shop_profiles')
      .select('owner_line_id')
      .eq('owner_line_id', userId)
      .single();

    if (existingShop) {
      // 🌟 กรณีที่ 1: เคยสมัครแล้ว (ส่งไปหน้าหลัก/Dashboard)
      res.redirect(`/dashboard?userId=${userId}`);
    } else {
      // 🌟 กรณีที่ 2: ยังไม่เคยสมัคร (ส่งไปหน้าสมัครสมาชิก)
      res.redirect(`/register?userId=${userId}&name=${encodeURIComponent(displayName)}`);
    }

  } catch (err) {
    console.error('Login Callback Error:', err);
    res.status(500).send("Login Failed");
  }
}
