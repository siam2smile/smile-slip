import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export default async function handler(req, res) {
  const { code, state: shopId } = req.query;
  if (!code) return res.redirect('/dashboard?error=no_code');

  try {
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

    // บันทึกลงตารางใหม่ที่คุณ Vespa เพิ่งสร้าง
    const { error } = await supabase
      .from('shop_google_configs')
      .upsert({
        shop_id: shopId,
        google_refresh_token: tokens.refresh_token,
        google_access_token: tokens.access_token,
        // google_folder_id และ google_sheet_id จะถูกเติมทีหลังโดยระบบ AI Sync
        updated_at: new Date(),
      });

    if (error) throw error;

    // ส่งกลับหน้า Dashboard พร้อมบอกว่า Sync สำเร็จ
    res.redirect(`/dashboard?userId=${shopId}&sync=success`);
    
  } catch (error) {
    console.error('Callback Error:', error);
    // ส่ง Error กลับไปที่หน้าจอเพื่อให้เราวิเคราะห์ได้ง่ายขึ้น
    res.redirect(`/dashboard?error=auth_failed&details=${encodeURIComponent(error.message)}`);
  }
}