// smileslip-pro/lib/ledger-google.js
// Phase 3 Tier 2 — ฟังก์ชัน Google Sheets/Drive ของบอทที่แยกออกมาจาก index.js (pure refactor,
// พฤติกรรมเหมือนเดิม 100% แค่ย้ายที่อยู่โค้ดเพื่อให้ diff ของ tier ถัดๆ ไปรีวิวง่ายขึ้น) — รับ deps
// ที่ต้องใช้ผ่าน factory function แทนการ require ตรงๆ ในไฟล์นี้ (axios/FormData/supabase/
// getThaiDateTime ทั้งหมดมาจาก index.js เดิม ไม่สร้าง instance ใหม่ซ้ำซ้อน)
module.exports = function createLedgerGoogle({ axios, FormData, supabase, getThaiDateTime }) {

  // 2.4 สร้างโฟลเดอร์ Google Drive แบบแยกตาม เดือน/ปี
  async function getOrCreateDriveFolder(accessToken, parentFolderId, folderName) {
    console.log(`[LOG] 📁 ค้นหา folder "${folderName}" ใน parent: ${parentFolderId}`);
    const query = `name='${folderName}' and '${parentFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true`;

    const searchRes = await axios.get(searchUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
    const found = searchRes.data.files;

    if (found && found.length > 0) {
      console.log(`[LOG] ✅ พบ folder "${folderName}" เดิม (ID: ${found[0].id})`);
      return found[0].id;
    }

    console.log(`[LOG] ➕ ไม่พบ folder "${folderName}" — กำลังสร้างใหม่...`);
    const createRes = await axios.post('https://www.googleapis.com/drive/v3/files', {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentFolderId]
    }, { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } });

    console.log(`[LOG] ✅ สร้าง folder "${folderName}" สำเร็จ (ID: ${createRes.data.id})`);
    return createRes.data.id;
  }

  // 2.4b ถ้า root folder/sheet ถูกลบไปแล้ว (404) → สร้างใหม่ให้ร้าน แล้วอัปเดต Supabase (self-healing)
  async function recreateShopGoogleAssets(accessToken, shop) {
    console.log(`[LOG] 🛠️ [SelfHeal] root folder/sheet ของร้าน "${shop.shop_name}" ถูกลบไปแล้ว — กำลังสร้างใหม่...`);

    const folderRes = await axios.post('https://www.googleapis.com/drive/v3/files', {
      name: `SMILE SLIP - ${shop.shop_name}`,
      mimeType: 'application/vnd.google-apps.folder',
    }, { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } });
    const newFolderId = folderRes.data.id;

    const sheetRes = await axios.post('https://sheets.googleapis.com/v4/spreadsheets', {
      properties: { title: `SMILE SLIP - ${shop.shop_name}` },
    }, { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } });
    const newSheetId = sheetRes.data.spreadsheetId;

    // Sheets API สร้างไฟล์ที่ root Drive โดย default — ย้ายเข้า folder ใหม่
    await axios.patch(
      `https://www.googleapis.com/drive/v3/files/${newSheetId}?addParents=${newFolderId}&fields=id,parents`,
      {}, { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    await supabase.from('shop_google_configs').update({
      google_folder_id: newFolderId, google_sheet_id: newSheetId, updated_at: new Date().toISOString(),
    }).eq('shop_id', shop.id);
    await supabase.from('shop_profiles').update({
      google_folder_id: newFolderId, google_sheet_id: newSheetId,
    }).eq('id', shop.id);

    console.log(`[LOG] ✅ [SelfHeal] สร้างใหม่สำเร็จ — folder:${newFolderId} sheet:${newSheetId}`);
    return { folderId: newFolderId, sheetId: newSheetId };
  }

  // 2.5 อัปโหลดรูปลง Google Drive
  async function uploadToGoogleDrive(imageBuffer, accessToken, folderId, fileName) {
    console.log(`[LOG] ☁️ กำลังอัปโหลดรูปลง Google Drive...`);
    const form = new FormData();
    form.append('metadata', JSON.stringify({ name: fileName, parents: [folderId] }), { contentType: 'application/json' });
    form.append('file', imageBuffer, { filename: fileName, contentType: 'image/jpeg' });

    const res = await axios.post('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', form, {
      headers: { ...form.getHeaders(), Authorization: `Bearer ${accessToken}` }
    });

    console.log(`[LOG] ✅ อัปโหลดรูปสำเร็จ (Drive ID: ${res.data.id})`);
    return res.data.id;
  }

  // 2.6 สร้าง tab ปีใน Spreadsheet (ถ้ายังไม่มี) พร้อม header 11 คอลัมน์
  // ถ้า sheet มีอยู่แล้วแต่ยังไม่มี column K → patch header อัตโนมัติ
  async function getOrCreateYearSheet(accessToken, spreadsheetId, year) {
    const metaRes = await axios.get(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const exists = metaRes.data.sheets?.some(s => s.properties.title === year);
    if (exists) {
      // เช็ค header คอลัมน์ที่เพิ่มเข้ามาทีหลัง (sheet เก่าอาจไม่มี) แล้ว patch ให้ครบ
      const MISSING_HEADER_PATCHES = [
        ['K', 'เลขอ้างอิง/Hash'],
        ['P', 'หมวดหมู่'],
        ['Q', 'วิธีรับ-จ่าย (โอน/เงินสด)'],
        ['R', 'ผู้บันทึก'],
      ];
      for (const [col, headerText] of MISSING_HEADER_PATCHES) {
        try {
          const cellRes = await axios.get(
            `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(year + '!' + col + '1')}`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );
          const cellVal = cellRes.data.values?.[0]?.[0] || '';
          if (!cellVal) {
            console.log(`[LOG] 🔧 Patch column ${col} header บน sheet "${year}" (sheet เก่า)`);
            await axios.put(
              `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(year + '!' + col + '1')}?valueInputOption=USER_ENTERED`,
              { values: [[headerText]] },
              { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
            );
          }
        } catch (e) { /* ข้ามถ้า patch ไม่ได้ */ }
      }
      console.log(`[LOG] ✅ Sheet tab "${year}" มีอยู่แล้ว`);
      return;
    }

    console.log(`[LOG] ➕ สร้าง Sheet tab "${year}" ใหม่...`);
    try {
      await axios.post(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
        { requests: [{ addSheet: { properties: { title: year } } }] },
        { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
      );
    } catch (addErr) {
      // ถ้า tab ถูกสร้างไปแล้วโดย request อื่น (race condition) → ถือว่า OK
      const msg = addErr.response?.data?.error?.message || addErr.message || '';
      if (!msg.includes('already exists')) throw addErr;
      console.log(`[LOG] ℹ️ Sheet tab "${year}" ถูกสร้างโดย request อื่นไปแล้ว — ข้ามได้`);
    }
    await axios.put(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(year + '!A1:R1')}?valueInputOption=USER_ENTERED`,
      { values: [['วันที่สลิป','เวลา','ประเภท (รายรับ/รายจ่าย)','จำนวนเงิน (บาท)','ผู้โอน','ผู้รับ','หมายเหตุ','ลิงก์สลิป (Drive)','วันที่บันทึก (recorded_at)','ชื่อสาขา','เลขอ้างอิง/Hash','เลขภาษี','ชื่อผู้เสียภาษี','ยอดภาษี (บาท)','ที่อยู่ผู้เสียภาษี','หมวดหมู่','วิธีรับ-จ่าย (โอน/เงินสด)','ผู้บันทึก']] },
      { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
    );
    console.log(`[LOG] ✅ สร้าง Sheet tab "${year}" พร้อม header 16 คอลัมน์สำเร็จ`);
  }
  // Tier D migration — แปลงวันที่-เวลาของสลิป/รายการ (สตริงไทย อาจเป็น พ.ศ., รูปแบบไม่แน่นอนเพราะ
  // OCR อ่านมา) เป็น timestamp จริงสำหรับ ledger_transactions.transaction_at — เป็นแค่ฟิลด์รอง
  // (secondary/best-effort, ยังไม่มีใครอ่านจากตารางนี้จริงจนกว่าจะทำ read-cutover) เลยไม่พยายาม parse
  // ให้สมบูรณ์แบบ ผิดพลาดตรงไหน fallback เป็นเวลาปัจจุบันเสมอ ไม่ throw ออกไปกระทบการบันทึกจริง
  function parseTransactionAt(dateStr, timeStr) {
    try {
      const parts = (dateStr || '').split('/');
      if (parts.length === 3) {
        let [d, m, y] = parts.map(p => parseInt(p.trim(), 10));
        if (y > 2500) y -= 543; // แปลง พ.ศ. → ค.ศ.
        if (y < 100) y += 2000;
        const currentYear = new Date(new Date().getTime() + (7 * 60 * 60 * 1000)).getFullYear();
        if (y < currentYear - 1 || y > currentYear + 1) y = currentYear; // OCR อ่านปีผิด — ใช้ปีปัจจุบันแทน
        const [hh, mm, ss] = (timeStr || '00:00:00').split(':').map(p => parseInt(p, 10) || 0);
        if (d && m && y) {
          const dt = new Date(Date.UTC(y, m - 1, d, (hh || 0) - 7, mm || 0, ss || 0)); // -7 ชม. แปลง Bangkok → UTC
          if (!isNaN(dt.getTime())) return dt.toISOString();
        }
      }
    } catch { /* ignore — fallback ด้านล่าง */ }
    return new Date().toISOString();
  }

  // 2.7 บันทึกข้อมูลลง Google Sheets (tab แยกตามปี)
  // คอลัมน์: A=วันที่สลิป B=เวลา C=ประเภท D=ยอด E=ผู้โอน F=ผู้รับ G=หมายเหตุ H=ลิงก์รูป I=recorded_at J=สาขา K=เลขอ้างอิง/Hash L=เลขภาษี M=ชื่อผู้เสียภาษี N=ยอดภาษี O=ที่อยู่ผู้เสียภาษี P=หมวดหมู่ Q=วิธีรับ-จ่าย R=ผู้บันทึก
  async function appendToGoogleSheet(accessToken, spreadsheetId, slipData, imageUrl, branchName = '-', sheetYear = null, fingerprint = '-', category = '-', method = '-', recorder = '-', shopId = null) {
    console.log(`[LOG] 📊 กำลังบันทึกข้อมูลลง Google Sheet${sheetYear ? ' tab ' + sheetYear : ''}...`);
    const range = sheetYear ? encodeURIComponent(sheetYear + '!A1') : 'A1';
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:append?valueInputOption=USER_ENTERED`;
    const { isoDate } = getThaiDateTime();
    const values = [[
      slipData.date, slipData.time,
      slipData.type === 'income' ? 'รายรับ' : 'รายจ่าย',
      slipData.amount, slipData.sender || '-',
      slipData.receiver || '-', slipData.note || '-',
      imageUrl || 'ไม่มีรูปภาพ',
      isoDate,
      branchName,
      fingerprint,                           // K — เลขอ้างอิงหรือ image hash
      slipData.tax_id       || '-',          // L — เลขภาษี
      slipData.taxpayer_name || '-',         // M — ชื่อผู้เสียภาษี
      slipData.tax_amount   || '-',          // N — ยอดภาษี
      slipData.tax_address  || '-',          // O — ที่อยู่ผู้เสียภาษี
      category,                              // P — หมวดหมู่
      method   || '-',                       // Q — วิธีรับ-จ่าย (โอน/เงินสด)
      recorder || '-',                        // R — ผู้บันทึก (ชื่อ LINE ของคนส่ง/คีย์)
    ]];
    await axios.post(url, { values }, { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } });
    console.log(`[LOG] ✅ บันทึกลง Google Sheet สำเร็จ (สาขา: ${branchName})`);

    // Tier D migration — เขียนคู่เข้า ledger_transactions (Supabase) แบบ fire-and-forget เสมอ
    // (Sheets ยังเป็น primary/บังคับสำเร็จเหมือนเดิมทุกประการ อันนี้แค่เก็บสำเนาไว้เผื่ออนาคต)
    if (shopId) {
      try {
        const isNoImage = !imageUrl || imageUrl === 'ไม่มีรูปภาพ' || imageUrl === 'ไม่มีรูปภาพ (คีย์เอง)';
        const { error: ledgerErr } = await supabase.from('ledger_transactions').insert({
          shop_id: shopId,
          type: slipData.type === 'income' ? 'income' : 'expense',
          amount: slipData.amount,
          category: category === '-' ? null : category,
          note: slipData.note || '-',
          slip_url: isNoImage ? null : imageUrl,
          slip_hash: fingerprint === '-' ? null : fingerprint,
          sender_name: slipData.sender || '-',
          receiver_name: slipData.receiver || '-',
          branch_name: branchName,
          tax_id: (slipData.tax_id && slipData.tax_id !== '-') ? slipData.tax_id : null,
          taxpayer_name: (slipData.taxpayer_name && slipData.taxpayer_name !== '-') ? slipData.taxpayer_name : null,
          tax_amount: (slipData.tax_amount && slipData.tax_amount !== '-') ? slipData.tax_amount : null,
          tax_address: (slipData.tax_address && slipData.tax_address !== '-') ? slipData.tax_address : null,
          payment_method: method === '-' ? null : method,
          recorder_name: recorder === '-' ? null : recorder,
          transaction_at: parseTransactionAt(slipData.date, slipData.time),
          raw_data: { source: 'bot-ledger', fingerprint },
        });
        if (ledgerErr) throw ledgerErr;
      } catch (e) {
        console.error('[LOG] ledger_transactions dual-write error (ข้าม):', e.message);
      }
    }
  }

  // 2.7b ตรวจสอบสลิปซ้ำใน Google Sheets column K (long-term, ข้ามการ restart)
  async function checkDuplicateInSheets(accessToken, sheetId, fingerprint, year) {
    if (!fingerprint || fingerprint === '-') return false;
    try {
      const range = encodeURIComponent(`${year}!K:K`);
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}`;
      const res = await axios.get(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      const values = (res.data.values || []).flat();
      return values.includes(fingerprint);
    } catch (e) {
      console.warn('[WARN] checkDuplicateInSheets ขัดข้อง (ข้าม):', e.message);
      return false; // ถ้าเช็กไม่ได้ให้ผ่านไปก่อน
    }
  }

  // tab "รับสินค้ารอยืนยัน" ใน POS Sheet ของร้าน (คนละ tab กับ "รับสินค้า" ที่ยืนยันแล้ว — รอแอดมินตรวจก่อนตัดสต็อคจริง)
  const PENDING_RECEIVE_HEADERS = ['เลขที่รอยืนยัน', 'วันที่-เวลา', 'ผู้จำหน่าย (OCR)', 'เลขที่เอกสาร', 'วันที่ในเอกสาร', 'รายการสินค้า (JSON)', 'ลิงก์รูปภาพ', 'สาขา', 'สถานะ'];
  async function ensurePendingReceiveSheet(accessToken, posSheetId) {
    const metaRes = await axios.get(
      `https://sheets.googleapis.com/v4/spreadsheets/${posSheetId}?fields=sheets.properties`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const exists = metaRes.data.sheets?.some(s => s.properties.title === 'รับสินค้ารอยืนยัน');
    if (exists) return;
    try {
      await axios.post(
        `https://sheets.googleapis.com/v4/spreadsheets/${posSheetId}:batchUpdate`,
        { requests: [{ addSheet: { properties: { title: 'รับสินค้ารอยืนยัน' } } }] },
        { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
      );
    } catch (addErr) {
      const msg = addErr.response?.data?.error?.message || addErr.message || '';
      if (!msg.includes('already exists')) throw addErr;
    }
    await axios.put(
      `https://sheets.googleapis.com/v4/spreadsheets/${posSheetId}/values/${encodeURIComponent('รับสินค้ารอยืนยัน!A1:I1')}?valueInputOption=USER_ENTERED`,
      { values: [PENDING_RECEIVE_HEADERS] },
      { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
    );
  }
  function makePendingReceiveNo() {
    return 'PR' + Date.now().toString(36).toUpperCase();
  }
  async function appendPendingReceive(accessToken, posSheetId, row) {
    await axios.post(
      `https://sheets.googleapis.com/v4/spreadsheets/${posSheetId}/values/${encodeURIComponent('รับสินค้ารอยืนยัน!A1')}:append?valueInputOption=USER_ENTERED`,
      { values: [row] },
      { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
    );
  }

  // tab "รายจ่ายรอยืนยัน" ใน POS Sheet ของร้าน — คนละ tab กับ "รายจ่าย" ที่ยืนยันแล้ว รอแอดมินตรวจก่อนบันทึกจริง
  const PENDING_EXPENSE_HEADERS = ['เลขที่รอยืนยัน', 'วันที่-เวลา', 'รายการ/หมวดหมู่ (OCR)', 'ผู้รับเงิน (OCR)', 'จำนวนเงิน (OCR)', 'ประเภท VAT (OCR)', 'เลขที่เอกสาร', 'วันที่ในเอกสาร', 'ลิงก์รูปภาพ', 'สาขา', 'สถานะ'];
  async function ensurePendingExpenseSheet(accessToken, posSheetId) {
    const metaRes = await axios.get(
      `https://sheets.googleapis.com/v4/spreadsheets/${posSheetId}?fields=sheets.properties`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const exists = metaRes.data.sheets?.some(s => s.properties.title === 'รายจ่ายรอยืนยัน');
    if (exists) return;
    try {
      await axios.post(
        `https://sheets.googleapis.com/v4/spreadsheets/${posSheetId}:batchUpdate`,
        { requests: [{ addSheet: { properties: { title: 'รายจ่ายรอยืนยัน' } } }] },
        { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
      );
    } catch (addErr) {
      const msg = addErr.response?.data?.error?.message || addErr.message || '';
      if (!msg.includes('already exists')) throw addErr;
    }
    await axios.put(
      `https://sheets.googleapis.com/v4/spreadsheets/${posSheetId}/values/${encodeURIComponent('รายจ่ายรอยืนยัน!A1:K1')}?valueInputOption=USER_ENTERED`,
      { values: [PENDING_EXPENSE_HEADERS] },
      { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
    );
  }
  function makePendingExpenseNo() {
    return 'PE' + Date.now().toString(36).toUpperCase();
  }
  async function appendPendingExpense(accessToken, posSheetId, row) {
    await axios.post(
      `https://sheets.googleapis.com/v4/spreadsheets/${posSheetId}/values/${encodeURIComponent('รายจ่ายรอยืนยัน!A1')}:append?valueInputOption=USER_ENTERED`,
      { values: [row] },
      { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
    );
  }

  return {
    getOrCreateDriveFolder,
    uploadToGoogleDrive,
    recreateShopGoogleAssets,
    getOrCreateYearSheet,
    appendToGoogleSheet,
    checkDuplicateInSheets,
    parseTransactionAt,
    ensurePendingReceiveSheet,
    appendPendingReceive,
    makePendingReceiveNo,
    PENDING_RECEIVE_HEADERS,
    ensurePendingExpenseSheet,
    appendPendingExpense,
    makePendingExpenseNo,
    PENDING_EXPENSE_HEADERS,
  };
};
