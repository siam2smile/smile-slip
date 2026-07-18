/**
 * POST /api/delivery/setup?shopId=xxx
 *   สร้าง "📦 ระบบจัดส่ง" subfolder + Customer Sheet + Order Sheet
 *   ใน Google Drive ของร้าน แล้วบันทึก IDs ลง delivery_configs
 * GET /api/delivery/setup?shopId=xxx
 *   เช็คว่า delivery เปิดใช้แล้วหรือยัง
 */
import { createClient } from '@supabase/supabase-js';
import {
  getAccessToken, createFolder, createSpreadsheet,
  CUSTOMER_HEADERS, ORDER_HEADERS,
} from '../../../lib/google-delivery';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  const { shopId } = req.method === 'GET' ? req.query : req.body;
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });

  // GET — เช็คสถานะ
  if (req.method === 'GET') {
    const { data } = await supabase
      .from('delivery_configs')
      .select('*')
      .eq('shop_id', shopId)
      .maybeSingle();
    return res.json({ configured: !!data, config: data || null });
  }

  // POST — ตั้งค่าครั้งแรก
  if (req.method === 'POST') {
    const [{ data: gConfig }, { data: shop }] = await Promise.all([
      supabase.from('shop_google_configs').select('google_refresh_token, google_folder_id').eq('shop_id', shopId).single(),
      supabase.from('shop_profiles').select('shop_name, google_folder_id').eq('id', shopId).single(),
    ]);

    if (!gConfig?.google_refresh_token) {
      return res.status(400).json({ error: 'ยังไม่ได้เชื่อมต่อ Google Drive', notConnected: true });
    }

    try {
      const accessToken = await getAccessToken(gConfig.google_refresh_token);
      const shopName = shop?.shop_name || 'ร้านค้า';

      // หา root folder_id: ลอง shop_google_configs ก่อน → fallback shop_profiles → สร้างใหม่
      let rootFolderId = gConfig?.google_folder_id || shop?.google_folder_id;

      if (!rootFolderId) {
        rootFolderId = await createFolder(accessToken, `SMILE SLIP - ${shopName}`, null);
        await supabase.from('shop_profiles').update({ google_folder_id: rootFolderId }).eq('id', shopId);
        await supabase.from('shop_google_configs').update({ google_folder_id: rootFolderId }).eq('shop_id', shopId);
        console.log(`[delivery/setup] created new root folder for shop ${shopId}: ${rootFolderId}`);
      }

      // สร้าง subfolder "📦 ระบบจัดส่ง" ใน root folder ของร้าน
      const deliveryFolderId = await createFolder(
        accessToken,
        `📦 ระบบจัดส่ง - ${shopName}`,
        rootFolderId
      );

      // สร้าง Customer Sheet
      const customerSheetId = await createSpreadsheet(
        accessToken,
        'ข้อมูลลูกค้า Delivery',
        deliveryFolderId,
        CUSTOMER_HEADERS
      );

      // สร้าง Order Sheet
      const orderSheetId = await createSpreadsheet(
        accessToken,
        'ออเดอร์ Delivery',
        deliveryFolderId,
        ORDER_HEADERS
      );

      // บันทึก IDs ลง Supabase (metadata เท่านั้น ไม่มีข้อมูลส่วนตัว)
      const { error: upsertErr } = await supabase
        .from('delivery_configs')
        .upsert({
          shop_id: shopId,
          delivery_folder_id: deliveryFolderId,
          customer_sheet_id: customerSheetId,
          order_sheet_id: orderSheetId,
        });
      if (upsertErr) throw new Error(upsertErr.message);

      return res.json({
        ok: true,
        deliveryFolderId,
        customerSheetId,
        orderSheetId,
      });
    } catch (err) {
      console.error('[delivery/setup]', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ error: 'Method not allowed' });
}
