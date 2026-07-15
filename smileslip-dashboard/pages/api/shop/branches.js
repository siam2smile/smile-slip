import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

// จำกัดจำนวนสาขาตาม tier — ต้องตรงกับ MAX_BRANCHES ใน smileslip-pro/index.js เสมอ
const MAX_BRANCHES = { normal: 1, pro: 1, advance: 5, business: 10, enterprise: 20, super: 20 };

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
    const { branchName, lineGroupId, brandName } = req.body;
    if (!branchName?.trim() || !lineGroupId?.trim())
      return res.status(400).json({ error: 'กรุณากรอกชื่อสาขาและ Group ID ให้ครบ' });

    const [{ data: shop }, { count: branchCount }] = await Promise.all([
      supabase.from('shop_profiles').select('subscription_tier').eq('id', shopId).single(),
      supabase.from('shop_branches').select('id', { count: 'exact', head: true }).eq('shop_id', shopId),
    ]);
    const limit = MAX_BRANCHES[shop?.subscription_tier] ?? MAX_BRANCHES.normal;
    if ((branchCount ?? 0) >= limit) {
      return res.status(403).json({ error: `แพ็กเกจปัจจุบันเพิ่มสาขาได้สูงสุด ${limit} สาขา กรุณาอัปเกรดแพ็กเกจเพื่อเพิ่มสาขา`, limitReached: true });
    }

    const { data, error } = await supabase
      .from('shop_branches')
      .insert({ shop_id: shopId, branch_name: branchName.trim(), line_group_id: lineGroupId.trim(), brand_name: brandName?.trim() || null })
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ branch: data });
  }

  if (req.method === 'PATCH') {
    const { branchId, brandName } = req.body;
    if (!branchId) return res.status(400).json({ error: 'ไม่พบ branchId' });
    const { data, error } = await supabase
      .from('shop_branches')
      .update({ brand_name: brandName?.trim() || null })
      .eq('id', branchId).eq('shop_id', shopId)
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ branch: data });
  }

  if (req.method === 'DELETE') {
    const { branchId } = req.body;
    if (!branchId) return res.status(400).json({ error: 'ไม่พบ branchId' });
    const { error } = await supabase.from('shop_branches').delete().eq('id', branchId).eq('shop_id', shopId);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  return res.status(405).end();
}
