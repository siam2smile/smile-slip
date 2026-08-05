/**
 * GET    /api/pos/contacts?shopId[&type=ลูกค้า|ผู้จำหน่าย|ทั้งคู่][&q=search]
 * POST   /api/pos/contacts { shopId, name, contact_type, phone, email, address_1, maps_1,
 *                            address_2, maps_2, company_name, tax_id, tax_address, tax_branch,
 *                            debt, cylinders, shop_name, aliases, notes }
 * PATCH  /api/pos/contacts { shopId, contact_id, ...fields }
 * DELETE /api/pos/contacts { shopId, contact_id }
 *
 * Phase 2 (write-primary flip, 2026-07-29): อ่าน/เขียนจาก Supabase (pos_contacts) โดยตรงแล้ว
 * ไม่ผ่าน Google Sheets/Google connection อีกต่อไป — ผู้ติดต่อเก่าที่มีอยู่ก่อนหน้านี้ (ไม่เคย
 * backfill ตามธรรมเนียม migration นี้ทั้งหมด ตัดสินใจไว้ตั้งแต่ Tier C ข้อ 2) จะไม่ปรากฏใน GET
 * อีกต่อไป — ผู้ใช้ยืนยันแล้วว่ารับได้ (ยังทดสอบระบบอยู่ ข้อมูลจริงยังอยู่ครบใน Sheets เสมอ)
 */
import { supabase } from '../../../lib/supabase-pos';
import { blockIfTrialExpired } from '../../../lib/shop-access';
import { requirePermission } from '../../../lib/pos-auth';
import { makeContactId, contactFromRow } from '../../../lib/google-pos';

export default async function handler(req, res) {
  const shopId = req.query.shopId || req.body?.shopId;
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });

  // เขียนไม่ได้ถ้าทดลองใช้ 30 วันหมดอายุแล้ว (อ่าน/GET ยังทำได้ปกติเสมอ)
  if (req.method !== 'GET' && (await blockIfTrialExpired(req, res, shopId))) return;

  try {
    // ── GET ──────────────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      // Supabase/PostgREST คืนสูงสุด 1,000 แถวต่อ query เสมอไม่ว่าจะขอกี่แถวก็ตาม (default
      // db-max-rows) — ถ้าไม่ paginate เอง ร้านที่มีผู้ติดต่อเกิน 1,000 คน (พบจริงกับร้าน D Gas
      // ที่มี 2,000+ คน) จะเห็นรายชื่อไม่ครบเงียบๆ โดยไม่มี error ให้เห็นเลย — วนอ่านทีละ 1,000
      // แถวจนครบ
      const PAGE = 1000;
      let data = [];
      for (let from = 0; ; from += PAGE) {
        const { data: page, error } = await supabase.from('pos_contacts').select('*')
          .eq('shop_id', shopId).is('deleted_at', null).order('created_at', { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        data = data.concat(page || []);
        if (!page || page.length < PAGE) break;
      }
      let contacts = data.map(contactFromRow).filter(c => c.contact_id && c.name);

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
    if (req.method === 'POST' && Array.isArray(req.body.contacts)) {
      const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
      const validContacts = req.body.contacts.filter(c => c?.name);
      const supaRows = validContacts.map(c => ({
        shop_id: shopId, contact_id: makeContactId(), name: c.name, contact_type: c.contact_type || 'ผู้จำหน่าย',
        phone: c.phone || '', email: c.email || '', address_1: c.address_1 || '', maps_1: c.maps_1 || '',
        address_2: c.address_2 || '', maps_2: c.maps_2 || '', company_name: c.company_name || '',
        tax_id: c.tax_id || '', tax_address: c.tax_address || '', tax_branch: c.tax_branch || '',
        debt: c.debt || 0, cylinders: c.cylinders || 0, shop_name: c.shop_name || '', aliases: c.aliases || '',
        notes: c.notes || '', contact_created_at: now, contact_updated_at: now,
        person_type: c.person_type || 'บุคคลธรรมดา', contact_person_name: c.contact_person_name || '',
        contact_person_phone: c.contact_person_phone || '',
      }));

      const CHUNK = 500;
      for (let i = 0; i < supaRows.length; i += CHUNK) {
        const { error } = await supabase.from('pos_contacts').insert(supaRows.slice(i, i + CHUNK));
        if (error) throw error;
      }
      return res.json({ ok: true, imported: supaRows.length });
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
      if (parseFloat(debt) < 0) return res.status(400).json({ error: 'ยอดค้างชำระต้องไม่ติดลบ' });
      if (parseFloat(cylinders) < 0) return res.status(400).json({ error: 'จำนวนถังต้องไม่ติดลบ' });

      const contact_id = makeContactId();
      const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
      const { error } = await supabase.from('pos_contacts').insert({
        shop_id: shopId, contact_id, name, contact_type, phone, email,
        address_1, maps_1, address_2, maps_2, company_name, tax_id, tax_address, tax_branch,
        debt, cylinders, shop_name, aliases, notes, contact_created_at: now, contact_updated_at: now,
        person_type, contact_person_name, contact_person_phone, cylinder_limit: cylinder_limit || 0,
      });
      if (error) throw error;
      return res.json({ ok: true, contact_id, name });
    }

    // ── PATCH ────────────────────────────────────────────────────────────────
    if (req.method === 'PATCH') {
      if (!(await requirePermission(req, res, shopId, 'perm_manage_customers'))) return;

      const { contact_id, ...updates } = req.body;
      if (!contact_id) return res.status(400).json({ error: 'Missing contact_id' });
      if (updates.debt !== undefined && parseFloat(updates.debt) < 0) {
        return res.status(400).json({ error: 'ยอดค้างชำระต้องไม่ติดลบ' });
      }
      if (updates.cylinders !== undefined && parseFloat(updates.cylinders) < 0) {
        return res.status(400).json({ error: 'จำนวนถังต้องไม่ติดลบ' });
      }

      const { data: existing, error: fetchErr } = await supabase.from('pos_contacts').select('contact_id')
        .eq('shop_id', shopId).eq('contact_id', contact_id).is('deleted_at', null).maybeSingle();
      if (fetchErr) throw fetchErr;
      if (!existing) return res.status(404).json({ error: 'ไม่พบผู้ติดต่อ' });

      const updatedAt = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
      const supaUpdates = { contact_updated_at: updatedAt };
      if (updates.name                 !== undefined) supaUpdates.name = updates.name;
      if (updates.contact_type         !== undefined) supaUpdates.contact_type = updates.contact_type;
      if (updates.phone                !== undefined) supaUpdates.phone = updates.phone;
      if (updates.email                !== undefined) supaUpdates.email = updates.email;
      if (updates.address_1            !== undefined) supaUpdates.address_1 = updates.address_1;
      if (updates.maps_1               !== undefined) supaUpdates.maps_1 = updates.maps_1;
      if (updates.address_2            !== undefined) supaUpdates.address_2 = updates.address_2;
      if (updates.maps_2               !== undefined) supaUpdates.maps_2 = updates.maps_2;
      if (updates.company_name         !== undefined) supaUpdates.company_name = updates.company_name;
      if (updates.tax_id               !== undefined) supaUpdates.tax_id = updates.tax_id;
      if (updates.tax_address          !== undefined) supaUpdates.tax_address = updates.tax_address;
      if (updates.tax_branch           !== undefined) supaUpdates.tax_branch = updates.tax_branch;
      if (updates.debt                 !== undefined) supaUpdates.debt = updates.debt;
      if (updates.cylinders            !== undefined) supaUpdates.cylinders = updates.cylinders;
      if (updates.shop_name            !== undefined) supaUpdates.shop_name = updates.shop_name;
      if (updates.aliases              !== undefined) supaUpdates.aliases = updates.aliases;
      if (updates.notes                !== undefined) supaUpdates.notes = updates.notes;
      if (updates.person_type          !== undefined) supaUpdates.person_type = updates.person_type;
      if (updates.contact_person_name  !== undefined) supaUpdates.contact_person_name = updates.contact_person_name;
      if (updates.contact_person_phone !== undefined) supaUpdates.contact_person_phone = updates.contact_person_phone;
      if (updates.cylinder_limit       !== undefined) supaUpdates.cylinder_limit = updates.cylinder_limit;

      const { error } = await supabase.from('pos_contacts').update(supaUpdates)
        .eq('shop_id', shopId).eq('contact_id', contact_id);
      if (error) throw error;
      return res.json({ ok: true, contact_id });
    }

    // ── DELETE (ทีละคน หรือหลายคนพร้อมกันผ่าน contact_ids — เครื่องมือเช็ครายการซ้ำ/
    // ไม่มีความเคลื่อนไหวในหน้าผู้ติดต่อ) ────────────────────────────────────────
    if (req.method === 'DELETE' && Array.isArray(req.body.contact_ids)) {
      if (!(await requirePermission(req, res, shopId, 'perm_manage_customers'))) return;

      const ids = req.body.contact_ids.filter(Boolean);
      if (!ids.length) return res.status(400).json({ error: 'Missing contact_ids' });

      const { error, count } = await supabase.from('pos_contacts')
        .update({ deleted_at: new Date().toISOString() })
        .eq('shop_id', shopId).in('contact_id', ids).is('deleted_at', null)
        .select('contact_id', { count: 'exact' });
      if (error) throw error;
      return res.json({ ok: true, deleted: count ?? ids.length });
    }

    if (req.method === 'DELETE') {
      if (!(await requirePermission(req, res, shopId, 'perm_manage_customers'))) return;

      const { contact_id } = req.body;
      if (!contact_id) return res.status(400).json({ error: 'Missing contact_id' });

      const { data: existing, error: fetchErr } = await supabase.from('pos_contacts').select('contact_id')
        .eq('shop_id', shopId).eq('contact_id', contact_id).is('deleted_at', null).maybeSingle();
      if (fetchErr) throw fetchErr;
      if (!existing) return res.status(404).json({ error: 'ไม่พบผู้ติดต่อ' });

      const { error } = await supabase.from('pos_contacts')
        .update({ deleted_at: new Date().toISOString() })
        .eq('shop_id', shopId).eq('contact_id', contact_id);
      if (error) throw error;
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('[pos/contacts]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
