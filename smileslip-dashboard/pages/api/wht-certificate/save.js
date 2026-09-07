/**
 * POST /api/wht-certificate/save
 * body: { shopId, ref, direction, incomeTypeCode, incomeTypeOther, baseAmount, whtAmount, docDate,
 *         payer:{name,address,taxId}, payee:{name,address,taxId} }
 *
 * ยืนยันตัวตนแล้ว "ล็อกเลขที่" ของหนังสือรับรองหัก ณ ที่จ่ายให้กับธุรกรรมนี้ (ledger_transactions,
 * ระบุด้วย shop_id+slip_hash=ref เหมือน update-transaction.js) — เรียกซ้ำกี่ครั้งก็ได้เลขเดิมเสมอ
 * (idempotent) เพราะเลขที่ต้องคงที่ตลอดไปหลังออกครั้งแรกแล้ว — แยกชุดเลขกันตามทิศทาง:
 *   we_withhold (เราออกจริง)  → WHT-{ปี พ.ศ.}-{ลำดับ 5 หลัก}
 *   they_withhold (ร่างให้คู่ค้า) → DFT-{ปี พ.ศ.}-{ลำดับ 5 หลัก} (แค่ reference กันสับสน ไม่ใช่เลขทางการ)
 *
 * ไม่แก้ tax_id/taxpayer_name/tax_address ของธุรกรรมเลย — ข้อมูล payer/payee ที่ปรับในฟอร์มนี้ใช้
 * เฉพาะพิมพ์เอกสารฉบับนี้เท่านั้น (แก้ข้อมูลธุรกรรมจริงให้ใช้ปุ่ม "บันทึกการแก้ไข" หลักแทน)
 *
 * อัปโหลดสำเนาเข้า Google Drive แบบ best-effort เสมอ (ไม่ block ถ้าร้านยังไม่เชื่อมต่อ/ล้มเหลว —
 * ต่างจาก voucher/save.js ที่บังคับต้องเชื่อมต่อ Google ก่อน เพราะเอกสารนี้เป็นเอกสารที่กฎหมาย
 * บังคับให้ต้องออกได้ทันทีไม่ว่าจะเชื่อมต่อ Google ไว้หรือไม่)
 */
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import { requireOwnerAuth } from '../../../lib/owner-auth';
import { generateWhtCertificatePdf, incomeTypeDisplayLabel } from '../../../lib/wht-certificate-pdf';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

async function getAccessToken(refreshToken) {
  const res = await axios.post('https://oauth2.googleapis.com/token', {
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  return res.data.access_token;
}

async function findOrCreateFolder(accessToken, parentId, name) {
  const q = `'${parentId}' in parents and name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const listRes = await axios.get('https://www.googleapis.com/drive/v3/files', {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: { q, fields: 'files(id)', pageSize: 1 },
  });
  if (listRes.data.files.length > 0) return listRes.data.files[0].id;
  const createRes = await axios.post(
    'https://www.googleapis.com/drive/v3/files',
    { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
    { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
  );
  return createRes.data.id;
}

async function uploadPdf(accessToken, folderId, fileName, pdfBuffer) {
  const boundary = 'smile_slip_boundary';
  const metadata = JSON.stringify({ name: fileName, mimeType: 'application/pdf', parents: [folderId] });
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
      `--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`
    ),
    pdfBuffer,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const res = await axios.post(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
    body,
    { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': `multipart/related; boundary=${boundary}` } }
  );
  return res.data;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const {
    shopId, ref, direction, incomeTypeCode, incomeTypeOther,
    baseAmount, whtAmount, docDate, payer, payee,
  } = req.body || {};

  if (!shopId || !ref) return res.status(400).json({ error: 'ข้อมูลไม่ครบ (shopId, ref)' });
  if (direction !== 'we_withhold' && direction !== 'they_withhold') return res.status(400).json({ error: 'direction ไม่ถูกต้อง' });
  const baseAmountNum = parseFloat(baseAmount) || 0;
  const whtAmountNum = parseFloat(whtAmount) || 0;
  if (whtAmountNum <= 0) return res.status(400).json({ error: 'ยอดภาษีที่หักไว้ต้องมากกว่า 0' });
  if (!requireOwnerAuth(req, res, shopId, { enforce: true })) return;

  try {
    // ใช้แค่ id เป็น required lookup (คอลัมน์นี้มีอยู่แน่นอนเสมอ) — แยกดึง wht_cert_no/
    // wht_income_type ต่างหากด้านล่างเป็น optional เพราะยังไม่มีอยู่จริงจนกว่าจะรัน SQL migration
    // (เดิม select รวมกันเส้นเดียวแล้ว throw ถ้า error ทำให้ endpoint นี้ 500 ทั้งก้อนถ้ายังไม่ได้รัน
    // SQL — ขัดกับเจตนา defensive ที่ตั้งใจไว้ พบจากการทดสอบยิงจริงก่อนรัน SQL)
    const { data: row, error: findErr } = await supabase
      .from('ledger_transactions')
      .select('id')
      .eq('shop_id', shopId)
      .eq('slip_hash', ref)
      .maybeSingle();
    if (findErr) throw findErr;
    if (!row) return res.status(404).json({ error: 'ไม่พบรายการนี้ (อาจถูกลบไปแล้ว)' });

    let existingCertNo = null;
    try {
      const { data: certRow } = await supabase
        .from('ledger_transactions')
        .select('wht_cert_no')
        .eq('id', row.id)
        .maybeSingle();
      existingCertNo = certRow?.wht_cert_no || null;
    } catch { /* คอลัมน์ยังไม่มี — ถือว่ายังไม่เคยออกเลขที่ */ }

    const whtIncomeType = incomeTypeDisplayLabel(incomeTypeCode, incomeTypeOther);
    let certNo = existingCertNo;

    if (!certNo) {
      const prefix = direction === 'we_withhold' ? 'WHT' : 'DFT';
      // คำนวณปี พ.ศ. เองจากปี ค.ศ.+543 เสมอ — ห้ามใช้ toLocaleDateString('th-TH',{year:'numeric'})
      // ตรงๆ เพราะคืนสตริงเต็มแบบ "พ.ศ. 2569" (มีคำนำหน้าปน) ไม่ใช่แค่ตัวเลข — บั๊กเดิมที่เคยเจอ
      // และแก้แล้วในเลขที่ใบกำกับภาษี POS (ดู CLAUDE.md item 22) พลาดเกิดซ้ำที่นี่ระหว่างทดสอบ
      const gregorianYear = parseInt(
        new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric' }).format(new Date()),
        10
      );
      const beYear = String(gregorianYear + 543);
      const { count } = await supabase
        .from('ledger_transactions')
        .select('id', { count: 'exact', head: true })
        .eq('shop_id', shopId)
        .ilike('wht_cert_no', `${prefix}-${beYear}-%`);
      certNo = `${prefix}-${beYear}-${String((count || 0) + 1).padStart(5, '0')}`;

      const { error: updErr } = await supabase
        .from('ledger_transactions')
        .update({ wht_cert_no: certNo, wht_income_type: whtIncomeType })
        .eq('id', row.id);
      // เขียนแบบ defensive — ถ้าคอลัมน์ยังไม่มี (ยังไม่รัน SQL migration) ให้ log เตือนแต่ไม่ throw
      // เพราะ certNo ยังใช้พิมพ์เอกสารฉบับนี้ได้ปกติ แค่ครั้งหน้าจะได้เลขใหม่แทนที่จะเป็นเลขเดิม
      if (updErr) console.warn(`[wht-certificate/save] บันทึกเลขที่ไม่สำเร็จ (คอลัมน์อาจยังไม่ถูกสร้าง — รอรัน SQL): ${updErr.message}`);
    }

    const pdfBuffer = await generateWhtCertificatePdf({
      certNo,
      isDraft: direction === 'they_withhold',
      docDate,
      payer, payee,
      incomeTypeCode: incomeTypeCode || '5',
      incomeTypeOther,
      baseAmount: baseAmountNum,
      whtAmount: whtAmountNum,
      isWhiteLabel: false, // white-label เช็คแยกฝั่ง preview.js ที่ frontend ใช้แสดง/ดาวน์โหลดจริง
    });

    // อัปโหลดสำเนาเข้า Google Drive — best-effort ล้วนๆ ไม่ block response แม้ล้มเหลว/ไม่เชื่อมต่อ
    let driveViewUrl = null, driveDownloadUrl = null;
    try {
      const [{ data: shop }, { data: gc }] = await Promise.all([
        supabase.from('shop_profiles').select('shop_name, google_folder_id').eq('id', shopId).single(),
        supabase.from('shop_google_configs').select('google_refresh_token, google_folder_id').eq('shop_id', shopId).maybeSingle(),
      ]);
      const rootFolderId = gc?.google_folder_id || shop?.google_folder_id;
      if (gc?.google_refresh_token && rootFolderId) {
        const accessToken = await getAccessToken(gc.google_refresh_token);
        const certFolderId = await findOrCreateFolder(accessToken, rootFolderId, 'หนังสือรับรองหัก ณ ที่จ่าย');
        const uploaded = await uploadPdf(accessToken, certFolderId, `${certNo}.pdf`, pdfBuffer);
        driveViewUrl = uploaded.webViewLink;
        driveDownloadUrl = `https://drive.google.com/uc?export=download&id=${uploaded.id}`;
      }
    } catch (driveErr) {
      console.warn('[wht-certificate/save] อัปโหลด Google Drive ไม่สำเร็จ (ข้าม):', driveErr.message);
    }

    return res.status(200).json({ ok: true, certNo, whtIncomeType, driveViewUrl, driveDownloadUrl });
  } catch (err) {
    console.error('[wht-certificate/save]', err.response?.data || err.message);
    return res.status(500).json({ error: 'บันทึกไม่สำเร็จ กรุณาลองใหม่' });
  }
}
