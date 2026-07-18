import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { shopId, shopName, email, phone, taxId, userType, address } = req.body;
  if (!shopId) return res.status(400).json({ error: 'ไม่พบ shopId' });

  const updates = {};
  if (shopName?.trim()) updates.shop_name = shopName.trim();
  if (email !== undefined) updates.email = email?.trim() || null;
  if (phone !== undefined) updates.phone = phone?.trim() || null;
  if (taxId !== undefined) updates.tax_id = taxId?.trim() || null;
  if (userType && ['individual', 'corporate'].includes(userType)) updates.user_type = userType;
  if (address !== undefined) updates.address = address?.trim() || null;

  if (Object.keys(updates).length === 0)
    return res.status(400).json({ error: 'ไม่มีข้อมูลที่ต้องการแก้ไข' });

  const { error } = await supabase
    .from('shop_profiles')
    .update(updates)
    .eq('id', shopId);

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ success: true });
}
