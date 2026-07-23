import axios from 'axios';
import { createClient } from '@supabase/supabase-js';
import { getRolesForLineId } from '../../../../lib/identity';

export default async function handler(req, res) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

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
        redirect_uri: `${process.env.NEXT_PUBLIC_BASE_URL || process.env.FRONTEND_URL}/api/auth/callback/line`,
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

    // 3. ตรวจสอบว่าไลไอดีนี้ผูกกับร้านไหนบ้าง (เจ้าของ/แอดมิน) — ใช้ helper กลางแทน
    //    .maybeSingle() เดิม ที่เช็คแค่ owner_line_id ทำให้แอดมิน-ล้วน (ไม่ใช่เจ้าของที่ไหนเลย)
    //    ถูกเด้งไปหน้าสมัครสมาชิกใหม่ผิดๆ ทั้งที่มีบัญชีอยู่แล้ว
    const trimmedId = lineUserId.trim();
    const roles = await getRolesForLineId(trimmedId);

    if (roles.length === 0) {
      // ยังไม่มีบทบาทใดๆ เลย → ไปหน้าสมัครสมาชิกใหม่
      return res.redirect(`/register?userId=${trimmedId}&name=${encodeURIComponent(lineName)}`);
    } else if (roles.length === 1) {
      const r = roles[0];
      if (r.role === 'admin') {
        return res.redirect(`/dashboard?userId=${r.ownerId}&adminId=${trimmedId}`);
      }
      return res.redirect(`/dashboard?userId=${r.ownerId}`);
    } else {
      // ผูกกับหลายร้าน (เจ้าของร้านตัวเอง + แอดมินร้านอื่นพร้อมกัน) — ส่งต่อไปหน้า /login
      // ให้แสดงตัวเลือกร้าน (login.js อ่าน query นี้แล้วเรียก check-user ซ้ำเพื่อโชว์ picker)
      return res.redirect(`/login?picker=1&userId=${trimmedId}&name=${encodeURIComponent(lineName)}`);
    }

  } catch (error) {
    console.error('LINE Login Error:', error.message);
    // ถ้ามี Error ก็ให้แจ้งออกมาตรงๆ จะได้แก้ถูกจุด
    return res.status(500).send(`Authentication Failed: ${error.message}`);
  }
}