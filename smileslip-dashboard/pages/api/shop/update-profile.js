import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { shopId, shopName, email, phone } = req.body;
  if (!shopId) return res.status(400).json({ error: 'ไม่พบ shopId' });

  const updates = {};
  if (shopName?.trim()) updates.shop_name = shopName.trim();
  if (email?.trim()) updates.email = email.trim();
  if (phone?.trim()) updates.phone = phone.trim();

  if (Object.keys(updates).length === 0)
    return res.status(400).json({ error: 'ไม่มีข้อมูลที่ต้องการแก้ไข' });

  const { error } = await supabase
    .from('shop_profiles')
    .update(updates)
    .eq('id', shopId);

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ success: true });
}
