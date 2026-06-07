import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'Missing userId' });

  const { data } = await supabase
    .from('shop_profiles')
    .select('id')
    .eq('owner_line_id', userId)
    .maybeSingle();

  return res.status(200).json({ exists: !!data });
}
