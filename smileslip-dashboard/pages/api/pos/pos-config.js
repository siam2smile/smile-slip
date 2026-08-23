/**
 * GET  /api/pos/pos-config?shopId=xxx  → อ่านการตั้งค่า POS
 * PATCH /api/pos/pos-config { shopId, promptpay_id, kbank_api_key, scb_api_key, scb_biller_id, receipt_paper_size, vat_registered, receipt_footer_message, receipt_line_url, receipt_logo_data, loyalty_enabled, loyalty_baht_per_point, loyalty_expiry_months, promo_advertise_on_receipt }
 * (staff_pin ร้านเดียวใช้ร่วมกันแบบเดิมยกเลิกไปแล้ว — ดู api/pos/staff.js + staff-setpin.js สำหรับ PIN รายบุคคล)
 */
import { createClient } from '@supabase/supabase-js';
import { blockIfTrialExpired } from '../../../lib/shop-access';
import { blockAllStaffSessions } from '../../../lib/pos-auth';
import { requireOwnerOrStaffAuth } from '../../../lib/owner-auth';

// โลโก้หัวใบเสร็จเก็บเป็น data URL (base64) ตรงในคอลัมน์เอง ไม่ใช่ลิงก์ Google Drive — ตั้งใจ
// เพราะ (1) ใช้ได้แม้ร้านยังไม่เชื่อมต่อ Google Drive เลย (2) ไม่มีความเสี่ยง CORS/tainted-canvas
// ตอนวาดลง canvas สำหรับพิมพ์ผ่าน Bluetooth (ต่างจากรูปที่โหลดจาก Drive ข้าม origin) — ฝั่งเว็บ
// ย่อรูปเหลือ ~300px ก่อนแปลงเป็น data URL อยู่แล้วเสมอ แต่กันไว้อีกชั้นฝั่ง server (จำกัด ~1.5MB)
const MAX_LOGO_DATA_LENGTH = 1_500_000;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

// ค่า default 1mb ของ Next.js ไม่พอสำหรับ payload ที่มีโลโก้ (data URL base64) แนบมาด้วย
export const config = { api: { bodyParser: { sizeLimit: '2mb' } } };

export default async function handler(req, res) {
  const shopId = req.query.shopId || req.body?.shopId;
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });

  // เขียนไม่ได้ถ้าทดลองใช้ 30 วันหมดอายุแล้ว (อ่าน/GET ยังทำได้ปกติเสมอ)
  if (req.method !== 'GET' && (await blockIfTrialExpired(req, res, shopId))) return;


  if (req.method === 'GET') {
    // คืน kbank_api_key/scb_api_key ตรงๆ (credential ธนาคารจริง) — เดิม enforce:false (chicken-and-egg
    // เดียวกับ shop/data.js เพราะเรียกซิงโครนัสตอนโหลดหน้าครั้งแรกใน pos.js's loadShopBody() ก่อน
    // fetch-override จะติดตั้งเสร็จ) — แก้แล้วฝั่งเว็บ (fetchPosConfig แนบ token เองจาก sid ที่เป็น
    // local variable ไม่ต้องรอ override) จึงปิด enforce:true ได้จริง — requireOwnerOrStaffAuth
    // (ไม่ใช่ requireOwnerAuth เฉยๆ) เพราะ endpoint นี้ถูกเรียกจาก loadShopBody() ทั้งเส้นทางเจ้าของ
    // ร้านและเส้นทางแคชเชียร์ (staff-session) ร่วมกัน — แคชเชียร์ต้องเห็นค่าตั้งค่า VAT/Biller ID/
    // ขนาดกระดาษใบเสร็จเพื่อใช้ตอน checkout
    if (!requireOwnerOrStaffAuth(req, res, shopId, { enforce: true })) return;

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
    // payroll_days_off_per_month — เพิ่ม 2026-08-10 แทนที่ payroll_days_off_per_week เดิม (สูตร
    // เดิมคูณจากอัตราต่อสัปดาห์ ผิดสมมติฐาน ธุรกิจจริงหลายเจ้าให้วันหยุดเป็นโควตารายเดือนแบบยืดหยุ่น
    // เลือกวันไหนก็ได้ ไม่ผูกกับรอบสัปดาห์เลย) default 6 ตรงกับนโยบายจริงของร้านที่ทำให้พบปัญหานี้
    let payroll_days_off_per_month = 6;
    // ปรับแต่งท้ายใบเสร็จ — เพิ่ม 2026-08-13 (ผู้ใช้ขอหลังทดสอบพิมพ์ Bluetooth สำเร็จ): ข้อความ
    // ขอบคุณ/โปรโมชั่นที่ร้านกำหนดเอง + QR ไลน์ของร้าน — ใช้ร่วมกันทั้งปุ่ม "พิมพ์ใบเสร็จ" (window.print)
    // และ "พิมพ์ (Bluetooth)" (ESC/POS raster)
    let receipt_footer_message = '';
    let receipt_line_url = '';
    let receipt_logo_data = '';
    // แต้มสะสม — เพิ่ม 2026-08-23 (ข้อ 102): loyalty_baht_per_point คืออัตราเริ่มต้นของร้าน
    // (กี่บาทต่อ 1 แต้ม) แยกจากอัตราต่อสินค้า (pos_products.loyalty_baht_per_point) ที่ override
    // เฉพาะรายตัวได้ — loyalty_expiry_months null/0 = ไม่หมดอายุ
    let loyalty_enabled = false;
    let loyalty_baht_per_point = null;
    let loyalty_expiry_months = null;
    // ข้อ 4/4 (โฆษณาโปรโมชั่นในใบเสร็จ) — เปิดไว้ = ทุกใบเสร็จที่พิมพ์แสดงลิสต์โปรที่ active อยู่ตอนนี้
    // (เฉพาะโปรที่ติ๊ก show_on_receipt ในตัวโปรเอง — ดู promotions.js) ไม่ว่าบิลนั้นจะใช้โปรหรือไม่ —
    // ปิดไว้ = โชว์เฉพาะโปรที่ใช้จริงในบิลนั้นเท่านั้น (default false กันใบเสร็จรกถ้าไม่ได้ตั้งใจเปิด)
    let promo_advertise_on_receipt = false;
    try {
      const { data: rd } = await supabase
        .from('pos_configs').select('receipt_paper_size, vat_registered, scb_biller_ref1, payroll_days_off_per_month, receipt_footer_message, receipt_line_url, receipt_logo_data, loyalty_enabled, loyalty_baht_per_point, loyalty_expiry_months, promo_advertise_on_receipt').eq('shop_id', shopId).single();
      if (rd?.receipt_paper_size) receipt_paper_size = rd.receipt_paper_size;
      vat_registered = !!rd?.vat_registered;
      scb_biller_ref1 = rd?.scb_biller_ref1 || '';
      if (rd?.payroll_days_off_per_month !== null && rd?.payroll_days_off_per_month !== undefined) {
        payroll_days_off_per_month = Number(rd.payroll_days_off_per_month);
      }
      receipt_footer_message = rd?.receipt_footer_message || '';
      receipt_line_url = rd?.receipt_line_url || '';
      receipt_logo_data = rd?.receipt_logo_data || '';
      loyalty_enabled = !!rd?.loyalty_enabled;
      loyalty_baht_per_point = rd?.loyalty_baht_per_point != null ? Number(rd.loyalty_baht_per_point) : null;
      loyalty_expiry_months = rd?.loyalty_expiry_months != null ? Number(rd.loyalty_expiry_months) : null;
      promo_advertise_on_receipt = !!rd?.promo_advertise_on_receipt;
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
      payroll_days_off_per_month,
      receipt_footer_message,
      receipt_line_url,
      receipt_logo_data,
      loyalty_enabled,
      loyalty_baht_per_point,
      loyalty_expiry_months,
      promo_advertise_on_receipt,
    });
  }

  if (req.method === 'PATCH') {
    // ตั้งค่าพร้อมเพย์/API key ธนาคาร/VAT ของร้าน — ไม่มีสิทธิ์พนักงานคนไหนควรแตะได้เลย
    // ไม่ว่าจะเปิดสิทธิ์อะไรก็ตาม (เจ้าของ/แอดมินเท่านั้น ต้องพิสูจน์ owner-session จริง)
    if (!blockAllStaffSessions(req, res, shopId)) return;

    const { promptpay_id, kbank_api_key, scb_api_key, scb_biller_id, scb_biller_ref1, receipt_paper_size, vat_registered, payroll_days_off_per_month, receipt_footer_message, receipt_line_url, receipt_logo_data, loyalty_enabled, loyalty_baht_per_point, loyalty_expiry_months, promo_advertise_on_receipt } = req.body;

    if (loyalty_baht_per_point !== undefined && loyalty_baht_per_point !== null && loyalty_baht_per_point !== '' && !(parseFloat(loyalty_baht_per_point) > 0)) {
      return res.status(400).json({ error: 'อัตราแต้มสะสม (บาทต่อแต้ม) ต้องมากกว่า 0' });
    }
    if (loyalty_expiry_months !== undefined && loyalty_expiry_months !== null && loyalty_expiry_months !== '' && !(parseInt(loyalty_expiry_months) >= 0)) {
      return res.status(400).json({ error: 'จำนวนเดือนหมดอายุแต้มไม่ถูกต้อง' });
    }

    if (receipt_logo_data && receipt_logo_data.length > MAX_LOGO_DATA_LENGTH) {
      return res.status(400).json({ error: 'ไฟล์โลโก้ใหญ่เกินไป กรุณาใช้รูปที่มีขนาดเล็กลง' });
    }
    if (receipt_logo_data && !/^data:image\/(png|jpeg|jpg|webp);base64,/.test(receipt_logo_data)) {
      return res.status(400).json({ error: 'รูปแบบไฟล์โลโก้ไม่ถูกต้อง' });
    }

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
    if (payroll_days_off_per_month !== undefined) {
      try {
        await supabase.from('pos_configs').update({ payroll_days_off_per_month: Math.max(0, parseFloat(payroll_days_off_per_month) || 0) }).eq('shop_id', shopId);
      } catch {}
    }
    if (receipt_footer_message !== undefined) {
      try {
        await supabase.from('pos_configs').update({ receipt_footer_message: receipt_footer_message ? String(receipt_footer_message).slice(0, 500) : null }).eq('shop_id', shopId);
      } catch {}
    }
    if (receipt_line_url !== undefined) {
      try {
        await supabase.from('pos_configs').update({ receipt_line_url: receipt_line_url ? String(receipt_line_url).trim().slice(0, 300) : null }).eq('shop_id', shopId);
      } catch {}
    }
    if (receipt_logo_data !== undefined) {
      try {
        await supabase.from('pos_configs').update({ receipt_logo_data: receipt_logo_data || null }).eq('shop_id', shopId);
      } catch {}
    }
    if (loyalty_enabled !== undefined) {
      try {
        await supabase.from('pos_configs').update({ loyalty_enabled: !!loyalty_enabled }).eq('shop_id', shopId);
      } catch {}
    }
    if (loyalty_baht_per_point !== undefined) {
      try {
        await supabase.from('pos_configs').update({ loyalty_baht_per_point: loyalty_baht_per_point ? parseFloat(loyalty_baht_per_point) : null }).eq('shop_id', shopId);
      } catch {}
    }
    if (loyalty_expiry_months !== undefined) {
      try {
        await supabase.from('pos_configs').update({ loyalty_expiry_months: loyalty_expiry_months !== '' && loyalty_expiry_months !== null ? parseInt(loyalty_expiry_months) : null }).eq('shop_id', shopId);
      } catch {}
    }
    if (promo_advertise_on_receipt !== undefined) {
      try {
        await supabase.from('pos_configs').update({ promo_advertise_on_receipt: !!promo_advertise_on_receipt }).eq('shop_id', shopId);
      } catch {}
    }

    return res.json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
