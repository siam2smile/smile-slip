import { createClient } from '@supabase/supabase-js';
import axios from 'axios';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY);

export default async function handler(req, res) {
  const { code, state: shopId } = req.query;

  if (!code || !shopId) return res.status(400).json({ error: "Missing parameters (code or state)" });

  try {
    // 1. ดึงชื่อร้านค้าเพื่อตั้งชื่อโฟลเดอร์ให้พรีเมียม
    const { data: shopProfile, error: shopError } = await supabase.from('shop_profiles').select('shop_name, owner_line_id').eq('id', shopId).single();
    if (shopError) throw new Error(`Database Error (Shop): ${shopError.message}`);
    
    const shopDisplayName = shopProfile?.shop_name || "New Shop";

    // 2. แลก Tokens
    const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code',
    });

    const { access_token, refresh_token } = tokenResponse.data;
    const headers = { Authorization: `Bearer ${access_token}` };

    // ดึง email ของ Google account เพื่อแสดงในหน้า Settings
    let googleEmail = null;
    try {
      const profileRes = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', { headers });
      googleEmail = profileRes.data.email || null;
    } catch (e) { /* ไม่ block ถ้าดึงไม่ได้ */ }

    // 🎯 [Gamification Check]
    const { data: existingConfig, error: existingConfigError } = await supabase
      .from('shop_google_configs')
      .select('google_refresh_token, google_folder_id, google_sheet_id')
      .eq('shop_id', shopId)
      .maybeSingle();
    if (existingConfigError) throw new Error(`Database Error (Check Existing Config): ${existingConfigError.message}`);

    let folderId, sheetId;

    if (existingConfig?.google_folder_id && existingConfig?.google_sheet_id) {
      // ── Reconnect: token หมดอายุ — reuse folder/sheet เดิม ไม่สร้างใหม่ ──
      folderId = existingConfig.google_folder_id;
      sheetId = existingConfig.google_sheet_id;
      console.log(`[Google Reconnect] shop ${shopId} reusing folder ${folderId} / sheet ${sheetId}`);
    } else {
      // ── First connect: สร้าง folder + sheet ใหม่ ──
      // 3. สร้าง Root Folder
      const folderRes = await axios.post(
        'https://www.googleapis.com/drive/v3/files',
        { name: `SMILE SLIP - ${shopDisplayName}`, mimeType: 'application/vnd.google-apps.folder' },
        { headers }
      );
      folderId = folderRes.data.id;

      // 4. สร้าง Google Sheet
      const sheetRes = await axios.post(
        'https://www.googleapis.com/drive/v3/files',
        {
          name: `รายงานบัญชีรายรับ-รายจ่าย - Smile Slip`,
          mimeType: 'application/vnd.google-apps.spreadsheet',
          parents: [folderId],
        },
        { headers }
      );
      sheetId = sheetRes.data.id;

      // 5. ตั้งค่าหัวตาราง 15 คอลัมน์
      await axios.put(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A1:O1?valueInputOption=USER_ENTERED`,
        { values: [['วันที่สลิป','เวลา','ประเภท (รายรับ/รายจ่าย)','จำนวนเงิน (บาท)','ผู้โอน','ผู้รับ','หมายเหตุ','ลิงก์สลิป (Drive)','วันที่บันทึก (recorded_at)','ชื่อสาขา','เลขอ้างอิง/Hash','เลขภาษี','ชื่อผู้เสียภาษี','ยอดภาษี (บาท)','ที่อยู่ผู้เสียภาษี']] },
        { headers }
      );
    }

    // 6. บันทึกลง Supabase (✅ แก้ไขการจัดการตัวแปรกันพัง)
    const configData = {
      shop_id: shopId,
      google_folder_id: folderId,
      google_sheet_id: sheetId,
      google_email: googleEmail,
      updated_at: new Date().toISOString()
    };
    
    // อัปเดต refresh_token เฉพาะเมื่อ Google ส่งมาให้ใหม่เท่านั้น
    if (refresh_token) {
      configData.google_refresh_token = refresh_token;
    } else if (existingConfig?.google_refresh_token) {
      configData.google_refresh_token = existingConfig.google_refresh_token;
    }

    const { error: upsertError } = await supabase.from('shop_google_configs').upsert(configData);
    if (upsertError) throw new Error(`Database Error (Upsert Config): ${upsertError.message}`);

    // 🎁 [Bonus Logic] ให้โบนัสเครดิตครั้งแรกที่เชื่อมต่อ Google เท่านั้น
    // ใช้ flag เฉพาะบน shop_profiles (ไม่ใช่ "มีแถว shop_google_configs อยู่ไหม") เพราะแถว config
    // อาจถูกล้าง/หาไม่เจอชั่วคราวได้จากหลายสาเหตุ (เช่น query ขัดข้อง) ซึ่งจะทำให้ logic เดิมเข้าใจผิด
    // ว่าเป็นการเชื่อมต่อครั้งแรกและให้โบนัสซ้ำได้ — flag นี้กันเคสนั้นได้เด็ดขาด
    const { data: shopForBonus, error: shopForBonusError } = await supabase
      .from('shop_profiles')
      .select('referred_by, google_bonus_granted')
      .eq('id', shopId)
      .single();
    if (shopForBonusError) throw new Error(`Database Error (Check Bonus Flag): ${shopForBonusError.message}`);

    if (!shopForBonus.google_bonus_granted) {
      // ─── โบนัสให้ร้านที่เพิ่งเชื่อมต่อ ───
      // ปกติ +30, ถ้ามีคนแนะนำมา +50
      const hasReferral = !!(shopForBonus?.referred_by);
      const newShopBonus = hasReferral ? 50 : 30;

      await supabase.rpc('add_shop_credit', { p_shop_id: shopId, p_amount: newShopBonus });
      await supabase.from('shop_profiles').update({ google_bonus_granted: true }).eq('id', shopId);
      console.log(`[Google Connect] shop ${shopId} bonus +${newShopBonus} credits (referral: ${hasReferral})`);

      // ─── โบนัสให้คนที่แนะนำ: +50 เครดิต ───
      if (hasReferral) {
        try {
          const { data: referrerShop } = await supabase
            .from('shop_profiles')
            .select('id')
            .eq('referral_code', shopForBonus.referred_by)
            .maybeSingle();

          if (referrerShop) {
            await supabase.rpc('add_shop_credit', { p_shop_id: referrerShop.id, p_amount: 50 });
            console.log(`[Referral] referrer shop ${referrerShop.id} +50 credits`);
          }
        } catch (refErr) {
          console.warn('[Referral] bonus failed:', refErr.message);
        }
      }
    }

    // สำเร็จ! เด้งกลับหน้า Dashboard
    res.redirect(`/dashboard?userId=${shopProfile.owner_line_id}&googleConnected=true`);

  } catch (error) {
    // ✅ แสดง Error ออกมาให้เห็นชัดๆ บนหน้าจอเลย จะได้แก้ถูกจุด
    const errorMsg = error.response?.data?.error?.message || error.response?.data || error.message;
    console.error("Callback Exact Error:", errorMsg);
    
    // โชว์ Error บนหน้าเว็บเพื่อให้คุณ Vespa แคปจอมาให้ผมวิเคราะห์ต่อได้
    res.status(500).json({ 
      error: "เกิดข้อผิดพลาดในการเชื่อมต่อ Google", 
      details: errorMsg 
    });
  }
}