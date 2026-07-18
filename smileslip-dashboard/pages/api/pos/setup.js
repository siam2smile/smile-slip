/**
 * GET  /api/pos/setup?shopId=xxx  → ตรวจว่าตั้งค่า POS แล้วหรือยัง
 * POST /api/pos/setup { shopId }  → สร้าง folder + sheet แล้ว upsert pos_configs
 */
import { createClient } from '@supabase/supabase-js';
import { getAccessToken, createFolder, createPosSpreadsheet } from '../../../lib/google-pos';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  const shopId = req.method === 'GET' ? req.query.shopId : req.body?.shopId;
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('pos_configs')
      .select('pos_folder_id, pos_sheet_id, created_at')
      .eq('shop_id', shopId)
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.json({ configured: false });
    return res.json({ configured: true, ...data });
  }

  if (req.method === 'POST') {
    const [{ data: gc, error: gcErr }, { data: sp, error: spErr }] = await Promise.all([
      supabase.from('shop_google_configs').select('google_refresh_token, google_folder_id').eq('shop_id', shopId).single(),
      supabase.from('shop_profiles').select('shop_name, google_folder_id').eq('id', shopId).single(),
    ]);

    if (gcErr || !gc?.google_refresh_token)
      return res.status(400).json({ error: 'ยังไม่ได้เชื่อมต่อ Google Drive', notConnected: true });

    try {
      const accessToken = await getAccessToken(gc.google_refresh_token);
      const shopName = sp?.shop_name || 'ร้านค้า';

      // หา root folder_id: ลอง shop_profiles ก่อน → fallback shop_google_configs → สร้างใหม่
      let rootFolderId = sp?.google_folder_id || gc?.google_folder_id;

      if (!rootFolderId) {
        // บัญชีเก่าที่ไม่มี root folder — สร้างใหม่ใน root ของ Google Drive
        rootFolderId = await createFolder(accessToken, `SMILE SLIP - ${shopName}`, null);
        // บันทึก folder_id กลับใน shop_profiles เพื่อใช้ต่อในอนาคต
        await supabase.from('shop_profiles').update({ google_folder_id: rootFolderId }).eq('id', shopId);
        await supabase.from('shop_google_configs').update({ google_folder_id: rootFolderId }).eq('shop_id', shopId);
        console.log(`[pos/setup] created new root folder for shop ${shopId}: ${rootFolderId}`);
      }

      const posFolderId = await createFolder(
        accessToken,
        `🛒 ระบบขายหน้าร้าน - ${shopName}`,
        rootFolderId
      );

      const sheetId = await createPosSpreadsheet(
        accessToken,
        `📦 สต็อคสินค้า - ${shopName}`,
        posFolderId
      );

      const { error: upsertErr } = await supabase.from('pos_configs').upsert({
        shop_id: shopId,
        pos_folder_id: posFolderId,
        pos_sheet_id: sheetId,
      });

      if (upsertErr) return res.status(500).json({ error: upsertErr.message });

      return res.json({ ok: true, pos_folder_id: posFolderId, pos_sheet_id: sheetId });
    } catch (err) {
      console.error('[pos/setup]', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
