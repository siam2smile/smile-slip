// pages/api/auth/email-login.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  
  const { email } = req.body;
  
  // ค้นหา owner_line_id จากอีเมลที่ลงทะเบียนไว้
  const { data, error } = await supabase
    .from('shop_profiles')
    .select('owner_line_id')
    .eq('email', email)
    .maybeSingle();

  if (data) {
    return res.status(200).json({ userId: data.owner_line_id });
  } else {
    return res.status(404).json({ error: 'User not found' });
  }
}