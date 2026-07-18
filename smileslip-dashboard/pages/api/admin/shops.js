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
  if (!verifyAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  if (req.method !== 'GET') return res.status(405).end();

  const { data, error } = await supabase
    .from('shop_profiles')
    .select(`
      id, shop_name, email, phone, owner_line_id, subscription_tier,
      tax_id, address, user_type, created_at, stripe_subscription_id, stripe_customer_id,
      subscription_expires_at, stripe_billed_tier, stripe_period_end,
      shop_credits(balance_credits),
      shop_google_configs(google_email),
      shop_branches(id, branch_name),
      shop_admins(id, display_name, status)
    `)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ shops: data || [] });
}
