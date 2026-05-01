import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  const { code, state: shopId } = req.query;

  if (!code) {
    return res.redirect('/dashboard?error=no_code');
  }

  try {
    // 1. แลกเปลี่ยน Code เป็น Access Token จาก Google
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: process.env.GOOGLE_REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });

    const tokens = await response.json();

    if (tokens.error) throw new Error(tokens.error_description);

    // 2. บันทึกลงตาราง shop_google_configs ใน Supabase
    // เราจะบันทึก refresh_token ไว้เพื่อให้ AI ใช้เข้าถึงไฟล์ได้ตลอดเวลา
    const { error } = await supabase
      .from('shop_google_configs')
      .upsert({
        shop_id: shopId,
        google_refresh_token: tokens.refresh_token,
        google_access_token: tokens.access_token,
        updated_at: new Date(),
      });

    if (error) throw error;

    // 3. เมื่อเสร็จแล้ว ให้เด้งกลับไปที่หน้า Dashboard
    res.redirect(`/dashboard?userId=${shopId}&sync=success`);
    
  } catch (error) {
    console.error('Google Auth Error:', error);
    res.redirect(`/dashboard?error=auth_failed`);
  }
}