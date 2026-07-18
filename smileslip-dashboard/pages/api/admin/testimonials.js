/**
 * GET   /api/admin/testimonials       — ดูรีวิวทั้งหมด (รวมที่ซ่อนแล้ว)
 * PATCH /api/admin/testimonials       — ซ่อน/แสดงรีวิว  body: { id, hidden }
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

function verifyAdmin(req) {
  const token = req.headers['x-admin-token'];
  if (!token) return false;
  try { return Buffer.from(token, 'base64').toString('utf8').startsWith('smileslip-admin:'); }
  catch { return false; }
}

export default async function handler(req, res) {
  if (!verifyAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('shop_testimonials')
      .select('id, shop_id, name, role, message, stars, is_hidden, created_at')
      .order('created_at', { ascending: false });
    if (error) return res.status(200).json({ testimonials: [] });
    return res.status(200).json({ testimonials: data || [] });
  }

  if (req.method === 'PATCH') {
    const { id, hidden } = req.body;
    if (!id) return res.status(400).json({ error: 'id required' });
    const { error } = await supabase.from('shop_testimonials').update({ is_hidden: !!hidden }).eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  return res.status(405).end();
}
