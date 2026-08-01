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

  // 2.4b ถ้า root folder Drive ถูกลบไปแล้ว (404) → สร้างใหม่ให้ร้าน แล้วอัปเดต Supabase (self-healing)
  // Phase 3 Tier 6 — ตัดครึ่งที่สร้าง spreadsheet ออกแล้ว (ไม่เขียน Sheets สำหรับบัญชีหลักอีก
  // ต่อไป — Google Drive ยังอยู่เป็นแค่ที่สำรองรูปสลิปเสริม)
  async function recreateShopGoogleAssets(accessToken, shop) {
    console.log(`[LOG] 🛠️ [SelfHeal] root folder Drive ของร้าน "${shop.shop_name}" ถูกลบไปแล้ว — กำลังสร้างใหม่...`);

    const folderRes = await axios.post('https://www.googleapis.com/drive/v3/files', {
      name: `SMILE SLIP - ${shop.shop_name}`,
      mimeType: 'application/vnd.google-apps.folder',
    }, { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } });
    const newFolderId = folderRes.data.id;

    await supabase.from('shop_google_configs').update({
      google_folder_id: newFolderId, updated_at: new Date().toISOString(),
    }).eq('shop_id', shop.id);
    await supabase.from('shop_profiles').update({
      google_folder_id: newFolderId,
    }).eq('id', shop.id);

    console.log(`[LOG] ✅ [SelfHeal] สร้าง Drive folder ใหม่สำเร็จ — folder:${newFolderId}`);
    return { folderId: newFolderId };
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

  // Phase 3 Tier 5 — persist ข้อมูลธุรกรรมลง Supabase (ledger_transactions) เป็น "required" เสมอ
  // ไม่ว่าร้านจะเชื่อมต่อ Google หรือไม่ (เดิม insert นี้ซ่อนอยู่ใน appendToGoogleSheet และไม่เคย
  // ถูกเรียกเลยถ้ายังไม่เชื่อมต่อ Google — ทำให้ร้านที่ไม่เชื่อม Google ไม่มีที่เก็บข้อมูลถาวรที่ไหน
  // เลยทั้งที่ยังถูกตัดเครดิต/แสดงผลว่า "บันทึกสำเร็จ" อยู่ เป็นบั๊กจริงที่เจอตอนวางแผน Phase 3) —
  // throw ถ้า insert ไม่สำเร็จ (caller ต้องเรียกก่อนตัดเครดิตเสมอ กันบั๊กเดิม) — ถ้าเป็น Postgres
  // unique-violation (23505, ชนกับ shop_id+slip_hash เดิม) ติด err.isDuplicate = true ให้ caller
  // เลือกได้เองว่าจะจัดการยังไง (สำหรับ OCR = race ระหว่าง retry ซ้อนกันของสลิปเดียวกัน, dedup
  // pre-check ของ Tier 4 ควรดักได้ก่อนอยู่แล้วในเกือบทุกกรณี อันนี้คือ defense-in-depth ชั้นสอง)
  async function persistLedgerTransaction(shopId, slipData, imageUrl, branchName, fingerprint, category, method, recorder) {
    const isNoImage = !imageUrl || imageUrl === 'ไม่มีรูปภาพ' || imageUrl === 'ไม่มีรูปภาพ (คีย์เอง)';
    const { error } = await supabase.from('ledger_transactions').insert({
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
    if (error) {
      if (error.code === '23505') {
        const dupErr = new Error('รายการนี้เคยถูกบันทึกไปแล้ว (ตรวจพบตอน insert — ซ้ำกับที่ dedup pre-check เจอไม่ทัน)');
        dupErr.isDuplicate = true;
        throw dupErr;
      }
      throw error;
    }
    console.log(`[LOG] ✅ persistLedgerTransaction สำเร็จ (shop: ${shopId}, ${slipData.type} ฿${slipData.amount})`);
  }

  // Phase 3 Tier 4 — แทนที่ checkDuplicateInSheets (ลบออกแล้วใน Tier 6 พร้อมกับ writeToGoogleSheet/
  // getOrCreateYearSheet เพราะไม่มีจุดเรียกใช้เหลือเลย) ด้วยเวอร์ชัน query ledger_transactions
  // (Supabase) ตรงๆ แทนการอ่านทั้งคอลัมน์ K ของ Sheets — คง fail-open contract เดิมทุกประการ
  // (return false เสมอถ้า query error อะไรก็ตาม ไม่บล็อกสลิปที่ถูกต้อง)
  async function checkDuplicateInSupabase(shopId, fingerprint) {
    if (!fingerprint || fingerprint === '-') return false;
    try {
      const { data, error } = await supabase
        .from('ledger_transactions')
        .select('id')
        .eq('shop_id', shopId)
        .eq('slip_hash', fingerprint)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return !!data;
    } catch (e) {
      console.warn('[WARN] checkDuplicateInSupabase ขัดข้อง (ข้าม):', e.message);
      return false; // fail-open เหมือน checkDuplicateInSheets เดิมทุกประการ
    }
  }

  // Phase 3 Tier 6 — ลบ ensurePendingReceiveSheet/appendPendingReceive/ensurePendingExpenseSheet/
  // appendPendingExpense/PENDING_RECEIVE_HEADERS/PENDING_EXPENSE_HEADERS ออกแล้ว (dead code ตั้งแต่
  // Tier 3 ตัด Sheets ออกจากคิว "รับสินค้ารอยืนยัน"/"รายจ่ายรอยืนยัน") — makePendingReceiveNo/
  // makePendingExpenseNo ยังใช้อยู่จริงสำหรับสร้าง pending_no ของแถว Supabase เท่านั้น เก็บไว้
  // (เพิ่มส่วนสุ่มต่อท้าย — เดิม Date.now() อย่างเดียวชนกันได้ถ้าเรียกในมิลลิวินาทีเดียวกัน ตอนนี้
  // insert Supabase เป็น required เพราะ pos_pending_receives/pos_pending_expenses กลายเป็นจุด
  // เดียวที่บันทึกข้อมูลนี้แล้ว ไม่ใช่แค่ secondary fire-and-forget เหมือนก่อน จึงต้องกันชนแบบ
  // เดียวกับ makeContactId()/makeSKU() ของ dashboard)
  function makePendingReceiveNo() {
    const rand = Math.random().toString(36).slice(2, 5).toUpperCase();
    return 'PR' + Date.now().toString(36).toUpperCase() + rand;
  }
  function makePendingExpenseNo() {
    const rand = Math.random().toString(36).slice(2, 5).toUpperCase();
    return 'PE' + Date.now().toString(36).toUpperCase() + rand;
  }

  return {
    getOrCreateDriveFolder,
    uploadToGoogleDrive,
    recreateShopGoogleAssets,
    persistLedgerTransaction,
    checkDuplicateInSupabase,
    parseTransactionAt,
    makePendingReceiveNo,
    makePendingExpenseNo,
  };
};
