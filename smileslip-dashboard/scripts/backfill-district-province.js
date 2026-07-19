/**
 * One-off backfill: แยก district/province ออกจาก shop_profiles.address (สตริงรวม
 * "...ต.X อ.Y จ.Z ..." ที่ register.js เขียนไว้) ออกมาเป็นคอลัมน์แยก
 *
 * ต้องรัน ALTER TABLE เพิ่มคอลัมน์ district/province ก่อน (ดู CLAUDE.md "ต้องทำด้วยมือ")
 * รันครั้งเดียวหลังเพิ่มคอลัมน์: node scripts/backfill-district-province.js
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

const RE = /อ\.([^\s]+)\s+จ\.([^\s]+)/;

async function main() {
  const { data: shops, error } = await supabase
    .from('shop_profiles')
    .select('id, shop_name, address, district, province');
  if (error) throw error;

  let updated = 0, skipped = 0, unmatched = 0;
  for (const shop of shops || []) {
    if (shop.district && shop.province) { skipped++; continue; }
    if (!shop.address) { unmatched++; continue; }
    const m = shop.address.match(RE);
    if (!m) { unmatched++; console.warn(`[unmatched] ${shop.shop_name}: "${shop.address}"`); continue; }
    const [, district, province] = m;
    const { error: updErr } = await supabase
      .from('shop_profiles')
      .update({ district, province })
      .eq('id', shop.id);
    if (updErr) { console.error(`[error] ${shop.shop_name}:`, updErr.message); continue; }
    updated++;
    console.log(`[ok] ${shop.shop_name}: อำเภอ ${district} จังหวัด ${province}`);
  }
  console.log(`\nสรุป: อัปเดต ${updated}, ข้าม (มีอยู่แล้ว) ${skipped}, แกะไม่ได้ ${unmatched}`);
}

main().catch(err => { console.error(err); process.exit(1); });
