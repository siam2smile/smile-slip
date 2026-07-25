/**
 * GET  /api/pos/loans?shopId&status=ยืมอยู่|คืนแล้ว|ทั้งหมด&dateFrom&dateTo
 * POST /api/pos/loans { shopId, contact_id, contact_name, contact_phone, items, due_date, notes, deduct_stock, branch }
 * PATCH /api/pos/loans { shopId, loan_no, notes, branch }  → mark คืนแล้ว + restore stock
 */
import { createClient } from '@supabase/supabase-js';
import { blockIfTrialExpired } from '../../../lib/shop-access';
import {
  getAccessToken, readSheet, appendSheet, updateSheetRow,
  ensureTabExists, makeLoanNo, rowToLoan, rowToProduct, LOAN_HEADERS,
} from '../../../lib/google-pos';
import { dualWrite, insertRow, updateRow } from '../../../lib/supabase-pos';

// บังคับให้ Google Sheets เก็บเป็นข้อความล้วน กันเบอร์โทร/บาร์โค้ดที่ขึ้นต้นด้วย 0 โดนตัด 0 ทิ้ง
// (valueInputOption=USER_ENTERED ตีความค่าที่หน้าตาเป็นตัวเลขแล้วแปลงเป็นเลขเอง) — ไฟล์นี้ไม่เคย
// ผ่าน asText() มาก่อนเลยทั้งไฟล์
function asText(v) {
  if (v === '' || v == null) return v;
  return `'${v}`;
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

async function getConfig(shopId) {
  const [{ data: pc }, { data: gc }] = await Promise.all([
    supabase.from('pos_configs').select('pos_sheet_id').eq('shop_id', shopId).single(),
    supabase.from('shop_google_configs').select('google_refresh_token').eq('shop_id', shopId).single(),
  ]);
  if (!pc?.pos_sheet_id) throw Object.assign(new Error('ยังไม่ได้ตั้งค่า POS'), { notSetup: true });
  if (!gc?.google_refresh_token) throw Object.assign(new Error('ยังไม่ได้เชื่อมต่อ Google'), { notConnected: true });
  return {
    sheetId: pc.pos_sheet_id,
    token: await getAccessToken(gc.google_refresh_token),
  };
}

// รองรับทั้ง "D/M/BE, H:MM:SS" (มี comma) และ "D/M/BE H:MM:SS" (คั่นด้วยวรรค ไม่มี comma —
// รูปแบบจริงที่ toLocaleString('th-TH') คืนมา) — เดิม split(',') อย่างเดียวทำให้ parse เพี้ยนเป็น
// Invalid Date เงียบๆ เมื่อไม่มี comma (ตัวกรอง dateFrom/dateTo จึงไม่มีผลอะไรเลยมาตลอด)
function parseThaiBEDate(str) {
  try {
    const datePart = str.split(/[, ]/)[0];
    const [d, m, by] = datePart.trim().split('/').map(Number);
    if (!d || !m || !by) return null;
    const year = by > 2400 ? by - 543 : by; // แปลง พ.ศ. → ค.ศ.
    return new Date(year, m - 1, d);
  } catch { return null; }
}

export default async function handler(req, res) {
  const shopId = req.query.shopId || req.body?.shopId;
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });

  // เขียนไม่ได้ถ้าทดลองใช้ 30 วันหมดอายุแล้ว (อ่าน/GET ยังทำได้ปกติเสมอ)
  if (req.method !== 'GET' && (await blockIfTrialExpired(req, res, shopId))) return;


  try {
    const { sheetId, token } = await getConfig(shopId);
    await ensureTabExists(token, sheetId, 'ยืมสินค้า', LOAN_HEADERS);

    // ── GET ──────────────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      const rows = await readSheet(token, sheetId, 'ยืมสินค้า!A:K');
      let loans = rows.slice(1).map(r => rowToLoan(r)).filter(l => l.loan_no);

      const { status, dateFrom, dateTo, branch } = req.query;
      if (status && status !== 'ทั้งหมด') {
        loans = loans.filter(l => l.status === status);
      }
      if (branch) loans = loans.filter(l => l.branch === branch);
      if (dateFrom || dateTo) {
        const from = dateFrom ? new Date(dateFrom) : null;
        const to   = dateTo   ? new Date(dateTo + 'T23:59:59') : null;
        loans = loans.filter(l => {
          const d = parseThaiBEDate(l.created_at);
          if (!d) return true;
          if (from && d < from) return false;
          if (to   && d > to)   return false;
          return true;
        });
      }

      // คำนวณ summary
      const overdue = loans.filter(l => {
        if (l.status !== 'ยืมอยู่' || !l.due_date) return false;
        return new Date(l.due_date) < new Date();
      });
      return res.json({
        loans: loans.reverse(),
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
      const {
        contact_id = '', contact_name = '', contact_phone = '',
        items = [], due_date = '', notes = '',
        deduct_stock = false, branch = '',
      } = req.body;
      if (!contact_name) return res.status(400).json({ error: 'ต้องระบุชื่อผู้ยืม' });
      if (!items.length)  return res.status(400).json({ error: 'ต้องระบุรายการสินค้า' });

      const loanNo = makeLoanNo();
      const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });

      await dualWrite({
        label: 'loans-create',
        primary: () => appendSheet(token, sheetId, 'ยืมสินค้า', [
          loanNo, asText(now), due_date, contact_id, contact_name, asText(contact_phone),
          JSON.stringify(items), notes, 'ยืมอยู่', '', branch,
        ]),
        secondary: () => insertRow('pos_loans', {
          shop_id: shopId, loan_no: loanNo, due_date, contact_id, contact_name,
          contact_phone, items, notes, status: 'ยืมอยู่', returned_at: null, branch_name: branch,
        }),
      });

      // ตัดสต็อคออกถ้าขอ (optional)
      if (deduct_stock) {
        try {
          const prodRows = await readSheet(token, sheetId, 'สินค้า!A:R');
          const dataRows = prodRows.slice(1);
          for (const item of items) {
            const idx = dataRows.findIndex(r => r[0] === item.sku);
            if (idx === -1) continue;
            const existing = [...dataRows[idx]];
            while (existing.length < 18) existing.push('');
            const prodType = (existing[10] || 'นับสต็อค') === 'ทั่วไป' ? 'นับสต็อค' : (existing[10] || 'นับสต็อค');
            if (prodType === 'นับสต็อค') {
              existing[5] = Math.max(0, (parseFloat(existing[5]) || 0) - item.qty);
              existing[9] = asText(now);
              // รหัสสินค้า/บาร์โค้ดที่ขึ้นต้นด้วย 0 ต้อง re-wrap เสมอเมื่อเขียนทั้งแถวกลับ
              existing[13] = asText(existing[13]);
              existing[14] = asText(existing[14]);
              await updateSheetRow(token, sheetId, 'สินค้า', idx + 2, existing);
              dataRows[idx] = existing;
            }
          }
        } catch (e) { console.error('[loans] deduct stock error:', e.message); }
      }

      return res.json({ ok: true, loanNo });
    }

    // ── PATCH (บันทึกคืนสินค้า) ─────────────────────────────────────────────
    if (req.method === 'PATCH') {
      const { loan_no, notes = '' } = req.body;
      if (!loan_no) return res.status(400).json({ error: 'Missing loan_no' });

      const rows = await readSheet(token, sheetId, 'ยืมสินค้า!A:K');
      const dataRows = rows.slice(1);
      const idx = dataRows.findIndex(r => r[0] === loan_no);
      if (idx === -1) return res.status(404).json({ error: 'ไม่พบใบยืม' });

      const existing = [...dataRows[idx]];
      while (existing.length < 11) existing.push('');
      const loan = rowToLoan(existing);
      if (loan.status === 'คืนแล้ว') return res.status(400).json({ error: 'คืนไปแล้ว' });

      const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
      existing[8] = 'คืนแล้ว';
      existing[9] = asText(now);
      if (notes) existing[7] = [existing[7], notes].filter(Boolean).join(' | ');
      const mergedNotes = existing[7];
      // เบอร์โทร (col F) ไม่เคยถูกแก้ผ่าน PATCH นี้เลย แต่ถูกเขียนทับกลับทุกครั้งที่บันทึกคืนสินค้า —
      // ต้อง re-wrap เสมอกันตัดเลข 0 นำหน้าทิ้ง
      existing[5] = asText(existing[5]);
      await dualWrite({
        label: 'loans-return',
        primary: () => updateSheetRow(token, sheetId, 'ยืมสินค้า', idx + 2, existing),
        secondary: () => updateRow('pos_loans', { shop_id: shopId, loan_no },
          { status: 'คืนแล้ว', returned_at: now, notes: mergedNotes }),
      });

      // คืนสต็อค
      try {
        const prodRows = await readSheet(token, sheetId, 'สินค้า!A:R');
        const prodDataRows = prodRows.slice(1);
        for (const item of loan.items) {
          const pIdx = prodDataRows.findIndex(r => r[0] === item.sku);
          if (pIdx === -1) continue;
          const pe = [...prodDataRows[pIdx]];
          while (pe.length < 18) pe.push('');
          const prodType = (pe[10] || 'นับสต็อค') === 'ทั่วไป' ? 'นับสต็อค' : (pe[10] || 'นับสต็อค');
          if (prodType === 'นับสต็อค') {
            pe[5] = (parseFloat(pe[5]) || 0) + item.qty;
            pe[9] = asText(now);
            // รหัสสินค้า/บาร์โค้ดที่ขึ้นต้นด้วย 0 ต้อง re-wrap เสมอเมื่อเขียนทั้งแถวกลับ
            pe[13] = asText(pe[13]);
            pe[14] = asText(pe[14]);
            await updateSheetRow(token, sheetId, 'สินค้า', pIdx + 2, pe);
          }
        }
      } catch (e) { console.error('[loans] restore stock error:', e.message); }

      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[pos/loans]', err.message);
    if (err.notSetup)     return res.status(400).json({ error: err.message, notSetup: true });
    if (err.notConnected) return res.status(400).json({ error: err.message, notConnected: true });
    return res.status(500).json({ error: err.message });
  }
}
