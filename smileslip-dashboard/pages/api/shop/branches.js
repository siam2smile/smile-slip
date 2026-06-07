import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  const { shopId } = req.query;
  if (!shopId) return res.status(400).json({ error: 'ไม่พบ shopId' });

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('shop_branches').select('*').eq('shop_id', shopId).order('created_at');
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ branches: data ?? [] });
  }

  if (req.method === 'POST') {
    const { branchName, lineGroupId } = req.body;
    if (!branchName?.trim() || !lineGroupId?.trim())
      return res.status(400).json({ error: 'กรุณากรอกชื่อสาขาและ Group ID ให้ครบ' });
    const { data, error } = await supabase
      .from('shop_branches')
      .insert({ shop_id: shopId, branch_name: branchName.trim(), line_group_id: lineGroupId.trim() })
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ branch: data });
  }

  if (req.method === 'DELETE') {
    const { branchId } = req.body;
    if (!branchId) return res.status(400).json({ error: 'ไม่พบ branchId' });
    const { error } = await supabase.from('shop_branches').delete().eq('id', branchId);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  return res.status(405).end();
}
