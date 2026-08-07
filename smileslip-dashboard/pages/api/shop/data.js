import { createClient } from '@supabase/supabase-js';
import { requireOwnerAuth } from '../../../lib/owner-auth';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'ไม่พบ userId' });

  const { data: profile, error } = await supabase
    .from('shop_profiles')
    .select('id, shop_name, tax_id, branch_name, address, email, phone, user_type, subscription_tier, owner_line_id, stripe_subscription_id')
    .eq('owner_line_id', userId)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!profile) return res.status(404).json({ error: 'ไม่พบข้อมูลร้านค้า' });

  // endpoint นี้เรียกตอนหน้าเว็บยังไม่รู้ shopId เลย (แค่ userId) จึง enforce:true ไม่ได้ทันที —
  // ยังต้องรองรับ "ไม่มี token เลย" (cold visit ครั้งแรก/deep-link ที่ยังไม่ได้ consume token เข้า
  // localStorage) แต่ถ้า "มี" token ที่ shopId ไม่ตรงกับร้านที่ resolve ได้ (เช่น เผลอเอา token ของ
  // ร้าน A มาเปิด URL ของร้าน B) ต้องบล็อกเสมอ — ปิดช่องโหว่การอ่านข้อมูลอ่อนไหว (บัญชีธนาคาร,
  // google refresh token, เครดิต) ข้ามร้านโดยไม่เปิดความเสี่ยง redirect loop ตอนโหลดหน้าครั้งแรก
  if (!requireOwnerAuth(req, res, profile.id, { enforce: false })) return;

  const [creditRow, gConfig, banks] = await Promise.all([
    supabase.from('shop_credits').select('balance_credits').eq('shop_id', profile.id).maybeSingle(),
    supabase.from('shop_google_configs').select('*').eq('shop_id', profile.id).maybeSingle(),
    supabase.from('shop_bank_accounts').select('*').eq('shop_id', profile.id),
  ]);

  // แยก query สถานะ trial ต่างหาก (คนละคอลัมน์ใหม่ trial_started_at/trial_ends_at/status —
  // ถ้ายังไม่ได้รัน SQL เพิ่มคอลัมน์ ให้ error เงียบๆ ไม่ทำให้ endpoint หลักพังทั้งอัน เหมือน
  // pattern district/province ใน register.js)
  try {
    const { data: trialInfo, error: trialErr } = await supabase
      .from('shop_profiles')
      .select('status, trial_started_at, trial_ends_at')
      .eq('id', profile.id)
      .maybeSingle();
    if (!trialErr && trialInfo) Object.assign(profile, trialInfo);
  } catch { /* ตารางยังไม่มีคอลัมน์นี้ — ถือว่าไม่มี trial lock เลย (ปลอดภัยกว่า) */ }

  return res.status(200).json({
    profile,
    credits: creditRow.data?.balance_credits ?? 0,
    googleConfig: gConfig.data ?? null,
    bankAccounts: banks.data ?? [],
  });
}
