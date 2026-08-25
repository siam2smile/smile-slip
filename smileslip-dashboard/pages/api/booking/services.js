/**
 * GET    /api/booking/services?shopId=xxx        — รายการบริการทั้งหมด (รวมที่ปิดใช้งาน)
 * POST   /api/booking/services { shopId, ...}     — สร้างบริการใหม่
 * PATCH  /api/booking/services { shopId, id, ...} — แก้ไขบริการ
 * DELETE /api/booking/services { shopId, id }     — ลบ (soft-delete)
 */
import { createClient } from '@supabase/supabase-js';
import { requireOwnerAuth } from '../../../lib/owner-auth';
import { makeServiceNo, serviceFromRow } from '../../../lib/booking';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

function validateDeposit(deposit_required, deposit_type, deposit_value) {
  if (!deposit_required) return null;
  if (!['percent', 'fixed'].includes(deposit_type)) return 'deposit_type ต้องเป็น percent หรือ fixed';
  const v = Number(deposit_value);
  if (!(v >= 0)) return 'deposit_value ต้องเป็นตัวเลขไม่ติดลบ';
  if (deposit_type === 'percent' && v > 100) return 'deposit_value แบบ % ต้องไม่เกิน 100';
  return null;
}

export default async function handler(req, res) {
  const body = req.method === 'GET' ? req.query : req.body;
  const { shopId } = body;
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });
  if (!requireOwnerAuth(req, res, shopId, { enforce: true })) return;

  if (req.method === 'GET') {
    const { data, error } = await supabase.from('booking_services').select('*')
      .eq('shop_id', shopId).is('deleted_at', null).order('created_at', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ services: (data || []).map(serviceFromRow) });
  }

  if (req.method === 'POST') {
    const {
      name, description = '', duration_minutes, price = 0,
      requires_staff_selection = false, deposit_required = false,
      deposit_type = 'percent', deposit_value = 0, max_concurrent = 1, branch_name = '',
    } = req.body;

    if (!name || !String(name).trim()) return res.status(400).json({ error: 'กรุณากรอกชื่อบริการ' });
    const durationMin = Number(duration_minutes);
    if (!(durationMin > 0)) return res.status(400).json({ error: 'ระยะเวลาต้องมากกว่า 0 นาที' });
    if (!(Number(price) >= 0)) return res.status(400).json({ error: 'ราคาต้องไม่ติดลบ' });
    if (!(Number(max_concurrent) >= 1)) return res.status(400).json({ error: 'รับคิวพร้อมกันต้องอย่างน้อย 1' });
    const depositErr = validateDeposit(deposit_required, deposit_type, deposit_value);
    if (depositErr) return res.status(400).json({ error: depositErr });

    try {
      const { data, error } = await supabase.from('booking_services').insert({
        shop_id: shopId, service_no: makeServiceNo(), name: String(name).trim(), description,
        duration_minutes: durationMin, price: Number(price),
        requires_staff_selection: !!requires_staff_selection,
        deposit_required: !!deposit_required,
        deposit_type: deposit_required ? deposit_type : null,
        deposit_value: deposit_required ? Number(deposit_value) : null,
        max_concurrent: Number(max_concurrent), branch_name: branch_name || null,
      }).select().single();
      if (error) throw error;
      return res.json({ ok: true, service: serviceFromRow(data) });
    } catch (err) {
      console.error('[booking/services POST]', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'PATCH') {
    const { id, ...fields } = req.body;
    if (!id) return res.status(400).json({ error: 'Missing id' });

    const updates = { updated_at: new Date().toISOString() };
    if (fields.name !== undefined) {
      if (!String(fields.name).trim()) return res.status(400).json({ error: 'กรุณากรอกชื่อบริการ' });
      updates.name = String(fields.name).trim();
    }
    if (fields.description !== undefined) updates.description = fields.description;
    if (fields.duration_minutes !== undefined) {
      const d = Number(fields.duration_minutes);
      if (!(d > 0)) return res.status(400).json({ error: 'ระยะเวลาต้องมากกว่า 0 นาที' });
      updates.duration_minutes = d;
    }
    if (fields.price !== undefined) {
      if (!(Number(fields.price) >= 0)) return res.status(400).json({ error: 'ราคาต้องไม่ติดลบ' });
      updates.price = Number(fields.price);
    }
    if (fields.requires_staff_selection !== undefined) updates.requires_staff_selection = !!fields.requires_staff_selection;
    if (fields.max_concurrent !== undefined) {
      if (!(Number(fields.max_concurrent) >= 1)) return res.status(400).json({ error: 'รับคิวพร้อมกันต้องอย่างน้อย 1' });
      updates.max_concurrent = Number(fields.max_concurrent);
    }
    if (fields.branch_name !== undefined) updates.branch_name = fields.branch_name || null;
    if (fields.is_active !== undefined) updates.is_active = !!fields.is_active;
    if (fields.deposit_required !== undefined) {
      const depositErr = validateDeposit(fields.deposit_required, fields.deposit_type, fields.deposit_value);
      if (depositErr) return res.status(400).json({ error: depositErr });
      updates.deposit_required = !!fields.deposit_required;
      updates.deposit_type = fields.deposit_required ? fields.deposit_type : null;
      updates.deposit_value = fields.deposit_required ? Number(fields.deposit_value) : null;
    }

    try {
      const { error } = await supabase.from('booking_services').update(updates).eq('id', id).eq('shop_id', shopId);
      if (error) throw error;
      return res.json({ ok: true });
    } catch (err) {
      console.error('[booking/services PATCH]', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'DELETE') {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'Missing id' });
    try {
      const { error } = await supabase.from('booking_services')
        .update({ deleted_at: new Date().toISOString() }).eq('id', id).eq('shop_id', shopId);
      if (error) throw error;
      return res.json({ ok: true });
    } catch (err) {
      console.error('[booking/services DELETE]', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  res.setHeader('Allow', ['GET', 'POST', 'PATCH', 'DELETE']);
  return res.status(405).json({ error: 'Method not allowed' });
}
