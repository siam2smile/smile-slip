import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const {
    shopId, planId, isYearly,
    basePrice, vatAmount, totalPrice, whtAmount, netAmount,
    invoiceNo,
    buyerName, buyerTaxId, buyerBranch, buyerAddress, buyerEmail, buyerPhone, buyerContact,
  } = req.body;

  if (!buyerName || !buyerTaxId || !planId) {
    return res.status(400).json({ error: 'ข้อมูลไม่ครบ' });
  }

  const { data, error } = await supabase.from('invoice_requests').insert({
    shop_id: shopId || null,
    plan_id: planId,
    is_yearly: isYearly,
    base_price: basePrice,
    vat_amount: vatAmount,
    total_price: totalPrice,
    wht_amount: whtAmount,
    net_amount: netAmount,
    invoice_no: invoiceNo,
    buyer_name: buyerName,
    buyer_tax_id: buyerTaxId,
    buyer_branch: buyerBranch || null,
    buyer_address: buyerAddress,
    buyer_email: buyerEmail || null,
    buyer_phone: buyerPhone || null,
    buyer_contact: buyerContact || null,
    status: 'pending',
  }).select('id').single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ success: true, id: data.id });
}
