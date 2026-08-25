/**
 * GET/POST/PATCH/DELETE /api/booking/providers — รายชื่อพนักงาน/ผู้ให้บริการที่เลือกได้ตอนจอง
 * (แยกจาก pos_staff โดยเจตนา — ร้านที่ใช้แค่ระบบจองอย่างเดียวไม่มี POS เลยก็ใช้ได้เต็มรูปแบบ)
 */
import { createClient } from '@supabase/supabase-js';
import { requireOwnerAuth } from '../../../lib/owner-auth';
import { providerFromRow } from '../../../lib/booking';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  const body = req.method === 'GET' ? req.query : req.body;
  const { shopId } = body;
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });
  if (!requireOwnerAuth(req, res, shopId, { enforce: true })) return;

  if (req.method === 'GET') {
    const { data, error } = await supabase.from('booking_providers').select('*')
      .eq('shop_id', shopId).is('deleted_at', null).order('created_at', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ providers: (data || []).map(r => ({ id: r.id, ...providerFromRow(r) })) });
  }

  if (req.method === 'POST') {
    const { name, branch_name = '' } = req.body;
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'กรุณากรอกชื่อ' });
    try {
      const { data, error } = await supabase.from('booking_providers')
        .insert({ shop_id: shopId, name: String(name).trim(), branch_name: branch_name || null })
        .select().single();
      if (error) throw error;
      return res.json({ ok: true, provider: { id: data.id, ...providerFromRow(data) } });
    } catch (err) {
      console.error('[booking/providers POST]', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'PATCH') {
    const { id, name, branch_name, is_active } = req.body;
    if (!id) return res.status(400).json({ error: 'Missing id' });
    const updates = {};
    if (name !== undefined) {
      if (!String(name).trim()) return res.status(400).json({ error: 'กรุณากรอกชื่อ' });
      updates.name = String(name).trim();
    }
    if (branch_name !== undefined) updates.branch_name = branch_name || null;
    if (is_active !== undefined) updates.is_active = !!is_active;
    try {
      const { error } = await supabase.from('booking_providers').update(updates).eq('id', id).eq('shop_id', shopId);
      if (error) throw error;
      return res.json({ ok: true });
    } catch (err) {
      console.error('[booking/providers PATCH]', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'DELETE') {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'Missing id' });
    try {
      const { error } = await supabase.from('booking_providers')
        .update({ deleted_at: new Date().toISOString() }).eq('id', id).eq('shop_id', shopId);
      if (error) throw error;
      return res.json({ ok: true });
    } catch (err) {
      console.error('[booking/providers DELETE]', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  res.setHeader('Allow', ['GET', 'POST', 'PATCH', 'DELETE']);
  return res.status(405).json({ error: 'Method not allowed' });
}
