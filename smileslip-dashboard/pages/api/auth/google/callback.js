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

    // 🎯 [Gamification Check]
    const { data: existingConfig } = await supabase
      .from('shop_google_configs')
      .select('id, google_refresh_token')
      .eq('shop_id', shopId)
      .maybeSingle();

    // 3. สร้าง Root Folder
    const folderRes = await axios.post(
      'https://www.googleapis.com/drive/v3/files',
      { name: `SMILE SLIP - ${shopDisplayName}`, mimeType: 'application/vnd.google-apps.folder' },
      { headers }
    );
    const folderId = folderRes.data.id;

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
    const sheetId = sheetRes.data.id;

    // 5. ตั้งค่าหัวตาราง 10 คอลัมน์ (✅ แก้ไขเป็น PUT ตามกฎของ Google)
    // ต้องตรงกับที่ Bot เขียนลงใน Sheets ทุก column
    const headers_10 = [[
      'วันที่สลิป', 'เวลา', 'ประเภท (รายรับ/รายจ่าย)', 'จำนวนเงิน (บาท)',
      'ผู้โอน', 'ผู้รับ', 'หมายเหตุ', 'ลิงก์สลิป (Drive)',
      'วันที่บันทึก (recorded_at)', 'ชื่อสาขา'
    ]];
    
    await axios.put(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A1:J1?valueInputOption=USER_ENTERED`,
      { values: headers_10 },
      { headers }
    );

    // 6. บันทึกลง Supabase (✅ แก้ไขการจัดการตัวแปรกันพัง)
    const configData = {
      shop_id: shopId,
      google_folder_id: folderId,
      google_sheet_id: sheetId,
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

    // 🎁 [Bonus Logic] ถ้าเชื่อมต่อครั้งแรก ให้โบนัส +30 เครดิต
    if (!existingConfig) {
      const { data: creditData } = await supabase.from('shop_credits').select('balance_credits').eq('shop_id', shopId).single();
      if (creditData) {
        await supabase.from('shop_credits')
          .update({ balance_credits: creditData.balance_credits + 30 })
          .eq('shop_id', shopId);
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