/**
 * GET /api/pos/cashier-shop-info?shopId=xxx&session=xxx (หรือ header x-staff-session)
 * → ข้อมูลร้านที่จำเป็นสำหรับหน้าแคชเชียร์ (/pos?mode=cashier) ใช้บูตหน้าเว็บหลัง PIN ผ่านแล้ว
 *
 * ต่างจาก public-shop-info.js (ไม่ต้อง auth เลย, คืนแค่ชื่อร้าน+สถานะรับออเดอร์สำหรับหน้า
 * สั่งซื้อสาธารณะ) — endpoint นี้ **ต้องมี session ที่เซ็นชื่อถูกต้องเสมอ** (มาจากการใส่ PIN ถูก
 * ผ่าน verify-pin แล้ว) ถึงจะเรียกได้ เพราะคืนข้อมูลปฏิบัติการที่ละเอียดกว่า (subscription_tier
 * ใช้ gate ฟีเจอร์ในหน้าเว็บ, ที่อยู่/เลขภาษี ใช้พิมพ์ใบเสร็จ) — ไม่คืน owner_line_id/email/
 * ข้อมูลบัญชีธนาคารเด็ดขาด (ไม่ใช่ของแคชเชียร์)
 */
import { createClient } from '@supabase/supabase-js';
import { verifyStaffSession } from '../../../lib/staff-session';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { shopId } = req.query;
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });

  const sessionToken = req.headers['x-staff-session'] || req.query.session;
  const session = sessionToken ? verifyStaffSession(sessionToken) : null;
  if (!session || session.shopId !== shopId) {
    return res.status(401).json({ error: 'session พนักงานหมดอายุหรือไม่ถูกต้อง กรุณาใส่ PIN ใหม่' });
  }

  const [{ data: shop }, { data: pc }] = await Promise.all([
    supabase.from('shop_profiles')
      .select('shop_name, address, tax_id, phone, subscription_tier, status')
      .eq('id', shopId).maybeSingle(),
    supabase.from('pos_configs').select('pos_sheet_id').eq('shop_id', shopId).maybeSingle(),
  ]);

  if (!shop) return res.status(404).json({ error: 'ไม่พบร้านค้านี้' });

  return res.json({
    ok: true,
    shop: {
      id: shopId,
      shop_name: shop.shop_name || '',
      address: shop.address || '',
      tax_id: shop.tax_id || '',
      phone: shop.phone || '',
      subscription_tier: shop.subscription_tier || 'normal',
      status: shop.status || 'active',
    },
    configured: !!pc?.pos_sheet_id,
  });
}
