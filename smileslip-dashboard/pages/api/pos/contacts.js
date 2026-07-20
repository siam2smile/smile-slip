/**
 * GET    /api/pos/contacts?shopId[&type=ลูกค้า|ผู้จำหน่าย|ทั้งคู่][&q=search]
 * POST   /api/pos/contacts { shopId, name, contact_type, phone, email, address_1, maps_1,
 *                            address_2, maps_2, company_name, tax_id, tax_address, tax_branch,
 *                            debt, cylinders, shop_name, aliases, notes }
 * PATCH  /api/pos/contacts { shopId, contact_id, ...fields }
 * DELETE /api/pos/contacts { shopId, contact_id }
 *
 * Schema 23 คอลัมน์ A-W (รวม ลูกค้า + ผู้จำหน่าย + ข้อมูลภาษีบริษัท + ประเภทบุคคล)
 * ข้อมูลเก็บใน Google Sheets tab "ผู้ติดต่อ" (PDPA compliant)
 */
import { createClient } from '@supabase/supabase-js';
import { blockIfTrialExpired } from '../../../lib/shop-access';
import {
  getAccessToken, readSheet, appendSheet, appendRows, updateSheetRow, ensureTabExists,
  makeContactId, rowToContact, CONTACT_HEADERS,
} from '../../../lib/google-pos';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

// บังคับให้ Google Sheets เก็บค่านี้เป็นข้อความล้วน ไม่แปลงเป็นตัวเลข/วันที่เองผ่าน
// valueInputOption=USER_ENTERED — เจอบั๊กจริงตอนนำเข้า VCF: เบอร์โทรที่ขึ้นต้นด้วย 0 โดนตัด 0
// ทิ้ง (ตีความเป็นตัวเลข) และบางแถวของวันที่กลายเป็นเลข serial ดิบแทนที่จะเป็นข้อความอ่านได้
function asText(v) {
  if (v === '' || v == null) return v;
  return `'${v}`;
}

async function getConfig(shopId) {
  const [{ data: pc }, { data: gc }] = await Promise.all([
    supabase.from('pos_configs').select('pos_sheet_id').eq('shop_id', shopId).single(),
    supabase.from('shop_google_configs').select('google_refresh_token').eq('shop_id', shopId).single(),
  ]);
  if (!pc?.pos_sheet_id) throw Object.assign(new Error('ยังไม่ได้ตั้งค่า POS'), { notSetup: true });
  if (!gc?.google_refresh_token) throw Object.assign(new Error('ยังไม่ได้เชื่อมต่อ Google'), { notConnected: true });
  return { sheetId: pc.pos_sheet_id, token: await getAccessToken(gc.google_refresh_token) };
}

export default async function handler(req, res) {
  const shopId = req.query.shopId || req.body?.shopId;
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });

  // เขียนไม่ได้ถ้าทดลองใช้ 30 วันหมดอายุแล้ว (อ่าน/GET ยังทำได้ปกติเสมอ)
  if (req.method !== 'GET' && (await blockIfTrialExpired(req, res, shopId))) return;


  try {
    const { sheetId, token } = await getConfig(shopId);
    await ensureTabExists(token, sheetId, 'ผู้ติดต่อ', CONTACT_HEADERS);

    // ── GET ──────────────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      const rows = await readSheet(token, sheetId, 'ผู้ติดต่อ!A:X');
      let contacts = rows.slice(1)
        .map((r, i) => ({ ...rowToContact(r), _row: i + 2 }))
        .filter(c => c.contact_id && c.name);

      // filter by type (ลูกค้า/ผู้จำหน่าย/ทั้งคู่)
      if (req.query.type) {
        const t = req.query.type;
        contacts = contacts.filter(c =>
          c.contact_type === t || c.contact_type === 'ทั้งคู่'
        );
      }

      // search
      if (req.query.q) {
        const q = req.query.q.toLowerCase();
        contacts = contacts.filter(c =>
          c.name.toLowerCase().includes(q) ||
          c.phone.includes(q) ||
          (c.email || '').toLowerCase().includes(q) ||
          (c.shop_name || '').toLowerCase().includes(q) ||
          (c.company_name || '').toLowerCase().includes(q) ||
          (c.tax_id || '').includes(q) ||
          (c.address_1 || '').toLowerCase().includes(q) ||
          (c.aliases || '').toLowerCase().includes(q)
        );
      }

      return res.json({ contacts });
    }

    // ── POST (bulk import — นำเข้า CSV/VCF จำนวนมากในคำขอเดียว) ──────────────
    // ต่างจากเพิ่มทีละคน: รับ shopId + contacts (array) แทน ยิง append เป็นก้อนใหญ่
    // ไม่ใช่ทีละแถว กัน rate limit ของ Google เวลานำเข้าเป็นพันรายชื่อ
    if (req.method === 'POST' && Array.isArray(req.body.contacts)) {
      const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
      const rows = req.body.contacts
        .filter(c => c?.name)
        .map(c => [
          makeContactId(), c.name, c.contact_type || 'ผู้จำหน่าย', asText(c.phone || ''), c.email || '',
          c.address_1 || '', c.maps_1 || '', c.address_2 || '', c.maps_2 || '',
          c.company_name || '', asText(c.tax_id || ''), c.tax_address || '', c.tax_branch || '',
          c.debt || 0, c.cylinders || 0, c.shop_name || '', c.aliases || '', c.notes || '', asText(now), asText(now),
          c.person_type || 'บุคคลธรรมดา', c.contact_person_name || '', asText(c.contact_person_phone || ''),
        ]);
      // ยิงเป็น chunk กัน request เดียวใหญ่เกินไป/timeout ฝั่ง Google
      const CHUNK = 500;
      for (let i = 0; i < rows.length; i += CHUNK) {
        await appendRows(token, sheetId, 'ผู้ติดต่อ', rows.slice(i, i + CHUNK));
      }
      return res.json({ ok: true, imported: rows.length });
    }

    // ── POST (เพิ่มทีละคน) ─────────────────────────────────────────────────
    if (req.method === 'POST') {
      const {
        name, contact_type = 'ผู้จำหน่าย',
        phone = '', email = '',
        address_1 = '', maps_1 = '', address_2 = '', maps_2 = '',
        company_name = '', tax_id = '', tax_address = '', tax_branch = '',
        debt = 0, cylinders = 0, shop_name = '',
        aliases = '', notes = '',
        person_type = 'บุคคลธรรมดา',
        contact_person_name = '', contact_person_phone = '',
        cylinder_limit = 0,
      } = req.body;
      if (!name) return res.status(400).json({ error: 'ต้องระบุชื่อ' });

      const contact_id = makeContactId();
      const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
      await appendSheet(token, sheetId, 'ผู้ติดต่อ', [
        contact_id, name, contact_type, asText(phone), email,
        address_1, maps_1, address_2, maps_2,
        company_name, asText(tax_id), tax_address, tax_branch,
        debt, cylinders, shop_name, aliases, notes, asText(now), asText(now),
        person_type, contact_person_name, asText(contact_person_phone), cylinder_limit || 0,
      ]);
      return res.json({ ok: true, contact_id, name });
    }

    // ── PATCH ────────────────────────────────────────────────────────────────
    if (req.method === 'PATCH') {
      const { contact_id, ...updates } = req.body;
      if (!contact_id) return res.status(400).json({ error: 'Missing contact_id' });

      const rows = await readSheet(token, sheetId, 'ผู้ติดต่อ!A:X');
      const dataRows = rows.slice(1);
      const idx = dataRows.findIndex(r => r[0] === contact_id);
      if (idx === -1) return res.status(404).json({ error: 'ไม่พบผู้ติดต่อ' });

      const existing = [...dataRows[idx]];
      while (existing.length < 24) existing.push('');

      if (updates.name                !== undefined) existing[1]  = updates.name;
      if (updates.contact_type        !== undefined) existing[2]  = updates.contact_type;
      if (updates.phone               !== undefined) existing[3]  = asText(updates.phone);
      if (updates.email               !== undefined) existing[4]  = updates.email;
      if (updates.address_1           !== undefined) existing[5]  = updates.address_1;
      if (updates.maps_1              !== undefined) existing[6]  = updates.maps_1;
      if (updates.address_2           !== undefined) existing[7]  = updates.address_2;
      if (updates.maps_2              !== undefined) existing[8]  = updates.maps_2;
      if (updates.company_name        !== undefined) existing[9]  = updates.company_name;
      if (updates.tax_id              !== undefined) existing[10] = asText(updates.tax_id);
      if (updates.tax_address         !== undefined) existing[11] = updates.tax_address;
      if (updates.tax_branch          !== undefined) existing[12] = updates.tax_branch;
      if (updates.debt                !== undefined) existing[13] = updates.debt;
      if (updates.cylinders           !== undefined) existing[14] = updates.cylinders;
      if (updates.shop_name           !== undefined) existing[15] = updates.shop_name;
      if (updates.aliases             !== undefined) existing[16] = updates.aliases;
      if (updates.notes               !== undefined) existing[17] = updates.notes;
      if (updates.person_type         !== undefined) existing[20] = updates.person_type;
      if (updates.contact_person_name !== undefined) existing[21] = updates.contact_person_name;
      if (updates.contact_person_phone!== undefined) existing[22] = asText(updates.contact_person_phone);
      if (updates.cylinder_limit      !== undefined) existing[23] = updates.cylinder_limit;
      existing[19] = asText(new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })); // updated_at

      await updateSheetRow(token, sheetId, 'ผู้ติดต่อ', idx + 2, existing);
      return res.json({ ok: true, contact_id });
    }

    // ── DELETE ────────────────────────────────────────────────────────────────
    if (req.method === 'DELETE') {
      const { contact_id } = req.body;
      if (!contact_id) return res.status(400).json({ error: 'Missing contact_id' });

      const rows = await readSheet(token, sheetId, 'ผู้ติดต่อ!A:X');
      const idx = rows.slice(1).findIndex(r => r[0] === contact_id);
      if (idx === -1) return res.status(404).json({ error: 'ไม่พบผู้ติดต่อ' });

      await updateSheetRow(token, sheetId, 'ผู้ติดต่อ', idx + 2, Array(24).fill(''));
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('[pos/contacts]', err.message);
    if (err.notSetup) return res.status(400).json({ error: err.message, notSetup: true });
    if (err.notConnected) return res.status(400).json({ error: err.message, notConnected: true });
    return res.status(500).json({ error: err.message });
  }
}
