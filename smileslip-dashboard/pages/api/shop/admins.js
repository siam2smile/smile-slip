import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

const ADMIN_LIMIT = { normal: 0, pro: 0, advance: 0, business: 3, enterprise: 10, super: 10 };

function isSystemAdmin(req) {
  const token = req.headers['x-admin-token'];
  if (!token) return false;
  try {
    return Buffer.from(token, 'base64').toString('utf8').startsWith('smileslip-admin:');
  } catch { return false; }
}

export default async function handler(req, res) {
  // GET — list admins (pending + approved)
  if (req.method === 'GET') {
    const { shopId } = req.query;
    if (!shopId) return res.status(400).json({ error: 'ไม่พบ shopId' });

    const { data, error } = await supabase
      .from('shop_admins')
      .select('id, line_user_id, display_name, status, created_at')
      .eq('shop_id', shopId)
      .order('created_at', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });
    const admins = data || [];
    return res.status(200).json({
      admins: admins.filter(a => a.status === 'approved'),
      pending: admins.filter(a => a.status === 'pending'),
    });
  }

  // PATCH — approve or reject
  if (req.method === 'PATCH') {
    const { shopId, adminId, action } = req.body;
    if (!shopId || !adminId || !action) return res.status(400).json({ error: 'ข้อมูลไม่ครบ' });

    const { data: profile } = await supabase
      .from('shop_profiles')
      .select('subscription_tier')
      .eq('id', shopId)
      .maybeSingle();

    const tier = (profile?.subscription_tier || 'normal').toLowerCase();
    const limit = ADMIN_LIMIT[tier] ?? 0;

    if (action === 'approve') {
      // system admin bypasses tier limits
      if (!isSystemAdmin(req) && limit === 0) return res.status(403).json({ error: 'แพ็กเกจไม่รองรับแอดมิน' });

      // นับแอดมินที่อนุมัติแล้ว
      const { count } = await supabase
        .from('shop_admins')
        .select('id', { count: 'exact', head: true })
        .eq('shop_id', shopId)
        .eq('status', 'approved');

      if (!isSystemAdmin(req) && (count || 0) >= limit) {
        return res.status(400).json({ error: `แพ็กเกจ ${tier} รองรับสูงสุด ${limit} แอดมิน` });
      }

      await supabase.from('shop_admins')
        .update({ status: 'approved' })
        .eq('id', adminId)
        .eq('shop_id', shopId);
      return res.status(200).json({ success: true });
    }

    if (action === 'reject') {
      await supabase.from('shop_admins').delete().eq('id', adminId).eq('shop_id', shopId);
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'action ไม่ถูกต้อง (approve/reject)' });
  }

  // DELETE — remove approved admin
  if (req.method === 'DELETE') {
    const { shopId, adminId } = req.body;
    if (!shopId || !adminId) return res.status(400).json({ error: 'ข้อมูลไม่ครบ' });

    const { error } = await supabase
      .from('shop_admins')
      .delete()
      .eq('id', adminId)
      .eq('shop_id', shopId);

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  return res.status(405).end();
}
