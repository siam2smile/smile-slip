import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'ไม่พบ userId' });

  const { data: profile, error } = await supabase
    .from('shop_profiles')
    .select('id, shop_name, tax_id, branch_name, address, email, phone, user_type, subscription_tier, owner_line_id')
    .eq('owner_line_id', userId)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!profile) return res.status(404).json({ error: 'ไม่พบข้อมูลร้านค้า' });

  const [creditRow, gConfig, banks] = await Promise.all([
    supabase.from('shop_credits').select('balance_credits').eq('shop_id', profile.id).maybeSingle(),
    supabase.from('shop_google_configs').select('*').eq('shop_id', profile.id).maybeSingle(),
    supabase.from('shop_bank_accounts').select('*').eq('shop_id', profile.id),
  ]);

  return res.status(200).json({
    profile,
    credits: creditRow.data?.balance_credits ?? 0,
    googleConfig: gConfig.data ?? null,
    bankAccounts: banks.data ?? [],
  });
}
