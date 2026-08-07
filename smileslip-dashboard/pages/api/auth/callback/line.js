import axios from 'axios';
import { createClient } from '@supabase/supabase-js';
import { getRolesForLineId } from '../../../../lib/identity';
import { issueOwnerSession } from '../../../../lib/owner-session';

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

    // state พก "เจตนา" มาจาก api/auth/line.js (register/login) — ปุ่ม "สมัครสมาชิก" (register.js)
    // กับปุ่ม "เข้าสู่ระบบ" (login.js) ยิงเข้า /api/auth/line ตัวเดียวกันทั้งคู่ ถ้าไม่รู้เจตนา
    // จะแยกไม่ออกว่าไลไอดีที่มีบทบาทอยู่แล้วพอดี 1 ร้าน ตั้งใจจะ "เข้าร้านเดิม" (login) หรือ
    // "สมัครร้านใหม่แยกต่างหาก" (register) — รูปแบบผิด/ไม่มี state เลย fallback เป็น 'login'
    // เสมอ (พฤติกรรมเดิมก่อนแก้ ปลอดภัยกว่าเดาผิดเป็น register แล้วรบกวนคน login ปกติ)
    const intent = (typeof req.query.state === 'string' && req.query.state.startsWith('register:')) ? 'register' : 'login';

    // 3. ตรวจสอบว่าไลไอดีนี้ผูกกับร้านไหนบ้าง (เจ้าของ/แอดมิน) — ใช้ helper กลางแทน
    //    .maybeSingle() เดิม ที่เช็คแค่ owner_line_id ทำให้แอดมิน-ล้วน (ไม่ใช่เจ้าของที่ไหนเลย)
    //    ถูกเด้งไปหน้าสมัครสมาชิกใหม่ผิดๆ ทั้งที่มีบัญชีอยู่แล้ว
    const trimmedId = lineUserId.trim();
    const roles = await getRolesForLineId(trimmedId);

    if (roles.length === 0) {
      // ยังไม่มีบทบาทใดๆ เลย → ไปหน้าสมัครสมาชิกใหม่
      return res.redirect(`/register?userId=${trimmedId}&name=${encodeURIComponent(lineName)}`);
    } else if (roles.length === 1 && intent === 'register') {
      // มีบทบาทอยู่แล้วพอดี 1 ร้าน แต่ตั้งใจกดปุ่ม "สมัครสมาชิก" (ไม่ใช่ "เข้าสู่ระบบ") — ส่งไปหน้า
      // /register ให้เจอหน้าตัดสินใจ (เข้าร้านเดิม/สมัครร้านใหม่แยกต่างหาก/ลบร้านเดิม) แทนที่จะ
      // auto เข้าร้านเดิมทันทีแบบเงียบๆ (บั๊กเดิม — ผู้ใช้กด "สมัครสมาชิก" ไม่มีทางสมัครร้านใหม่ได้เลย
      // ถ้ามีบทบาทอยู่แล้วแม้แค่ 1 ร้าน เพราะ endpoint นี้ไม่เคยรู้เจตนาที่แท้จริงมาก่อน)
      return res.redirect(`/register?userId=${trimmedId}&name=${encodeURIComponent(lineName)}`);
    } else if (roles.length === 1) {
      const r = roles[0];
      // แนบ owner-session token ไปกับ redirect (เป็น HTTP redirect ล้วนๆ ไม่มี XHR response
      // ให้แนบ token ได้ตรงๆ แบบ check-user.js/email-login.js — ownerId ของ token ต้องเป็น
      // trimmedId (LINE ID ของคนที่กำลัง login ผ่าน OAuth ตอนนี้จริงๆ) ไม่ใช่ r.ownerId
      // (ซึ่งเป็น LINE ID ของ "เจ้าของร้าน" ที่อาจเป็นคนละคนกันถ้า r.role === 'admin')
      const ownerSession = issueOwnerSession({ shopId: r.shopId, ownerId: trimmedId, role: r.role });
      const sessionQS = ownerSession ? `&ownerSession=${encodeURIComponent(ownerSession)}` : '';
      if (r.role === 'admin') {
        return res.redirect(`/dashboard?userId=${r.ownerId}&adminId=${trimmedId}${sessionQS}`);
      }
      return res.redirect(`/dashboard?userId=${r.ownerId}${sessionQS}`);
    } else {
      // ผูกกับหลายร้าน (เจ้าของร้านตัวเอง + แอดมินร้านอื่นพร้อมกัน) — ส่งต่อไปหน้า /login
      // ให้แสดงตัวเลือกร้าน (login.js อ่าน query นี้แล้วเรียก check-user ซ้ำเพื่อโชว์ picker —
      // check-user.js ออก owner-session token ให้ทุก role อยู่แล้ว ไม่ต้องแนบมาเองตรงนี้)
      return res.redirect(`/login?picker=1&userId=${trimmedId}&name=${encodeURIComponent(lineName)}`);
    }

  } catch (error) {
    console.error('LINE Login Error:', error.message);
    // ถ้ามี Error ก็ให้แจ้งออกมาตรงๆ จะได้แก้ถูกจุด
    return res.status(500).send(`Authentication Failed: ${error.message}`);
  }
}