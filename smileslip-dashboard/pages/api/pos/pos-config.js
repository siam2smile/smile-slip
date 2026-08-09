/**
 * GET  /api/pos/pos-config?shopId=xxx  → อ่านการตั้งค่า POS
 * PATCH /api/pos/pos-config { shopId, promptpay_id, kbank_api_key, scb_api_key, scb_biller_id, receipt_paper_size, vat_registered }
 * (staff_pin ร้านเดียวใช้ร่วมกันแบบเดิมยกเลิกไปแล้ว — ดู api/pos/staff.js + staff-setpin.js สำหรับ PIN รายบุคคล)
 */
import { createClient } from '@supabase/supabase-js';
import { blockIfTrialExpired } from '../../../lib/shop-access';
import { blockAllStaffSessions } from '../../../lib/pos-auth';
import { requireOwnerAuth } from '../../../lib/owner-auth';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  const shopId = req.query.shopId || req.body?.shopId;
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });

  // เขียนไม่ได้ถ้าทดลองใช้ 30 วันหมดอายุแล้ว (อ่าน/GET ยังทำได้ปกติเสมอ)
  if (req.method !== 'GET' && (await blockIfTrialExpired(req, res, shopId))) return;


  if (req.method === 'GET') {
    // คืน kbank_api_key/scb_api_key ตรงๆ (credential ธนาคารจริง) — ยังไม่ enforce:true เพราะเรียก
    // ซิงโครนัสตอนโหลดหน้าครั้งแรกใน pos.js's loadShopBody() ก่อน fetch-override จะติดตั้งเสร็จ
    // (chicken-and-egg เดียวกับ shop/data.js) แต่ token ที่ shopId ไม่ตรงกันต้องถูกบล็อกเสมอ
    if (!requireOwnerAuth(req, res, shopId, { enforce: false })) return;

    const { data, error } = await supabase
      .from('pos_configs')
      .select('promptpay_id, kbank_api_key, scb_api_key, scb_biller_id')
      .eq('shop_id', shopId)
      .single();

    if (error && error.code !== 'PGRST116') {
      return res.status(500).json({ error: error.message });
    }

    // แยก query ต่างหาก + กันพัง — คอลัมน์เหล่านี้ต้องรัน ALTER TABLE ด้วยมือก่อนถึงจะมีจริง
    // (ดู CLAUDE.md ต้องทำด้วยมือ) ถ้ายังไม่มีคอลัมน์ ให้ fallback เงียบๆ
    // แทนที่จะทำให้ทั้ง endpoint พังจนตั้งค่า promptpay เดิมใช้ไม่ได้ไปด้วย
    let receipt_paper_size = '80mm';
    let vat_registered = false;
    let scb_biller_ref1 = '';
    try {
      const { data: rd } = await supabase
        .from('pos_configs').select('receipt_paper_size, vat_registered, scb_biller_ref1').eq('shop_id', shopId).single();
      if (rd?.receipt_paper_size) receipt_paper_size = rd.receipt_paper_size;
      vat_registered = !!rd?.vat_registered;
      scb_biller_ref1 = rd?.scb_biller_ref1 || '';
    } catch {}

    return res.json({
      ok: true,
      promptpay_id: data?.promptpay_id || '',
      has_kbank: !!(data?.kbank_api_key),
      has_scb: !!(data?.scb_api_key),
      scb_biller_id: data?.scb_biller_id || '',
      scb_biller_ref1,
      receipt_paper_size,
      vat_registered,
    });
  }

  if (req.method === 'PATCH') {
    // ตั้งค่าพร้อมเพย์/API key ธนาคาร/VAT ของร้าน — ไม่มีสิทธิ์พนักงานคนไหนควรแตะได้เลย
    // ไม่ว่าจะเปิดสิทธิ์อะไรก็ตาม (เจ้าของ/แอดมินเท่านั้น ต้องพิสูจน์ owner-session จริง)
    if (!blockAllStaffSessions(req, res, shopId)) return;

    const { promptpay_id, kbank_api_key, scb_api_key, scb_biller_id, scb_biller_ref1, receipt_paper_size, vat_registered } = req.body;

    // Biller ID (Thai QR Bill Payment, Tag 30) ต้องเป็นตัวเลขล้วน 15 หลักตามมาตรฐาน ITMX เสมอ —
    // สาเหตุที่พบบ่อยที่สุดที่ QR สแกนไม่ได้ ("QR ไม่ถูกต้อง") คือกรอกเลข "เลขอ้างอิง"/Reference
    // number ที่แอปธนาคารโชว์หน้าจอ QR ผิดตัวมาแทน (มีตัวอักษรปนด้วยบ่อยๆ เช่น "KPS004KB...")
    // ไม่ใช่ Biller ID จริงที่ต้องไปหาใน "แก้ไขข้อมูลร้านค้า"/Merchant Settings — เดิมโค้ดสร้าง QR
    // ตัดตัวอักษรทิ้งเงียบๆ แล้วเอาตัวเลขที่เหลือไปใช้ต่อ กลายเป็นเลขมั่วที่ผ่าน syntax แต่ไม่มี
    // biller จริงรองรับ ธนาคารปฏิเสธตอนสแกน — เช็คตั้งแต่ตอนบันทึกเลย กันเซฟค่าผิดเข้าระบบ
    if (scb_biller_id) {
      const digitsOnly = String(scb_biller_id).replace(/[\s-]/g, '');
      if (!/^\d+$/.test(digitsOnly)) {
        return res.status(400).json({ error: 'Biller ID ต้องเป็นตัวเลขล้วนเท่านั้น (ไม่มีตัวอักษร) — เลขที่มีตัวอักษรปน มักเป็น "เลขอ้างอิง" ที่แอปธนาคารโชว์ ไม่ใช่ Biller ID จริง ต้องไปหาในเมนู "แก้ไขข้อมูลร้านค้า"/Merchant Settings ของแอปธนาคาร' });
      }
      if (digitsOnly.length !== 15) {
        return res.status(400).json({ error: `Biller ID ต้องมี 15 หลักพอดี (กรอกมา ${digitsOnly.length} หลัก) — ถ้าไม่แน่ใจว่าเลขไหนถูก ให้ไปดูในเมนู "แก้ไขข้อมูลร้านค้า"/Merchant Settings ของแอปธนาคาร ไม่ใช่เลขที่โชว์หน้าจอ QR` });
      }
      // Reference 1 (sub-tag 02 ของ Tag 30) เป็นฟิลด์ "บังคับ" (Mandatory) ตามสเปกทางการของ
      // ธปท. (Bank of Thailand — Standardized Thai QR Code for Payment Transactions, Attachment 1
      // ตาราง 2.3: Tag 30 > Reference 1 > Presence = "M") ไม่ใช่แค่ทางเลือกเสริมแบบ Reference 2 —
      // เดิมโค้ดสร้าง QR ไม่เคยส่งค่านี้เลยสักครั้ง (ปล่อยว่างเสมอ) ทำให้ QR ที่ได้ขาดฟิลด์บังคับ
      // แอปธนาคารบางเจ้า (ยืนยันแล้วกับ K PLUS) ปฏิเสธทันทีด้วย "ข้อมูล QR/บาร์โค้ดไม่ถูกต้อง"
      // ก่อนจะถึงขั้นเช็คว่า biller มีจริงไหมด้วยซ้ำ — ค่าที่ใส่ควรเป็น "เลขอ้างอิง" ที่แอปธนาคาร
      // ของร้านโชว์คู่กับ Biller ID เองในหน้าจอ QR รับเงินของแอปธนาคาร
      if (!scb_biller_ref1 || !String(scb_biller_ref1).trim()) {
        return res.status(400).json({ error: 'ต้องกรอก "เลขอ้างอิง" (Reference 1) คู่กับ Biller ID เสมอ — เป็นฟิลด์บังคับตามมาตรฐาน ธปท. ไม่ใช่ทางเลือกเสริม ไปดูค่านี้ที่หน้าจอ "QR รับเงิน" ของแอปธนาคาร (จะโชว์คู่กับ Biller ID)' });
      }
      if (String(scb_biller_ref1).trim().length > 20) {
        return res.status(400).json({ error: 'เลขอ้างอิง (Reference 1) ต้องไม่เกิน 20 ตัวอักษร' });
      }
    }

    const updates = {};
    if (promptpay_id !== undefined) updates.promptpay_id = promptpay_id || null;
    if (kbank_api_key !== undefined) updates.kbank_api_key = kbank_api_key || null;
    if (scb_api_key !== undefined)  updates.scb_api_key  = scb_api_key || null;
    if (scb_biller_id !== undefined) updates.scb_biller_id = scb_biller_id || null;

    if (Object.keys(updates).length) {
      const { error } = await supabase.from('pos_configs').update(updates).eq('shop_id', shopId);
      if (error) return res.status(500).json({ error: error.message });
    }

    // แยกอัปเดตคอลัมน์เหล่านี้ต่างหาก + กันพัง — ถ้ายังไม่ได้รัน ALTER TABLE (ดู CLAUDE.md)
    // จะ error เงียบๆ ไม่ทำให้การตั้งค่าอื่นด้านบนเซฟไม่ได้ไปด้วย
    if (receipt_paper_size !== undefined) {
      try {
        await supabase.from('pos_configs').update({ receipt_paper_size: receipt_paper_size || '80mm' }).eq('shop_id', shopId);
      } catch {}
    }
    if (vat_registered !== undefined) {
      try {
        await supabase.from('pos_configs').update({ vat_registered: !!vat_registered }).eq('shop_id', shopId);
      } catch {}
    }
    if (scb_biller_ref1 !== undefined) {
      try {
        await supabase.from('pos_configs').update({ scb_biller_ref1: scb_biller_ref1 ? String(scb_biller_ref1).trim() : null }).eq('shop_id', shopId);
      } catch {}
    }

    return res.json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
