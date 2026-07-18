/**
 * GET  /api/admin/invoices         — list all invoice requests
 * PATCH /api/admin/invoices        — issue / approve / reject
 *   action='issue'  → ออกใบกำกับภาษี + บันทึก Google Sheet + ส่งอีเมล
 *   action='approve'→ อนุมัติ (รอออกใบ)
 *   action='reject' → ปฏิเสธ
 */
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

function verifyAdmin(req) {
  const token = req.headers['x-admin-token'];
  if (!token) return false;
  try { return Buffer.from(token, 'base64').toString('utf8').startsWith('smileslip-admin:'); }
  catch { return false; }
}

async function genTaxInvoiceNo() {
  // atomic — กัน 2 แอดมินออกใบกำกับภาษีพร้อมกันได้เลขซ้ำ
  const { data, error } = await supabase.rpc('next_tax_invoice_no');
  if (error) throw error;
  return data;
}

async function getAdminSetting(key) {
  const { data } = await supabase
    .from('admin_settings')
    .select('value')
    .eq('key', key)
    .maybeSingle();
  return data?.value || null;
}

async function getAdminAccessToken() {
  const refreshToken = await getAdminSetting('admin_google_refresh_token');
  if (!refreshToken) return null;
  try {
    const r = await axios.post('https://oauth2.googleapis.com/token', {
      refresh_token:  refreshToken,
      client_id:      process.env.GOOGLE_CLIENT_ID,
      client_secret:  process.env.GOOGLE_CLIENT_SECRET,
      grant_type:     'refresh_token',
    });
    return r.data.access_token;
  } catch { return null; }
}

const PLAN_NAMES = { pro: 'Shop Pro', advance: 'Advance', business: 'Business', enterprise: 'Enterprise' };

async function recordToSheet(inv) {
  const sheetId = await getAdminSetting('admin_invoice_sheet_id');
  if (!sheetId) { console.log('[invoices] ยังไม่มี admin Google Sheet — ข้ามการบันทึก'); return; }

  const accessToken = await getAdminAccessToken();
  if (!accessToken) { console.log('[invoices] ไม่สามารถดึง admin access token — ข้ามการบันทึก'); return; }

  const issueDate = new Date(inv.approved_at || Date.now()).toLocaleDateString('th-TH');
  const planLabel = `${PLAN_NAMES[inv.plan_id] || inv.plan_id} / ${inv.is_yearly ? 'รายปี' : 'รายเดือน'}`;

  const row = [
    issueDate,
    inv.tax_invoice_no,
    inv.invoice_no || '',
    inv.buyer_name,
    inv.buyer_tax_id,
    inv.buyer_branch || 'สำนักงานใหญ่',
    planLabel,
    inv.is_yearly ? 'รายปี' : 'รายเดือน',
    inv.base_price,
    inv.vat_amount,
    inv.total_price,
    inv.wht_amount,
    inv.net_amount,
    inv.buyer_email || '',
    inv.buyer_phone || '',
  ];

  try {
    await axios.post(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/invoices!A:O:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      { values: [row] },
      { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
    );
    console.log('[invoices] บันทึก Google Sheet สำเร็จ:', inv.tax_invoice_no);
  } catch (err) {
    console.error('[invoices] บันทึก Google Sheet ล้มเหลว:', err.response?.data || err.message);
  }
}

async function sendEmail(inv, adminToken) {
  if (!inv.buyer_email) return;
  try {
    await axios.post(
      `${process.env.NEXT_PUBLIC_BASE_URL || process.env.FRONTEND_URL}/api/admin/send-email`,
      { inv },
      { headers: { 'Content-Type': 'application/json', 'x-admin-token': adminToken } }
    );
    console.log('[invoices] ส่งอีเมลสำเร็จ →', inv.buyer_email);
  } catch (err) {
    console.error('[invoices] ส่งอีเมลล้มเหลว:', err.response?.data || err.message);
  }
}

export default async function handler(req, res) {
  if (!verifyAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });

  // GET — list all invoice requests
  if (req.method === 'GET') {
    const { status } = req.query;
    let q = supabase
      .from('invoice_requests')
      .select('*')
      .order('created_at', { ascending: false });
    if (status && status !== 'all') q = q.eq('status', status);

    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ invoices: data || [] });
  }

  // PATCH — issue / approve / reject
  if (req.method === 'PATCH') {
    const { id, action } = req.body;
    if (!id || !action) return res.status(400).json({ error: 'ข้อมูลไม่ครบ' });

    if (action === 'issue') {
      const taxInvoiceNo = await genTaxInvoiceNo();
      const approvedAt = new Date().toISOString();

      const { error } = await supabase.from('invoice_requests').update({
        tax_invoice_no: taxInvoiceNo,
        status:         'issued',
        approved_at:    approvedAt,
      }).eq('id', id);
      if (error) return res.status(500).json({ error: error.message });

      // ดึง invoice ที่เพิ่ง update มา
      const { data: inv } = await supabase
        .from('invoice_requests')
        .select('*')
        .eq('id', id)
        .single();

      if (inv) {
        // บันทึก Google Sheet + ส่งอีเมล (non-blocking — ไม่ทำให้ response ล้มเหลว)
        const adminToken = req.headers['x-admin-token'];
        Promise.all([
          recordToSheet(inv),
          sendEmail(inv, adminToken),
        ]).catch(e => console.error('[invoices] post-issue error:', e.message));
      }

      return res.status(200).json({ success: true, taxInvoiceNo });
    }

    if (action === 'approve') {
      const { error } = await supabase.from('invoice_requests').update({
        status:      'approved',
        approved_at: new Date().toISOString(),
      }).eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ success: true });
    }

    if (action === 'reject') {
      const { error } = await supabase.from('invoice_requests').update({ status: 'rejected' }).eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'action ไม่ถูกต้อง' });
  }

  return res.status(405).end();
}
