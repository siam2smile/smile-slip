/**
 * GET  /api/pos/loans?shopId&status=ยืมอยู่|คืนแล้ว|ทั้งหมด&dateFrom&dateTo
 * POST /api/pos/loans { shopId, contact_id, contact_name, contact_phone, items, due_date, notes, deduct_stock, branch }
 * PATCH /api/pos/loans { shopId, loan_no, notes, branch }  → mark คืนแล้ว + restore stock
 *
 * Phase 2 (write-primary flip, 2026-07-29): อ่าน/เขียนจาก Supabase (pos_loans/pos_products) โดยตรง
 * แล้ว ไม่ผ่าน Google Sheets/Google connection อีกต่อไป
 */
import { createClient } from '@supabase/supabase-js';
import { blockIfTrialExpired } from '../../../lib/shop-access';
import { makeLoanNo, loanFromRow, productFromRow } from '../../../lib/google-pos';
import { requirePermission } from '../../../lib/pos-auth';
import { adjustBranchStock } from '../../../lib/pos-stock';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  const shopId = req.query.shopId || req.body?.shopId;
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });

  // เขียนไม่ได้ถ้าทดลองใช้ 30 วันหมดอายุแล้ว (อ่าน/GET ยังทำได้ปกติเสมอ)
  if (req.method !== 'GET' && (await blockIfTrialExpired(req, res, shopId))) return;

  try {
    // ── GET ──────────────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      const { data, error } = await supabase.from('pos_loans').select('*').eq('shop_id', shopId);
      if (error) throw error;
      let loans = (data || []).map(loanFromRow).filter(l => l.loan_no);

      const { status, dateFrom, dateTo, branch } = req.query;
      if (status && status !== 'ทั้งหมด') {
        loans = loans.filter(l => l.status === status);
      }
      if (branch) loans = loans.filter(l => l.branch === branch);
      if (dateFrom || dateTo) {
        const from = dateFrom ? new Date(dateFrom) : null;
        const to   = dateTo   ? new Date(dateTo + 'T23:59:59') : null;
        loans = loans.filter(l => {
          const d = l.created_at ? new Date(l.created_at) : null;
          if (!d || isNaN(d.getTime())) return true;
          if (from && d < from) return false;
          if (to   && d > to)   return false;
          return true;
        });
      }

      // เรียงล่าสุดก่อน (created_at เป็น timestamp จริงของ Supabase ไม่ใช่สตริงไทยเหมือน Sheets เดิม)
      loans.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      // คำนวณ summary
      const overdue = loans.filter(l => {
        if (l.status !== 'ยืมอยู่' || !l.due_date) return false;
        return new Date(l.due_date) < new Date();
      });
      return res.json({
        loans,
        summary: {
          total:   loans.length,
          active:  loans.filter(l => l.status === 'ยืมอยู่').length,
          returned:loans.filter(l => l.status === 'คืนแล้ว').length,
          overdue: overdue.length,
        },
      });
    }

    // ── POST (สร้างใบยืม) ────────────────────────────────────────────────────
    if (req.method === 'POST') {
      if (!(await requirePermission(req, res, shopId, 'perm_manage_stock'))) return;
      const {
        contact_id = '', contact_name = '', contact_phone = '',
        items = [], due_date = '', notes = '',
        deduct_stock = false, branch = '',
      } = req.body;
      if (!contact_name) return res.status(400).json({ error: 'ต้องระบุชื่อผู้ยืม' });
      if (!items.length)  return res.status(400).json({ error: 'ต้องระบุรายการสินค้า' });

      const loanNo = makeLoanNo();
      const now = new Date();

      const { error } = await supabase.from('pos_loans').insert({
        shop_id: shopId, loan_no: loanNo, due_date, contact_id, contact_name,
        contact_phone, items, notes, status: 'ยืมอยู่', returned_at: null, branch_name: branch,
        stock_deducted: !!deduct_stock, created_at: now.toISOString(),
      });
      if (error) throw error;

      // ตัดสต็อคออกถ้าขอ (optional)
      if (deduct_stock) {
        const nowThai = now.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
        for (const item of items) {
          if (!item.sku) continue;
          try {
            const { data: prodRow } = await supabase.from('pos_products').select('*')
              .eq('shop_id', shopId).eq('sku', item.sku).is('deleted_at', null).maybeSingle();
            if (!prodRow) continue;
            const prod = productFromRow(prodRow);
            if (prod.type !== 'นับสต็อค') continue;
            // โอนย้ายสต็อกข้ามสาขา Phase 1: หักจากสาขาที่สร้างใบยืม (branch มีอยู่แล้วใน request)
            await adjustBranchStock(shopId, item.sku, branch, { qtyDelta: -item.qty });
            await supabase.from('pos_products').update({ product_updated_at: nowThai })
              .eq('shop_id', shopId).eq('sku', item.sku);
          } catch (e) { console.error('[loans] deduct stock error:', e.message); }
        }
      }

      return res.json({ ok: true, loanNo });
    }

    // ── PATCH (บันทึกคืนสินค้า) ─────────────────────────────────────────────
    if (req.method === 'PATCH') {
      if (!(await requirePermission(req, res, shopId, 'perm_manage_stock'))) return;
      const { loan_no, notes = '' } = req.body;
      if (!loan_no) return res.status(400).json({ error: 'Missing loan_no' });

      const { data: loanRow, error: fetchErr } = await supabase.from('pos_loans').select('*')
        .eq('shop_id', shopId).eq('loan_no', loan_no).maybeSingle();
      if (fetchErr) throw fetchErr;
      if (!loanRow) return res.status(404).json({ error: 'ไม่พบใบยืม' });

      const loan = loanFromRow(loanRow);
      if (loan.status === 'คืนแล้ว') return res.status(400).json({ error: 'คืนไปแล้ว' });

      const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
      const mergedNotes = notes ? [loan.notes, notes].filter(Boolean).join(' | ') : loan.notes;

      const { error } = await supabase.from('pos_loans').update({
        status: 'คืนแล้ว', returned_at: now, notes: mergedNotes,
      }).eq('shop_id', shopId).eq('loan_no', loan_no);
      if (error) throw error;

      // คืนสต็อค — เฉพาะใบยืมที่เคยตัดสต็อคออกจริงตอนสร้างเท่านั้น (คอลัมน์ stock_deducted) — ใบที่สร้างด้วย
      // deduct_stock:false ไม่เคยตัดสต็อคออก ถ้าบวกกลับตอนคืนจะทำให้สต็อคเฟ้อขึ้นเรื่อยๆ
      // โอนย้ายสต็อกข้ามสาขา Phase 1: คืนกลับเข้าสาขาเดียวกับที่บันทึกไว้ตอนสร้างใบยืม (loan.branch)
      // ไม่ใช่ branch จาก request (PATCH นี้ไม่มี branch ในคำขอ) — กันคืนเข้าสาขาผิดถ้าไม่ส่งมา
      if (loan.stock_deducted) {
        for (const item of loan.items) {
          if (!item.sku) continue;
          try {
            const { data: prodRow } = await supabase.from('pos_products').select('*')
              .eq('shop_id', shopId).eq('sku', item.sku).is('deleted_at', null).maybeSingle();
            if (!prodRow) continue;
            const prod = productFromRow(prodRow);
            if (prod.type !== 'นับสต็อค') continue;
            await adjustBranchStock(shopId, item.sku, loan.branch, { qtyDelta: item.qty });
            await supabase.from('pos_products').update({ product_updated_at: now })
              .eq('shop_id', shopId).eq('sku', item.sku);
          } catch (e) { console.error('[loans] restore stock error:', e.message); }
        }
      }

      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[pos/loans]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
