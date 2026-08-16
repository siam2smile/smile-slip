/**
 * GET    /api/pos/staff-logs?shopId&dateFrom&dateTo&branch   → รายการบันทึกประจำวัน (เจ้าของ/แอดมินเท่านั้น)
 * POST   /api/pos/staff-logs { shopId, problem_text, urgency, praise_text, low_stock_note, photo_url, branch }
 *   → พนักงาน (ผ่าน staff-session จาก pos-staff.js) บันทึกประจำวัน — ไม่ต้องมีสิทธิ์เฉพาะเจาะจง
 *     (เหมือน cash-shifts.js ที่พนักงานทุกคนเปิด/ปิดกะได้เสมอ ไม่ผูกสิทธิ์ granular) — staff_id/
 *     staff_name ดึงจาก session ที่เซ็นชื่อไว้แล้วเสมอ (ปลอมไม่ได้) ไม่เชื่อค่าที่ client ส่งมาตรงๆ
 *   → auto-pull ยอดขายของกะที่เปิดอยู่ตอนนี้ของพนักงานคนนี้ (ถ้ามี) แนบไปกับบันทึกด้วย
 * DELETE /api/pos/staff-logs { shopId, log_id } → ลบ (เจ้าของ/แอดมินเท่านั้น, soft-delete)
 *
 * งานกลยุทธ์ "Daily Staff Log" — ผู้ใช้อนุมัติ 2026-08-16, ล็อก Enterprise (ดู lib/tier-features.js)
 */
import { createClient } from '@supabase/supabase-js';
import { blockIfTrialExpired } from '../../../lib/shop-access';
import { requireOwnerAuth } from '../../../lib/owner-auth';
import { getSessionStaffId } from '../../../lib/pos-auth';
import { hasFeature, upgradeMessage } from '../../../lib/tier-features';
import { verifyStaffSession } from '../../../lib/staff-session';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

const URGENCY_VALUES = new Set(['normal', 'warning', 'urgent']);

function logFromRow(r) {
  return {
    log_id: r.id, staff_id: r.staff_id, staff_name: r.staff_name, branch: r.branch_name || '',
    problem_text: r.problem_text || '', urgency: r.urgency || 'normal',
    praise_text: r.praise_text || '', low_stock_note: r.low_stock_note || '',
    photo_url: r.photo_url || '', shift_no: r.shift_no || '',
    shift_sales_total: r.shift_sales_total, shift_sales_count: r.shift_sales_count,
    created_at: r.created_at,
  };
}

export default async function handler(req, res) {
  const shopId = req.query.shopId || req.body?.shopId;
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });

  const { data: shopRow } = await supabase.from('shop_profiles').select('subscription_tier').eq('id', shopId).maybeSingle();
  if (!hasFeature((shopRow?.subscription_tier || 'normal').toLowerCase(), 'daily_staff_log')) {
    return res.status(403).json({ error: upgradeMessage('daily_staff_log'), featureLocked: true });
  }

  try {
    // ── GET (เจ้าของ/แอดมินดูรายการทั้งหมด) ──────────────────────────────────
    if (req.method === 'GET') {
      if (!requireOwnerAuth(req, res, shopId, { enforce: true })) return;

      let query = supabase.from('pos_staff_logs').select('*').eq('shop_id', shopId).is('deleted_at', null);
      if (req.query.branch) query = query.eq('branch_name', req.query.branch);
      if (req.query.dateFrom) query = query.gte('created_at', req.query.dateFrom);
      if (req.query.dateTo) query = query.lte('created_at', req.query.dateTo + 'T23:59:59');
      const { data, error } = await query.order('created_at', { ascending: false }).limit(200);
      if (error) throw error;
      return res.json({ logs: (data || []).map(logFromRow) });
    }

    // ── POST (พนักงานบันทึก) ─────────────────────────────────────────────────
    if (req.method === 'POST') {
      if (await blockIfTrialExpired(req, res, shopId)) return;

      const { problem_text = '', urgency = 'normal', praise_text = '', low_stock_note = '', photo_url = '', branch = '' } = req.body || {};
      if (!problem_text.trim() && !praise_text.trim() && !low_stock_note.trim()) {
        return res.status(400).json({ error: 'กรุณากรอกอย่างน้อย 1 ช่อง (ปัญหา/คำชม/สต็อกใกล้หมด)' });
      }
      if (!URGENCY_VALUES.has(urgency)) return res.status(400).json({ error: 'ระดับความเร่งด่วนไม่ถูกต้อง' });

      // ตัวตนพนักงาน — ดึงจาก session ที่เซ็นชื่อไว้เสมอ (ปลอมไม่ได้) ไม่ใช้ค่าจากฝั่ง client
      const sessionToken = req.headers['x-staff-session'] || req.query?.session;
      const session = sessionToken ? verifyStaffSession(sessionToken) : null;
      let staffId = session?.staffId || null;
      let staffName = '';
      let staffBranch = branch;

      if (staffId) {
        const { data: staffRow } = await supabase.from('pos_staff').select('name, branch_name')
          .eq('shop_id', shopId).eq('staff_id', staffId).maybeSingle();
        staffName = staffRow?.name || '';
        staffBranch = staffRow?.branch_name || branch;
      } else {
        // ไม่มี staff-session เลย (เช่น เจ้าของร้านบันทึกเองผ่าน /pos โดยตรง) — ต้องพิสูจน์ตัวตนเจ้าของแทน
        if (!requireOwnerAuth(req, res, shopId, { enforce: true })) return;
        staffName = 'เจ้าของร้าน';
      }

      // auto-pull ยอดขายกะที่เปิดอยู่ตอนนี้ของคนนี้ (ถ้ามี) — best-effort ไม่บล็อคการบันทึกถ้าหาไม่เจอ
      let shiftNo = null, shiftSalesTotal = null, shiftSalesCount = null;
      if (staffId) {
        try {
          const { data: openShift } = await supabase.from('pos_cash_shifts').select('shift_no')
            .eq('shop_id', shopId).eq('staff_id', staffId).eq('status', 'เปิดอยู่').maybeSingle();
          if (openShift?.shift_no) {
            shiftNo = openShift.shift_no;
            const { data: shiftSales } = await supabase.from('pos_sales').select('total')
              .eq('shop_id', shopId).eq('shift_no', shiftNo).is('deleted_at', null).neq('status', 'ยกเลิก');
            shiftSalesCount = (shiftSales || []).length;
            shiftSalesTotal = (shiftSales || []).reduce((s, r) => s + (parseFloat(r.total) || 0), 0);
          }
        } catch (e) { console.warn('[staff-logs] auto-pull shift sales failed:', e.message); }
      }

      const { data: inserted, error } = await supabase.from('pos_staff_logs').insert({
        shop_id: shopId, staff_id: staffId, staff_name: staffName, branch_name: staffBranch,
        problem_text: problem_text.trim(), urgency, praise_text: praise_text.trim(),
        low_stock_note: low_stock_note.trim(), photo_url,
        shift_no: shiftNo, shift_sales_total: shiftSalesTotal, shift_sales_count: shiftSalesCount,
      }).select('*').single();
      if (error) throw error;

      return res.json({ ok: true, log: logFromRow(inserted) });
    }

    // ── DELETE (เจ้าของ/แอดมิน) ──────────────────────────────────────────────
    if (req.method === 'DELETE') {
      if (!requireOwnerAuth(req, res, shopId, { enforce: true })) return;
      const { log_id } = req.body || {};
      if (!log_id) return res.status(400).json({ error: 'Missing log_id' });
      const { error } = await supabase.from('pos_staff_logs')
        .update({ deleted_at: new Date().toISOString() }).eq('shop_id', shopId).eq('id', log_id);
      if (error) throw error;
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('[pos/staff-logs]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
