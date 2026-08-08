/**
 * GET  /api/shop/bank-accounts?shopId=xxx[&branchId=xxx]  → คืน list (กรองเฉพาะสาขาถ้าระบุ branchId)
 * POST /api/shop/bank-accounts             → เพิ่มบัญชีใหม่ (branchId ไม่บังคับ — ไม่ระบุ = บัญชีรวมของร้าน)
 * DELETE /api/shop/bank-accounts           → ลบบัญชี (body: { accountId })
 */
import { createClient } from '@supabase/supabase-js';
import { requireOwnerAuth } from '../../../lib/owner-auth';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const { shopId, branchId } = req.query;
    if (!shopId) return res.status(400).json({ error: 'shopId required' });
    let query = supabase.from('shop_bank_accounts').select('*').eq('shop_id', shopId);
    if (branchId) query = query.eq('branch_id', branchId);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ accounts: data || [] });
  }

  if (req.method === 'POST') {
    const { shopId, bankName, accountName, accountNumber, accountType, branchId } = req.body;
    if (!shopId || !bankName || !accountNumber || !accountName)
      return res.status(400).json({ error: 'ข้อมูลไม่ครบ' });
    if (!requireOwnerAuth(req, res, shopId, { enforce: true })) return;
    const baseRow = { shop_id: shopId, bank_name: bankName, account_name: accountName, account_number: accountNumber, account_type: accountType || 'ออมทรัพย์' };

    // branch_id เป็นคอลัมน์ใหม่ (ผูกบัญชีธนาคารกับสาขาที่รับเงินจริง) — ถ้ายังไม่ได้รัน SQL เพิ่ม
    // คอลัมน์ ลอง insert พร้อม branch_id ก่อน แล้ว fallback เป็น insert แบบเดิม (ไม่ระบุสาขา) กันพัง
    if (branchId) {
      const { data, error } = await supabase
        .from('shop_bank_accounts').insert([{ ...baseRow, branch_id: branchId }]).select().single();
      if (!error) return res.status(200).json({ account: data });
      console.error('[shop/bank-accounts] insert with branch_id failed, retrying without it (non-fatal, likely missing column):', error.message);
    }

    const { data, error } = await supabase
      .from('shop_bank_accounts').insert([baseRow]).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ account: data });
  }

  if (req.method === 'DELETE') {
    const { accountId, shopId } = req.body;
    if (!accountId || !shopId) return res.status(400).json({ error: 'accountId และ shopId required' });
    if (!requireOwnerAuth(req, res, shopId, { enforce: true })) return;
    const { error } = await supabase
      .from('shop_bank_accounts').delete().eq('id', accountId).eq('shop_id', shopId);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  return res.status(405).end();
}
