/**
 * GET   /api/sheets/update-transaction?shopId=xxx&year=2026&ref=xxx  → ดึงธุรกรรม 1 แถวเพื่อแก้ไข
 * PATCH /api/sheets/update-transaction                                → บันทึกการแก้ไขลง Google Sheets
 *   body: { shopId, year, ref, date, time, type, amount, sender, receiver, note }
 *
 * ระบุแถวด้วย column K (เลขอ้างอิง/Hash)
 * แก้ได้เฉพาะ A-G | ถ้า type หรือ date เปลี่ยน → ย้ายรูปใน Drive อัตโนมัติ
 */
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

async function getSheetAccess(shopId) {
  const { data: shop } = await supabase
    .from('shop_profiles')
    .select('google_sheet_id')
    .eq('id', shopId)
    .single();

  const { data: gConfig } = await supabase
    .from('shop_google_configs')
    .select('google_refresh_token, google_sheet_id, google_folder_id')
    .eq('shop_id', shopId)
    .single();

  const sheetId = gConfig?.google_sheet_id || shop?.google_sheet_id;
  if (!sheetId || !gConfig?.google_refresh_token) return null;

  const tokenRes = await axios.post('https://oauth2.googleapis.com/token', {
    refresh_token: gConfig.google_refresh_token,
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    grant_type: 'refresh_token',
  });
  return {
    sheetId,
    accessToken: tokenRes.data.access_token,
    folderId: gConfig?.google_folder_id || null,
  };
}

// หาแถวจาก column K (อ่านถึง P เพื่อดึงหมวดหมู่ด้วย)
async function findRowByRef(accessToken, sheetId, year, ref) {
  const range = encodeURIComponent(`${year}!A:P`);
  const res = await axios.get(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const allRows = res.data.values || [];
  for (let i = 1; i < allRows.length; i++) {
    if ((allRows[i][10] || '').trim() === ref.trim()) {
      return { rowNumber: i + 1, row: allRows[i] };
    }
  }
  return null;
}

// แปลง DD/MM/YYYY → { year, monthFolder }
function parseDateForFolder(dateStr) {
  const parts = (dateStr || '').split('/');
  if (parts.length !== 3) return null;
  let [, mm, yyyy] = parts.map(p => parseInt(p.trim(), 10));
  if (isNaN(mm) || isNaN(yyyy)) return null;
  if (yyyy > 2500) yyyy -= 543;
  if (yyyy < 100) yyyy += 2000;
  return { year: String(yyyy), monthFolder: `${String(mm).padStart(2, '0')}-${yyyy}` };
}

// Extract Drive file ID จาก URL
function extractDriveFileId(url) {
  if (!url) return null;
  const m = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

// สร้างหรือหา folder ใน Drive
async function getOrCreateFolder(accessToken, parentId, folderName) {
  try {
    const q = `name='${folderName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const res = await axios.get('https://www.googleapis.com/drive/v3/files', {
      params: { q, fields: 'files(id)', pageSize: 1 },
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.data.files?.length > 0) return res.data.files[0].id;
    const create = await axios.post(
      'https://www.googleapis.com/drive/v3/files',
      { name: folderName, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    return create.data.id;
  } catch { return null; }
}

// ย้ายไฟล์ Drive ไปยัง folder ใหม่
async function moveDriveFile(accessToken, fileId, newParentId) {
  const fileRes = await axios.get(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=parents`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const oldParents = (fileRes.data.parents || []).join(',');
  await axios.patch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?addParents=${newParentId}&removeParents=${oldParents}&fields=id`,
    {},
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
}

// คำนวณ target folder ID: rootFolder → year → month → รายรับ|รายจ่าย
async function resolveTypeFolder(accessToken, rootFolderId, dateStr, typeLabel) {
  const parsed = parseDateForFolder(dateStr);
  if (!parsed || !rootFolderId) return null;
  const yearId = await getOrCreateFolder(accessToken, rootFolderId, parsed.year);
  if (!yearId) return null;
  const monthId = await getOrCreateFolder(accessToken, yearId, parsed.monthFolder);
  if (!monthId) return null;
  const typeFolderName = typeLabel === 'รายรับ' ? 'รายรับ' : 'รายจ่าย';
  return await getOrCreateFolder(accessToken, monthId, typeFolderName);
}

export default async function handler(req, res) {
  // ─── GET ───
  if (req.method === 'GET') {
    const { shopId, year, ref } = req.query;
    if (!shopId || !ref) return res.status(400).json({ error: 'ข้อมูลไม่ครบ (shopId, ref)' });

    try {
      const access = await getSheetAccess(shopId);
      if (!access) return res.status(400).json({ error: 'ยังไม่ได้เชื่อมต่อ Google Sheets' });

      const targetYear = year || new Date().getFullYear().toString();
      const found = await findRowByRef(access.accessToken, access.sheetId, targetYear, ref);
      if (!found) return res.status(404).json({ error: 'ไม่พบรายการนี้ (อาจถูกลบหรืออยู่คนละปี)' });

      const r = found.row;
      return res.status(200).json({
        transaction: {
          date: r[0] || '', time: r[1] || '', type: r[2] || '',
          amount: r[3] || '', sender: r[4] || '', receiver: r[5] || '',
          note: r[6] || '', slipUrl: r[7] || '', recordedAt: r[8] || '',
          branch: r[9] || '', ref: r[10] || '',
          taxId: r[11] || '',          // L — เลขภาษี
          taxpayerName: r[12] || '',   // M — ชื่อผู้เสียภาษี
          taxAmount: r[13] || '',      // N — ยอดภาษีมูลค่าเพิ่ม
          category: r[15] || '',       // P — หมวดหมู่
        },
        rowNumber: found.rowNumber,
        year: targetYear,
      });
    } catch (err) {
      console.error('[API/update-transaction GET]', err.response?.data || err.message);
      return res.status(500).json({ error: 'โหลดข้อมูลไม่สำเร็จ' });
    }
  }

  // ─── PATCH ───
  if (req.method === 'PATCH') {
    const { shopId, year, ref, date, time, type, amount, sender, receiver, note, category, learnKeyword, taxId, taxpayerName, taxAmount } = req.body;
    if (!shopId || !ref || !year) return res.status(400).json({ error: 'ข้อมูลไม่ครบ (shopId, year, ref)' });
    if (type !== 'รายรับ' && type !== 'รายจ่าย') return res.status(400).json({ error: 'ประเภทต้องเป็น รายรับ หรือ รายจ่าย' });
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum < 0) return res.status(400).json({ error: 'จำนวนเงินไม่ถูกต้อง' });
    const taxAmountNum = taxAmount !== undefined && taxAmount !== '' ? parseFloat(taxAmount) || 0 : null;

    try {
      const access = await getSheetAccess(shopId);
      if (!access) return res.status(400).json({ error: 'ยังไม่ได้เชื่อมต่อ Google Sheets' });

      const found = await findRowByRef(access.accessToken, access.sheetId, year, ref);
      if (!found) return res.status(404).json({ error: 'ไม่พบรายการนี้ (อาจถูกลบไปแล้ว)' });

      const oldRow = found.row;
      const oldType = oldRow[2] || '';
      const oldDate = oldRow[0] || '';
      const slipUrl = oldRow[7] || '';

      // บันทึกข้อมูลใหม่ลง Sheets A-G
      const writeRange = encodeURIComponent(`${year}!A${found.rowNumber}:G${found.rowNumber}`);
      await axios.put(
        `https://sheets.googleapis.com/v4/spreadsheets/${access.sheetId}/values/${writeRange}?valueInputOption=USER_ENTERED`,
        { values: [[date || oldDate, time || oldRow[1], type, amountNum, sender || '-', receiver || '-', note || '-']] },
        { headers: { Authorization: `Bearer ${access.accessToken}`, 'Content-Type': 'application/json' } }
      );

      // บันทึกข้อมูลภาษี column L-N (ถ้ามีการแก้ไข)
      if (taxId !== undefined || taxAmountNum !== null) {
        const taxRange = encodeURIComponent(`${year}!L${found.rowNumber}:N${found.rowNumber}`);
        await axios.put(
          `https://sheets.googleapis.com/v4/spreadsheets/${access.sheetId}/values/${taxRange}?valueInputOption=USER_ENTERED`,
          { values: [[taxId || '-', taxpayerName || '-', taxAmountNum !== null ? taxAmountNum : '-']] },
          { headers: { Authorization: `Bearer ${access.accessToken}`, 'Content-Type': 'application/json' } }
        ).catch(e => console.warn('[update-transaction] บันทึก tax fields ไม่สำเร็จ (ข้าม):', e.message));
      }

      // บันทึกหมวดหมู่ลง column P (ถ้ามี)
      if (category && category !== '-') {
        const catRange = encodeURIComponent(`${year}!P${found.rowNumber}`);
        await axios.put(
          `https://sheets.googleapis.com/v4/spreadsheets/${access.sheetId}/values/${catRange}?valueInputOption=USER_ENTERED`,
          { values: [[category]] },
          { headers: { Authorization: `Bearer ${access.accessToken}`, 'Content-Type': 'application/json' } }
        ).catch(e => console.warn('[update-transaction] บันทึก category ไม่สำเร็จ (ข้าม):', e.message));

        // บันทึก learned rule ถ้า user กรอก keyword
        if (learnKeyword && learnKeyword.trim().length >= 2) {
          await supabase.from('shop_category_rules').upsert(
            { shop_id: shopId, keyword: learnKeyword.trim().toLowerCase(), category },
            { onConflict: 'shop_id,keyword' }
          ).then(({ error: e }) => {
            if (e) console.warn('[update-transaction] บันทึก category rule ไม่สำเร็จ:', e.message);
          });
        }
      }

      // ─── sync slip_analytics.transaction_type ใน Supabase ถ้า type เปลี่ยน ───
      const newDate = date || oldDate;
      const typeChanged = type !== oldType;
      const dateChanged = newDate !== oldDate;

      // sync slip_analytics.transaction_type ใน Supabase ถ้า type เปลี่ยน
      // ใช้ recordedAt (column I = YYYY-MM-DD) ซึ่งตรงกับ slip_analytics.slip_date ที่บอทบันทึก
      // best-effort: ถ้ามีหลายสลิปวันเดียวกัน shop เดียวกัน จะ update ทุกแถว (analytics ไม่ใช่ข้อมูลการเงิน)
      if (typeChanged && oldRow[8]) {
        const analyticsType = type === 'รายรับ' ? 'income' : 'expense';
        supabase.from('slip_analytics')
          .update({ transaction_type: analyticsType })
          .eq('shop_id', shopId)
          .eq('slip_date', oldRow[8])  // column I = recordedAt = YYYY-MM-DD
          .then(({ error: e }) => {
            if (e) console.warn('[update-transaction] sync slip_analytics ไม่สำเร็จ (ข้าม):', e.message);
            else console.log(`[update-transaction] sync slip_analytics slip_date=${oldRow[8]} → ${analyticsType}`);
          });
      }

      if ((typeChanged || dateChanged) && slipUrl && access.folderId) {
        const fileId = extractDriveFileId(slipUrl);
        if (fileId) {
          try {
            const newFolder = await resolveTypeFolder(access.accessToken, access.folderId, newDate, type);
            if (newFolder) {
              await moveDriveFile(access.accessToken, fileId, newFolder);
              console.log(`[update-transaction] ย้ายรูป ${fileId} → folder ${newFolder} (type: ${type}, date: ${newDate})`);
            }
          } catch (moveErr) {
            // ไม่ fail ถ้าย้ายไม่ได้ — ข้อมูล Sheets บันทึกไปแล้ว
            console.warn('[update-transaction] ย้ายรูป Drive ไม่สำเร็จ (ข้าม):', moveErr.message);
          }
        }
      }

      return res.status(200).json({ success: true, fileMoved: (typeChanged || dateChanged) && !!slipUrl });
    } catch (err) {
      console.error('[API/update-transaction PATCH]', err.response?.data || err.message);
      return res.status(500).json({ error: 'บันทึกไม่สำเร็จ กรุณาลองใหม่' });
    }
  }

  return res.status(405).end();
}
