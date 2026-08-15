/**
 * GET  /api/pos/setup?shopId=xxx  → ตรวจว่าตั้งค่า POS แล้วหรือยัง
 * POST /api/pos/setup { shopId }  → สร้าง Drive folder แล้ว upsert pos_configs (ใช้ `configured`
 *   เป็นสัญญาณ "เปิดใช้งานโมดูล POS ครั้งแรกแล้ว" — ไม่ผูกกับ Google Sheets อีกต่อไป)
 *
 * Phase 2 Tier 143 (write-primary flip, 2026-07-29): เลิกสร้าง Google Sheets spreadsheet
 * (pos_sheet_id) ตั้งแต่ตอนนี้ — ไม่มีไฟล์ไหนใน pages/api/pos/*.js อ่าน pos_sheet_id อีกแล้ว
 * (ทุกตารางตัด Sheets ออกหมดแล้วในทุก Tier ก่อนหน้า) ยังคงสร้าง Drive folder ไว้เหมือนเดิม
 * เพราะยังใช้เก็บรูปสลิป/ใบเสร็จ/รูปหลักฐานต่างๆ (upload-photo.js ฯลฯ)
 */
import { createClient } from '@supabase/supabase-js';
import { getAccessToken, createFolder } from '../../../lib/google-pos';
import { requireOwnerOrStaffAuth } from '../../../lib/owner-auth';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  const shopId = req.method === 'GET' ? req.query.shopId : req.body?.shopId;
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });

  if (req.method === 'GET') {
    // เดิม enforce:false (chicken-and-egg เดียวกับ shop/data.js — เรียกซิงโครนัสตอนโหลดหน้าครั้งแรก
    // ใน pos.js's loadShopBody() ก่อน fetch-override จะติดตั้งเสร็จ) — แก้แล้วฝั่งเว็บ (loadShopBody
    // แนบ token เองจาก profile.id ที่เป็น local variable ไม่ต้องรอ override) จึงปิด enforce:true ได้จริง
    // — requireOwnerOrStaffAuth (ไม่ใช่ requireOwnerAuth เฉยๆ) เพราะ endpoint นี้ถูกเรียกจาก
    // loadShopBody() ทั้งเส้นทางเจ้าของร้านและเส้นทางแคชเชียร์ (staff-session) ร่วมกัน
    if (!requireOwnerOrStaffAuth(req, res, shopId, { enforce: true })) return;

    const { data, error } = await supabase
      .from('pos_configs')
      .select('pos_folder_id, created_at')
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

      const { error: upsertErr } = await supabase.from('pos_configs').upsert({
        shop_id: shopId,
        pos_folder_id: posFolderId,
      });

      if (upsertErr) return res.status(500).json({ error: upsertErr.message });

      return res.json({ ok: true, pos_folder_id: posFolderId });
    } catch (err) {
      console.error('[pos/setup]', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
