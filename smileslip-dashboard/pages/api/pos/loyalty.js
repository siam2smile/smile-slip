/**
 * GET  /api/pos/loyalty?shopId&contactId  → ยอดแต้มคงเหลือ + ประวัติ ledger ของลูกค้ารายหนึ่ง
 *      (เปิดกว้างไม่ล็อกสิทธิ์พนักงาน — ต้องใช้ตอนเลือกลูกค้าในหน้าขาย/checkout เหมือน contacts.js
 *      GET เดิมที่ไม่มีการ gate เช่นกัน — การ "แลกแต้มจริง" ถูกคุมสิทธิ์แล้วที่ sales.js POST
 *      ผ่าน perm_process_sales อยู่แล้ว จุดนี้เป็นแค่ read-only info)
 * POST /api/pos/loyalty { shopId, contactId, contactName, points, note, branch }
 *      → ปรับยอดแต้มด้วยมือ (entry_type: 'adjust', points เป็นบวก=เพิ่ม/ลบ=หัก) — เจ้าของร้าน/
 *      แอดมินเท่านั้น (ไม่ใช่หน้าที่พนักงาน) ใช้แก้ไขกรณีพิเศษ เช่น ยกเลิกบิลเก่าที่เคยให้แต้มไปแล้ว
 *      (ดู known gap ที่ sales.js DELETE บันทึกไว้ — ระบบไม่ย้อนแต้มอัตโนมัติ ต้องปรับเองผ่านที่นี่)
 */
import { blockIfTrialExpired } from '../../../lib/shop-access';
import { blockAllStaffSessions } from '../../../lib/pos-auth';
import { supabase, insertRow, tableExists } from '../../../lib/supabase-pos';
import { computeLoyaltyBalance } from '../../../lib/loyalty';

export default async function handler(req, res) {
  const shopId = req.query.shopId || req.body?.shopId;
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });

  try {
    if (req.method === 'GET') {
      const contactId = req.query.contactId;
      if (!contactId) return res.status(400).json({ error: 'Missing contactId' });
      if (!(await tableExists('pos_loyalty_ledger'))) {
        return res.json({ balance: 0, ledger: [], loyaltyReady: false });
      }
      const { data, error } = await supabase.from('pos_loyalty_ledger')
        .select('*').eq('shop_id', shopId).eq('contact_id', contactId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      const balance = computeLoyaltyBalance(data || []);
      const ledger = (data || []).slice().reverse().map(r => ({
        id: r.id, entry_type: r.entry_type, points: Number(r.points) || 0,
        note: r.note || '', ref: r.ref || '', branch: r.branch_name || '',
        expires_at: r.expires_at, created_at: r.created_at,
      }));
      return res.json({ balance, ledger, loyaltyReady: true });
    }

    // เขียน (POST ปรับยอดด้วยมือ) — เฉพาะเจ้าของร้าน/แอดมิน
    if (!blockAllStaffSessions(req, res, shopId)) return;
    if (await blockIfTrialExpired(req, res, shopId)) return;

    if (req.method === 'POST') {
      const { contactId, contactName = '', points, note = '', branch = '' } = req.body || {};
      if (!contactId) return res.status(400).json({ error: 'ต้องระบุลูกค้า' });
      const pts = Number(points);
      if (!pts || pts === 0) return res.status(400).json({ error: 'จำนวนแต้มที่ปรับต้องไม่เป็น 0' });
      if (!(await tableExists('pos_loyalty_ledger'))) {
        return res.status(400).json({ error: 'ระบบแต้มสะสมยังไม่พร้อมใช้งาน (ยังไม่ได้รัน SQL)' });
      }
      await insertRow('pos_loyalty_ledger', {
        shop_id: shopId, contact_id: contactId, entry_type: 'adjust', points: pts,
        ref: '', note: note || (contactName ? `ปรับยอดแต้มด้วยมือ (${contactName})` : 'ปรับยอดแต้มด้วยมือ'),
        branch_name: branch || '',
      });
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('[pos/loyalty]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
