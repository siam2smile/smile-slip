/**
 * GET /api/shop/referral?shopId=xxx
 * คืนข้อมูล referral code + สถิติการแนะนำเพื่อน
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { shopId } = req.query;
  if (!shopId) return res.status(400).json({ error: 'shopId required' });

  try {
    // ดึง referral_code ของร้านนี้
    const { data: shop } = await supabase
      .from('shop_profiles')
      .select('referral_code, referred_by')
      .eq('id', shopId)
      .single();

    if (!shop) return res.status(404).json({ error: 'ไม่พบร้านค้า' });

    // ถ้าร้านยังไม่มี referral_code (สมัครก่อนมีฟีเจอร์) → generate และบันทึกทันที
    if (!shop.referral_code) {
      const SAFE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let newCode = null;
      for (let attempt = 0; attempt < 10; attempt++) {
        const candidate = 'SMILE-' + Array.from({ length: 4 }, () =>
          SAFE_CHARS[Math.floor(Math.random() * SAFE_CHARS.length)]
        ).join('');
        const { count } = await supabase
          .from('shop_profiles').select('*', { count: 'exact', head: true })
          .eq('referral_code', candidate);
        if (!count) { newCode = candidate; break; }
      }
      if (newCode) {
        await supabase.from('shop_profiles').update({ referral_code: newCode }).eq('id', shopId);
        shop.referral_code = newCode;
      }
    }

    // นับจำนวนร้านที่ใช้โค้ดของเรา + เชื่อมต่อ Google แล้ว (= ได้รับ bonus แล้ว)
    let referralCount = 0;
    let creditsEarned = 0;
    if (shop.referral_code) {
      const { count } = await supabase
        .from('shop_profiles')
        .select('*', { count: 'exact', head: true })
        .eq('referred_by', shop.referral_code);
      referralCount = count || 0;
      creditsEarned = referralCount * 50; // 50 เครดิต/คนที่แนะนำสำเร็จ
    }

    return res.status(200).json({
      referralCode: shop.referral_code || null,
      referralCount,
      creditsEarned,
      referralUrl: shop.referral_code
        ? `${process.env.NEXT_PUBLIC_BASE_URL || process.env.FRONTEND_URL}/register?ref=${shop.referral_code}`
        : null,
    });

  } catch (err) {
    console.error('[Referral API]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
