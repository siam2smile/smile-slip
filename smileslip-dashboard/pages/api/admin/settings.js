/**
 * GET /api/admin/settings
 * ดึง admin settings (Google email, sheet id) สำหรับแสดงใน Admin panel
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
  if (req.method !== 'GET') return res.status(405).end();
  if (!verifyAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });

  const { data, error } = await supabase
    .from('admin_settings')
    .select('key, value')
    .in('key', ['admin_google_email', 'admin_invoice_sheet_id']);

  if (error) {
    // table ยังไม่มี → return empty (ไม่ crash)
    return res.status(200).json({ google_email: null, invoice_sheet_id: null });
  }

  const map = {};
  for (const row of (data || [])) map[row.key] = row.value;

  return res.status(200).json({
    google_email:      map['admin_google_email'] || null,
    invoice_sheet_id:  map['admin_invoice_sheet_id'] || null,
  });
}
