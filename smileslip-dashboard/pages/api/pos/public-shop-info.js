/**
 * GET /api/pos/public-shop-info?shopId=xxx
 * → ข้อมูลร้านค้าแบบสาธารณะขั้นต่ำสุด สำหรับหน้าสั่งซื้อของลูกค้า (pages/order.js, ไม่ต้อง login)
 *   คืนเฉพาะชื่อร้าน + สถานะว่าเปิดรับออเดอร์อยู่ไหม — ไม่คืนข้อมูลอ่อนไหวใดๆ (เลขภาษี/เบอร์โทร/อีเมลเจ้าของ ฯลฯ)
 */
import { createClient } from '@supabase/supabase-js';
import { hasFeature } from '../../../lib/tier-features';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const { shopId } = req.query;
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });

  const [{ data: shop }, { data: pc }] = await Promise.all([
    supabase.from('shop_profiles').select('shop_name, status, subscription_tier').eq('id', shopId).maybeSingle(),
    supabase.from('pos_configs').select('pos_folder_id').eq('shop_id', shopId).maybeSingle(),
  ]);

  if (!shop) return res.status(404).json({ error: 'ไม่พบร้านค้านี้' });

  return res.json({
    shop_name: shop.shop_name || '',
    // pos_sheet_id ไม่ถูกสร้าง/อ่านที่ไหนอีกแล้วหลัง Phase 2 (write-primary flip) — ใช้ pos_folder_id
    // (ยังสร้างอยู่ใน setup.js สำหรับ Drive photo upload) เป็นสัญญาณ "เปิดใช้งาน POS แล้ว" แทน
    accepting_orders: !!pc?.pos_folder_id && shop.status !== 'trial_expired',
    // ไม่คืน tier ตรงๆ (ไม่จำเป็นต้องให้สาธารณะรู้ระดับแพ็กเกจ) คืนแค่ผลลัพธ์ boolean ที่หน้าเว็บต้องใช้
    isWhiteLabel: hasFeature(shop.subscription_tier, 'white_label'),
  });
}
