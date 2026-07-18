/**
 * POST /api/voucher/save
 * สร้าง PDF ใบสำคัญรับ/จ่าย แล้วอัปโหลดลง Google Drive โฟลเดอร์ "ใบสำคัญจ่าย"
 * ใช้ axios + raw Google API (ไม่ใช้ googleapis npm package)
 */
import { createClient } from '@supabase/supabase-js';
import PDFDocument from 'pdfkit';
import path from 'path';
import axios from 'axios';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

function bahtText(amount) {
  const n = Math.abs(parseFloat(amount) || 0);
  const ones = ['','หนึ่ง','สอง','สาม','สี่','ห้า','หก','เจ็ด','แปด','เก้า'];
  const teens = ['สิบ','สิบเอ็ด','สิบสอง','สิบสาม','สิบสี่','สิบห้า','สิบหก','สิบเจ็ด','สิบแปด','สิบเก้า'];
  const tens  = ['','','ยี่สิบ','สามสิบ','สี่สิบ','ห้าสิบ','หกสิบ','เจ็ดสิบ','แปดสิบ','เก้าสิบ'];
  function b100(x) {
    if (x < 10) return ones[x];
    if (x < 20) return teens[x - 10];
    return tens[Math.floor(x/10)] + (x % 10 ? ones[x % 10] : '');
  }
  function b1000(x)   { return x < 100  ? b100(x)  : ones[Math.floor(x/100)]+'ร้อย'+(x%100?b100(x%100):''); }
  function b10k(x)    { return x < 1000 ? b1000(x) : b1000(Math.floor(x/1000))+'พัน'+(x%1000?b1000(x%1000):''); }
  function b100k(x)   { return x < 10000? b10k(x)  : b10k(Math.floor(x/10000))+'หมื่น'+(x%10000?b10k(x%10000):''); }
  function b1m(x)     { return x < 100000?b100k(x) : b100k(Math.floor(x/100000))+'แสน'+(x%100000?b100k(x%100000):''); }
  const intPart = Math.floor(n);
  const satang  = Math.round((n - intPart) * 100);
  let txt = intPart >= 1000000
    ? b1m(Math.floor(intPart/1000000))+'ล้าน'+(intPart%1000000?b1m(intPart%1000000):'')
    : b1m(intPart);
  txt += 'บาท';
  txt += satang > 0 ? b100(satang)+'สตางค์' : 'ถ้วน';
  return txt;
}

function buildPdfBuffer(params) {
  return new Promise((resolve, reject) => {
    const { type, amount, date, time, sender, receiver, note, category,
            shopName, shopAddress, branch, voucherNo } = params;

    const isExpense = type === 'รายจ่าย';
    const titleTh   = isExpense ? 'ใบสำคัญจ่าย' : 'ใบสำคัญรับ';
    const titleEn   = isExpense ? 'PAYMENT VOUCHER' : 'RECEIPT VOUCHER';
    const headerBg  = isExpense ? '#991b1b' : '#064e3b';
    const accentClr = isExpense ? '#fca5a5' : '#6ee7b7';
    const fmt = (n) => parseFloat(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 });

    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const fontR = path.join(process.cwd(), 'fonts', 'Sarabun-Regular.ttf');
    const fontB = path.join(process.cwd(), 'fonts', 'Sarabun-Bold.ttf');
    doc.registerFont('R', fontR).registerFont('B', fontB);

    const W = doc.page.width;

    doc.rect(0, 0, W, 72).fill(headerBg);
    doc.font('B').fontSize(20).fillColor('#fff').text(titleTh, 40, 14);
    doc.font('R').fontSize(10).fillColor(accentClr).text(titleEn, 40, 40);
    doc.font('B').fontSize(9).fillColor('#fff').text(`เลขที่: ${voucherNo}`, W - 200, 14, { width: 160, align: 'right' });
    doc.font('R').fontSize(9).fillColor(accentClr).text(`วันที่: ${date || ''}  ${time || ''}`, W - 200, 34, { width: 160, align: 'right' });

    let y = 90;
    doc.rect(40, y, W - 80, 48).fillAndStroke('#f8fafc', '#e2e8f0');
    doc.font('B').fontSize(11).fillColor('#1e293b').text(shopName || '', 52, y + 8, { width: W - 104 });
    doc.font('R').fontSize(8).fillColor('#64748b').text(shopAddress || '', 52, y + 26, { width: W - 104 });
    y += 60;

    let rowIdx = 0;
    const row = (label, value, color = '#1e293b') => {
      doc.rect(40, y, W - 80, 22).fill(rowIdx % 2 === 0 ? '#ffffff' : '#f8fafc');
      doc.font('R').fontSize(8).fillColor('#64748b').text(label, 52, y + 6, { width: 120 });
      doc.font('B').fontSize(9).fillColor(color).text(value || '-', 172, y + 6, { width: W - 230 });
      y += 22; rowIdx++;
    };

    doc.rect(40, y, W - 80, 22).fill('#1e293b');
    doc.font('B').fontSize(8).fillColor('#fff').text('รายละเอียดการ' + (isExpense ? 'จ่าย' : 'รับ'), 52, y + 6);
    y += 22;

    row(isExpense ? 'จ่ายให้' : 'รับจาก', isExpense ? (receiver || '-') : (sender || '-'));
    row(isExpense ? 'ผู้จ่ายเงิน' : 'ผู้รับเงิน', isExpense ? (sender || '-') : (receiver || '-'));
    row('จำนวนเงิน', `${fmt(amount)} บาท`, isExpense ? '#991b1b' : '#064e3b');
    row('จำนวนตัวอักษร', `(${bahtText(amount)})`);
    row('รายละเอียด', note || '-');
    if (category) row('หมวดหมู่', category);
    if (branch)   row('สาขา', branch);

    y += 16;
    const sigW = (W - 80 - 20) / 2;
    ['ผู้' + (isExpense ? 'จ่าย' : 'รับ') + 'เงิน', 'ผู้อนุมัติ'].forEach((label, i) => {
      const x = 40 + i * (sigW + 20);
      doc.rect(x, y, sigW, 70).fillAndStroke('#fafafa', '#e2e8f0');
      doc.font('B').fontSize(8).fillColor('#64748b').text(label, x, y + 8, { width: sigW, align: 'center' });
      doc.moveTo(x + 16, y + 44).lineTo(x + sigW - 16, y + 44).strokeColor('#94a3b8').lineWidth(0.5).stroke();
      doc.font('R').fontSize(7).fillColor('#94a3b8').text('ลายเซ็น / วันที่', x, y + 50, { width: sigW, align: 'center' });
    });
    y += 86;
    doc.moveTo(40, y).lineTo(W - 40, y).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
    doc.font('R').fontSize(7).fillColor('#94a3b8')
      .text('สร้างโดย Smile Slip Pro — เอกสารฉบับนี้ใช้เป็นหลักฐานทางบัญชีและภาษี', 40, y + 6, { align: 'center', width: W - 80 });

    doc.end();
  });
}

async function getAccessToken(refreshToken) {
  const res = await axios.post('https://oauth2.googleapis.com/token', {
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  return res.data.access_token;
}

// root folder ถูกลบไปแล้ว (404) → สร้างใหม่ + อัปเดต Supabase
async function recreateRootFolder(accessToken, shopId, shopName) {
  const createRes = await axios.post(
    'https://www.googleapis.com/drive/v3/files',
    { name: `SMILE SLIP - ${shopName}`, mimeType: 'application/vnd.google-apps.folder' },
    { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
  );
  const newFolderId = createRes.data.id;
  await supabase.from('shop_profiles').update({ google_folder_id: newFolderId }).eq('id', shopId);
  await supabase.from('shop_google_configs').update({ google_folder_id: newFolderId, updated_at: new Date().toISOString() }).eq('shop_id', shopId);
  return newFolderId;
}

async function findOrCreateFolder(accessToken, parentId, name) {
  const q = `'${parentId}' in parents and name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const listRes = await axios.get('https://www.googleapis.com/drive/v3/files', {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: { q, fields: 'files(id)', pageSize: 1 },
  });
  if (listRes.data.files.length > 0) return listRes.data.files[0].id;

  // สร้างโฟลเดอร์ใหม่
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

  const { shopId, type, amount, date, time, sender, receiver, note, category, branch } = req.body;
  if (!shopId) return res.status(400).json({ error: 'shopId required' });

  const [{ data: shop }, { data: gc }] = await Promise.all([
    supabase.from('shop_profiles').select('shop_name, address, google_folder_id').eq('id', shopId).single(),
    supabase.from('shop_google_configs').select('google_refresh_token').eq('shop_id', shopId).single(),
  ]);

  if (!shop) return res.status(404).json({ error: 'ไม่พบร้านค้า' });
  if (!gc?.google_refresh_token) return res.status(400).json({ error: 'ยังไม่ได้เชื่อมต่อ Google Drive กรุณาไปที่ตั้งค่า' });
  if (!shop.google_folder_id) return res.status(400).json({ error: 'ไม่พบโฟลเดอร์ Google Drive ของร้าน' });

  const isExpense  = type === 'รายจ่าย';
  const prefix     = isExpense ? 'PV' : 'RV';
  const folderName = isExpense ? 'ใบสำคัญจ่าย' : 'ใบสำคัญรับ';
  const ts         = new Date().toISOString().replace(/[-T:Z.]/g, '').slice(0, 14);
  const voucherNo  = `${prefix}-${ts}`;
  const fileName   = `${voucherNo}.pdf`;

  const pdfBuffer = await buildPdfBuffer({
    type, amount, date, time, sender, receiver, note, category, branch,
    shopName: shop.shop_name, shopAddress: shop.address || '', voucherNo,
  });

  const accessToken = await getAccessToken(gc.google_refresh_token);
  let rootFolderId = shop.google_folder_id;
  let voucherFolderId, uploaded;
  try {
    voucherFolderId = await findOrCreateFolder(accessToken, rootFolderId, folderName);
    uploaded = await uploadPdf(accessToken, voucherFolderId, fileName, pdfBuffer);
  } catch (err) {
    if (err.response?.status === 404) {
      // root folder ถูกลบไปแล้ว — สร้างใหม่แล้วลองอีกครั้ง
      rootFolderId = await recreateRootFolder(accessToken, shopId, shop.shop_name);
      voucherFolderId = await findOrCreateFolder(accessToken, rootFolderId, folderName);
      uploaded = await uploadPdf(accessToken, voucherFolderId, fileName, pdfBuffer);
    } else {
      throw err;
    }
  }

  const fileId      = uploaded.id;
  const viewUrl     = uploaded.webViewLink;
  const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;

  return res.status(200).json({ ok: true, voucherNo, fileId, viewUrl, downloadUrl, fileName });
}
