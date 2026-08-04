import { createClient } from '@supabase/supabase-js';
import { requireOwnerAuth } from '../../../lib/owner-auth';

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

  if (req.method !== 'GET' && !requireOwnerAuth(req, res, shopId, { enforce: true })) return;

  if (req.method === 'POST') {
    const { branchName, lineGroupId, brandName, address } = req.body;
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

    // เขียน address แยกต่างหาก (คอลัมน์ใหม่ — ถ้ายังไม่ได้รัน SQL เพิ่มคอลัมน์ ไม่ให้พังการสร้างสาขาหลัก)
    if (address?.trim()) {
      try {
        const { data: withAddr } = await supabase
          .from('shop_branches').update({ address: address.trim() }).eq('id', data.id).select().single();
        if (withAddr) return res.status(200).json({ branch: withAddr });
      } catch (addrErr) {
        console.error('[shop/branches] set address on create failed (non-fatal):', addrErr.message);
      }
    }
    return res.status(200).json({ branch: data });
  }

  if (req.method === 'PATCH') {
    const { branchId, brandName, address } = req.body;
    if (!branchId) return res.status(400).json({ error: 'ไม่พบ branchId' });
    const updates = {};
    if (brandName !== undefined) updates.brand_name = brandName?.trim() || null;

    let data, error;
    if (Object.keys(updates).length) {
      ({ data, error } = await supabase.from('shop_branches').update(updates).eq('id', branchId).eq('shop_id', shopId).select().single());
      if (error) return res.status(500).json({ error: error.message });
    }
    // address เป็นคอลัมน์ใหม่ — แยก update ต่างหากกันพังถ้ายังไม่ได้รัน SQL เพิ่มคอลัมน์
    if (address !== undefined) {
      try {
        const { data: withAddr, error: addrErr } = await supabase
          .from('shop_branches').update({ address: address?.trim() || null }).eq('id', branchId).eq('shop_id', shopId).select().single();
        if (!addrErr && withAddr) data = withAddr;
        else if (addrErr) console.error('[shop/branches] update address failed (non-fatal):', addrErr.message);
      } catch (addrErr) {
        console.error('[shop/branches] update address failed (non-fatal):', addrErr.message);
      }
    }
    if (!data) {
      const { data: fresh } = await supabase.from('shop_branches').select('*').eq('id', branchId).eq('shop_id', shopId).single();
      data = fresh;
    }
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
