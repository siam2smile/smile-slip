/**
 * GET /api/admin/delivery-stats
 * สถิติ delivery ทุกร้าน — นับจำนวนร้านที่เปิดใช้แล้ว
 * (ออเดอร์จริงอยู่ใน Google Sheets ของแต่ละร้าน จึงนับได้แค่ระดับร้าน)
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

function verifyAdmin(req) {
  const token = req.headers['x-admin-token'];
  if (!token) return false;
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    return decoded.startsWith('smileslip-admin:');
  } catch { return false; }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!verifyAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });

  const { data, error } = await supabase
    .from('delivery_configs')
    .select('shop_id, created_at');

  if (error) return res.status(500).json({ error: error.message });

  const configs = data || [];
  const today = new Date().toISOString().split('T')[0];

  const stats = {
    total:   configs.length,
    active:  configs.length,
    today:   configs.filter(c => c.created_at?.startsWith(today)).length,
  };

  return res.json({ stats });
}
