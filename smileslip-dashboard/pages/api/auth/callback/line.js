import axios from 'axios';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).send('Server configuration error: Missing Supabase URL or Key');
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const { code } = req.query;

  if (!code) return res.status(400).send('Missing code');

  try {
    // 1. แลกเปลี่ยน Access Token
    const tokenResponse = await axios.post('https://api.line.me/oauth2/v2.1/token', 
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: `${process.env.NEXT_PUBLIC_BASE_URL}/api/auth/callback/line`,
        client_id: process.env.NEXT_PUBLIC_LINE_LOGIN_CHANNEL_ID || '2009797558',
        // ✅ แก้ไขบรรทัดนี้ให้ตรงกับชื่อตัวแปรใน deploy-web.sh
        client_secret: process.env.LINE_LOGIN_SECRET, 
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const { access_token } = tokenResponse.data;

    // 2. ดึงโปรไฟล์จาก LINE
    const profileResponse = await axios.get('https://api.line.me/v2/profile', {
      headers: { Authorization: `Bearer ${access_token}` }
    });

    const lineUserId = profileResponse.data.userId;
    const lineName = profileResponse.data.displayName;

    // 3. ตรวจสอบในตาราง shop_profiles
    const { data: shop, error } = await supabase
      .from('shop_profiles')
      .select('*')
      .eq('owner_line_id', lineUserId.trim())
      .maybeSingle();

    if (shop) {
      // ถ้าพบข้อมูลแล้ว (เคยสมัครไว้แล้ว) ให้ไป Dashboard เลย
      return res.redirect(`/dashboard?userId=${lineUserId}`);
    } else {
      // ถ้าไม่พบ ให้ไปหน้าสมัครสมาชิกใหม่
      return res.redirect(`/register?userId=${lineUserId}&name=${encodeURIComponent(lineName)}`);
    }

  } catch (error) {
    console.error('LINE Login Error:', error.message);
    // ถ้ามี Error ก็ให้แจ้งออกมาตรงๆ จะได้แก้ถูกจุด
    return res.status(500).send(`Authentication Failed: ${error.message}`);
  }
}