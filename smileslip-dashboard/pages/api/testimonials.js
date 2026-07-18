/**
 * GET /api/testimonials — public, คืนรีวิวจริงที่ไม่ถูกซ่อน (สำหรับหน้า index.js)
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { data, error } = await supabase
    .from('shop_testimonials')
    .select('name, role, message, stars, created_at')
    .eq('is_hidden', false)
    .order('created_at', { ascending: false })
    .limit(9);

  if (error) return res.status(200).json({ testimonials: [] });
  return res.status(200).json({ testimonials: data || [] });
}
