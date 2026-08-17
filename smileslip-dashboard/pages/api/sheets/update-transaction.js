/**
 * GET   /api/sheets/update-transaction?shopId=xxx&year=2026&ref=xxx  → ดึงธุรกรรม 1 รายการเพื่อแก้ไข
 * PATCH /api/sheets/update-transaction                                → บันทึกการแก้ไข
 *   body: { shopId, year, ref, date, time, type, amount, sender, receiver, note }
 *
 * Phase 3 Tier 5.5 — ย้ายจากหาแถวใน Google Sheets column K (เลขอ้างอิง/Hash) มาหาจาก
 * ledger_transactions (Supabase) ด้วย shop_id + slip_hash (= ref) โดยตรง — บอทเขียนคู่เข้า
 * ตารางนี้เป็น required เสมอมาตั้งแต่ Phase 3 Tier 5 (ไม่ขึ้นกับ Google เชื่อมต่อหรือไม่แล้ว)
 * ต่างจาก Sheets ที่ยังต้องเชื่อมต่อ Google ก่อนถึงจะแก้ไขได้ — endpoint นี้ทำงานได้แม้ร้านไม่เคย
 * เชื่อมต่อ Google เลยก็ตาม (การย้ายรูปใน Drive ยังต้องใช้ Google อยู่ แต่เป็นแค่ส่วนเสริม
 * ไม่ block การแก้ไขข้อมูลหลัก) — year ยังรับ/คืนค่าไว้เพื่อความเข้ากันได้กับหน้าเว็บเดิม แต่ไม่ได้
 * ใช้ค้นหาอะไรอีกต่อไป (ledger_transactions ไม่มีแนวคิดแยกตามปีแบบ Sheets tab)
 */
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import { requireOwnerAuth } from '../../../lib/owner-auth';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

// จัดรูปแบบวันที่-เวลาเป็นเขตเวลากรุงเทพด้วย timeZone ชัดเจนเสมอ (Intl.DateTimeFormat) — ตั้งใจ
// "ไม่" ใช้วิธี new Date(x.getTime() + 7*3600*1000) แล้ว toLocaleDateString('th-TH') แบบไม่ระบุ
// timeZone เหมือน getThaiDateTime() ของบอท เพราะพิสูจน์แล้วจริงว่าพัง (double-shift) ถ้าเครื่อง/
// container ที่รันตั้ง timezone ไม่ใช่ UTC (เจอจริงตอนทดสอบบนเครื่อง dev ที่ระบบตั้งเป็น
// Asia/Bangkok เอง — ผลลัพธ์เพี้ยนไปข้างหน้า 7 ชม. เพราะ Intl เติม offset ซ้ำสอง) — ระบุ
// timeZone ตรงๆ ทำให้ถูกต้องเสมอไม่ว่าเครื่องที่รันจะตั้ง timezone อะไรก็ตาม
function formatThaiDate(date) {
  return date.toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' });
}
function formatThaiTime(date) {
  return date.toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false });
}
function formatIsoDate(date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const y = parts.find(p => p.type === 'year').value;
  const m = parts.find(p => p.type === 'month').value;
  const d = parts.find(p => p.type === 'day').value;
  return `${y}-${m}-${d}`;
}

// แปลงสตริงวันที่/เวลาไทย (D/M/พ.ศ., H:mm) → UTC ISO timestamp — เหมือน parseTransactionAt()
// ของบอทเป๊ะ (lib/ledger-google.js) กันวันที่เพี้ยนถ้า OCR/ผู้ใช้กรอกปีผิด
function parseThaiDateTimeToUTC(dateStr, timeStr) {
  try {
    const parts = (dateStr || '').split('/');
    if (parts.length === 3) {
      let [d, m, y] = parts.map(p => parseInt(p.trim(), 10));
      if (y > 2500) y -= 543;
      if (y < 100) y += 2000;
      const currentYear = new Date(new Date().getTime() + 7 * 60 * 60 * 1000).getFullYear();
      if (y < currentYear - 1 || y > currentYear + 1) y = currentYear;
      const [hh, mm, ss] = (timeStr || '00:00:00').split(':').map(p => parseInt(p, 10) || 0);
      if (d && m && y) {
        const dt = new Date(Date.UTC(y, m - 1, d, (hh || 0) - 7, mm || 0, ss || 0));
        if (!isNaN(dt.getTime())) return dt.toISOString();
      }
    }
  } catch { /* ignore — fallback ด้านล่าง */ }
  return null; // null = ไม่แก้ transaction_at (เก็บค่าเดิมไว้)
}

// ดึงสิทธิ์เข้าถึง Google Drive ของร้าน — ใช้แค่สำหรับย้ายไฟล์รูปสลิปเมื่อ type/date เปลี่ยน
// (optional เสมอ ไม่ block การแก้ไขข้อมูลหลักถ้าร้านไม่ได้เชื่อมต่อ Google)
async function getGoogleDriveAccess(shopId) {
  const { data: gConfig } = await supabase
    .from('shop_google_configs')
    .select('google_refresh_token, google_folder_id')
    .eq('shop_id', shopId)
    .maybeSingle();
  if (!gConfig?.google_refresh_token || !gConfig?.google_folder_id) return null;

  try {
    const tokenRes = await axios.post('https://oauth2.googleapis.com/token', {
      refresh_token: gConfig.google_refresh_token,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
    });
    return { accessToken: tokenRes.data.access_token, folderId: gConfig.google_folder_id };
  } catch (e) {
    console.warn('[update-transaction] ขอ Google access token ไม่สำเร็จ (ข้าม การย้ายรูปจะไม่ทำ):', e.message);
    return null;
  }
}

// แปลง DD/MM/YYYY (พ.ศ. หรือ ค.ศ.) → { year, monthFolder }
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

// แปลงแถว ledger_transactions → shape เดียวกับที่หน้าเว็บ (pages/transaction/edit.js) คาดหวัง
// (เหมือนเดิมทุก field ให้ frontend ไม่ต้องแก้เลย)
function rowToTransactionShape(row) {
  const createdAt = new Date(row.created_at);
  const txAt = row.transaction_at ? new Date(row.transaction_at) : createdAt;
  return {
    date: formatThaiDate(txAt),
    time: formatThaiTime(txAt),
    type: row.type === 'income' ? 'รายรับ' : 'รายจ่าย',
    amount: row.amount,
    sender: row.sender_name || '-',
    receiver: row.receiver_name || '-',
    note: row.note || '-',
    slipUrl: row.slip_url || '',
    recordedAt: formatIsoDate(createdAt),
    branch: row.branch_name || '-',
    ref: row.slip_hash || '',
    taxId: row.tax_id || '-',
    taxpayerName: row.taxpayer_name || '-',
    taxAmount: row.tax_amount != null ? String(row.tax_amount) : '-',
    category: row.category || '-',
  };
}

export default async function handler(req, res) {
  // ─── GET ───
  if (req.method === 'GET') {
    const { shopId, ref } = req.query;
    if (!shopId || !ref) return res.status(400).json({ error: 'ข้อมูลไม่ครบ (shopId, ref)' });
    if (!requireOwnerAuth(req, res, shopId, { enforce: true })) return;

    try {
      const { data: row, error } = await supabase
        .from('ledger_transactions')
        .select('*')
        .eq('shop_id', shopId)
        .eq('slip_hash', ref)
        .maybeSingle();
      if (error) throw error;
      if (!row) return res.status(404).json({ error: 'ไม่พบรายการนี้ (อาจถูกลบไปแล้ว)' });

      return res.status(200).json({
        transaction: rowToTransactionShape(row),
        year: req.query.year || String(new Date().getFullYear()),
      });
    } catch (err) {
      console.error('[API/update-transaction GET]', err.response?.data || err.message);
      return res.status(500).json({ error: 'โหลดข้อมูลไม่สำเร็จ' });
    }
  }

  // ─── PATCH ───
  if (req.method === 'PATCH') {
    const { shopId, ref, date, time, type, amount, sender, receiver, note, category, learnKeyword, taxId, taxpayerName, taxAmount } = req.body;
    if (!shopId || !ref) return res.status(400).json({ error: 'ข้อมูลไม่ครบ (shopId, ref)' });
    if (type !== 'รายรับ' && type !== 'รายจ่าย') return res.status(400).json({ error: 'ประเภทต้องเป็น รายรับ หรือ รายจ่าย' });
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum < 0) return res.status(400).json({ error: 'จำนวนเงินไม่ถูกต้อง' });
    const taxAmountNum = taxAmount !== undefined && taxAmount !== '' ? (parseFloat(taxAmount) || 0) : null;
    if (!requireOwnerAuth(req, res, shopId, { enforce: true })) return;

    try {
      const { data: oldRow, error: findErr } = await supabase
        .from('ledger_transactions')
        .select('*')
        .eq('shop_id', shopId)
        .eq('slip_hash', ref)
        .maybeSingle();
      if (findErr) throw findErr;
      if (!oldRow) return res.status(404).json({ error: 'ไม่พบรายการนี้ (อาจถูกลบไปแล้ว)' });

      const oldTypeLabel = oldRow.type === 'income' ? 'รายรับ' : 'รายจ่าย';
      const oldTxAt = oldRow.transaction_at ? new Date(oldRow.transaction_at) : new Date(oldRow.created_at);
      const oldDate = formatThaiDate(oldTxAt);
      const slipUrl = oldRow.slip_url || '';

      const newType = type === 'รายจ่าย' ? 'expense' : 'income';
      const newDate = date || oldDate;
      const newTransactionAt = parseThaiDateTimeToUTC(newDate, time) || oldRow.transaction_at;

      const updatePayload = {
        type: newType,
        amount: amountNum,
        sender_name: sender || '-',
        receiver_name: receiver || '-',
        note: note || '-',
        transaction_at: newTransactionAt,
      };
      if (taxId !== undefined) updatePayload.tax_id = (taxId && taxId !== '-') ? taxId : null;
      if (taxpayerName !== undefined) updatePayload.taxpayer_name = (taxpayerName && taxpayerName !== '-') ? taxpayerName : null;
      if (taxAmountNum !== null) updatePayload.tax_amount = taxAmountNum;
      if (category && category !== '-') updatePayload.category = category;

      const { error: updErr } = await supabase
        .from('ledger_transactions')
        .update(updatePayload)
        .eq('id', oldRow.id);
      if (updErr) throw updErr;

      // บันทึก learned rule ถ้า user กรอก keyword (ไม่เกี่ยวกับ Sheets/Supabase — เหมือนเดิม)
      if (category && category !== '-' && learnKeyword && learnKeyword.trim().length >= 2) {
        await supabase.from('shop_category_rules').upsert(
          { shop_id: shopId, keyword: learnKeyword.trim().toLowerCase(), category },
          { onConflict: 'shop_id,keyword' }
        ).then(({ error: e }) => {
          if (e) console.warn('[update-transaction] บันทึก category rule ไม่สำเร็จ:', e.message);
        });
      }

      // ─── sync slip_analytics.transaction_type ใน Supabase ถ้า type เปลี่ยน ───
      const typeChanged = type !== oldTypeLabel;
      const dateChanged = newDate !== oldDate;
      const oldRecordedAt = formatIsoDate(new Date(oldRow.created_at));

      if (typeChanged && oldRecordedAt) {
        const analyticsType = newType;
        supabase.from('slip_analytics')
          .update({ transaction_type: analyticsType })
          .eq('shop_id', shopId)
          .eq('slip_date', oldRecordedAt)
          .then(({ error: e }) => {
            if (e) console.warn('[update-transaction] sync slip_analytics ไม่สำเร็จ (ข้าม):', e.message);
            else console.log(`[update-transaction] sync slip_analytics slip_date=${oldRecordedAt} → ${analyticsType}`);
          });
      }

      // ย้ายรูปใน Drive ถ้า type/วันที่เปลี่ยน — optional เสมอ ไม่ block การบันทึกหลัก
      let fileMoved = false;
      if ((typeChanged || dateChanged) && slipUrl) {
        const fileId = extractDriveFileId(slipUrl);
        if (fileId) {
          const access = await getGoogleDriveAccess(shopId);
          if (access) {
            try {
              const newFolder = await resolveTypeFolder(access.accessToken, access.folderId, newDate, type);
              if (newFolder) {
                await moveDriveFile(access.accessToken, fileId, newFolder);
                fileMoved = true;
                console.log(`[update-transaction] ย้ายรูป ${fileId} → folder ${newFolder} (type: ${type}, date: ${newDate})`);
              }
            } catch (moveErr) {
              // ไม่ fail ถ้าย้ายไม่ได้ — ข้อมูลหลักบันทึกไปแล้ว
              console.warn('[update-transaction] ย้ายรูป Drive ไม่สำเร็จ (ข้าม):', moveErr.message);
            }
          }
        }
      }

      return res.status(200).json({ success: true, fileMoved });
    } catch (err) {
      console.error('[API/update-transaction PATCH]', err.response?.data || err.message);
      return res.status(500).json({ error: 'บันทึกไม่สำเร็จ กรุณาลองใหม่' });
    }
  }

  return res.status(405).end();
}
