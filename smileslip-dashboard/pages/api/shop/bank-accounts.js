/**
 * GET  /api/shop/bank-accounts?shopId=xxx  → คืน list
 * POST /api/shop/bank-accounts             → เพิ่มบัญชีใหม่
 * DELETE /api/shop/bank-accounts           → ลบบัญชี (body: { accountId })
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const { shopId } = req.query;
    if (!shopId) return res.status(400).json({ error: 'shopId required' });
    const { data, error } = await supabase
      .from('shop_bank_accounts').select('*').eq('shop_id', shopId);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ accounts: data || [] });
  }

  if (req.method === 'POST') {
    const { shopId, bankName, accountName, accountNumber, accountType } = req.body;
    if (!shopId || !bankName || !accountNumber || !accountName)
      return res.status(400).json({ error: 'ข้อมูลไม่ครบ' });
    const { data, error } = await supabase
      .from('shop_bank_accounts')
      .insert([{ shop_id: shopId, bank_name: bankName, account_name: accountName, account_number: accountNumber, account_type: accountType || 'ออมทรัพย์' }])
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ account: data });
  }

  if (req.method === 'DELETE') {
    const { accountId, shopId } = req.body;
    if (!accountId || !shopId) return res.status(400).json({ error: 'accountId และ shopId required' });
    const { error } = await supabase
      .from('shop_bank_accounts').delete().eq('id', accountId).eq('shop_id', shopId);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  return res.status(405).end();
}
