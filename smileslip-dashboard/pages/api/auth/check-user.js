import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'Missing userId' });

  // เช็คเจ้าของร้านก่อน
  const { data: owner } = await supabase
    .from('shop_profiles')
    .select('id')
    .eq('owner_line_id', userId)
    .maybeSingle();

  if (owner) return res.status(200).json({ exists: true, role: 'owner' });

  // เช็คแอดมินร้าน (เฉพาะที่อนุมัติแล้ว)
  const { data: adminRow } = await supabase
    .from('shop_admins')
    .select('shop_id, shop_profiles!inner(owner_line_id, shop_name)')
    .eq('line_user_id', userId)
    .eq('status', 'approved')
    .maybeSingle();

  if (adminRow) {
    return res.status(200).json({
      exists: true,
      role: 'admin',
      ownerId: adminRow.shop_profiles.owner_line_id,
      shopName: adminRow.shop_profiles.shop_name,
    });
  }

  return res.status(200).json({ exists: false });
}
