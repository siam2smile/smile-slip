import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { action, shopId, value, currentCredits } = req.body;

  try {
    if (action === 'update_tier') {
      const { error } = await supabase
        .from('shop_profiles')
        .update({ subscription_tier: value })
        .eq('id', shopId);
      if (error) throw error;
      return res.status(200).json({ success: true });
    }

    if (action === 'add_credits') {
      const amount = parseInt(value);
      const newTotal = (parseInt(currentCredits) || 0) + amount;
      const { data: existing } = await supabase.from('shop_credits').select('id').eq('shop_id', shopId).maybeSingle();
      if (existing) {
        await supabase.from('shop_credits').update({ balance_credits: newTotal }).eq('shop_id', shopId);
      } else {
        await supabase.from('shop_credits').insert({ shop_id: shopId, balance_credits: newTotal });
      }
      return res.status(200).json({ success: true, newTotal });
    }

    if (action === 'set_credits') {
      const amount = parseInt(value);
      const { data: existing } = await supabase.from('shop_credits').select('id').eq('shop_id', shopId).maybeSingle();
      if (existing) {
        await supabase.from('shop_credits').update({ balance_credits: amount }).eq('shop_id', shopId);
      } else {
        await supabase.from('shop_credits').insert({ shop_id: shopId, balance_credits: amount });
      }
      return res.status(200).json({ success: true, newTotal: amount });
    }

    if (action === 'delete_shop') {
      await supabase.from('shop_credits').delete().eq('shop_id', shopId);
      await supabase.from('shop_google_configs').delete().eq('shop_id', shopId);
      await supabase.from('shop_bank_accounts').delete().eq('shop_id', shopId);
      await supabase.from('shop_branches').delete().eq('shop_id', shopId);
      const { error } = await supabase.from('shop_profiles').delete().eq('id', shopId);
      if (error) throw error;
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('Admin update error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
