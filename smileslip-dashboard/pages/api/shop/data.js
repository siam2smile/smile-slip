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

  // ⚠️ 2026-08-15: เคยลอง enforce:true (ข้อ 87) แล้วต้อง revert กลับ — dashboard.js/pos.js
  // ถูกแก้ให้แนบ token ถูกต้องแล้วก็จริง แต่พบว่ามีอีก 3 หน้าที่เรียก endpoint นี้ตรงๆ โดยไม่เคย
  // มีกลไก owner-session เลย: delivery.js/pricing.js (แก้ได้ง่าย เพิ่ม token lookup) และ
  // transaction/edit.js (แก้ไม่ได้ง่ายๆ — เข้าถึงผ่าน deep-link จากปุ่ม "แก้ไขข้อมูล" ในบอท LINE
  // โดยตรง ไม่เคยผ่าน /login เลย ไม่มี token ใน localStorage แน่นอน ต้องให้บอทเซ็น token แนบมากับ
  // ลิงก์เองก่อน — ยังไม่ได้ทำ เป็นงานคนละ service ต้อง deploy บอทด้วย) จึง revert เป็น
  // enforce:false ไว้ก่อนกันหน้าเหล่านี้พังจริงใน production — ยังคงเช็คว่า "มี" token ที่ shopId
  // ไม่ตรงกันต้องบล็อกเสมอ (ปิดช่องโหว่ปลอม shopId ข้ามร้านตอนมี token อยู่แล้ว) แค่ยังไม่บังคับ
  // ต้องมี token เท่านั้น — ต้องทำ signed deep-link ให้ transaction/edit.js ก่อนถึงจะ enforce:true
  // ได้อีกครั้งอย่างปลอดภัยจริง
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
