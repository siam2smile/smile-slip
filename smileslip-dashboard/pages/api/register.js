import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

// ต้องอัปเดตให้ตรงกับเวอร์ชันที่แสดงใน pages/terms.js และ pages/privacy.js เสมอ
const CURRENT_TERMS_VERSION = '1.2.0';

const hashPassword = (password) => {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
};

// สร้างรหัสแนะนำเพื่อน เช่น SMILE-AB3X
const generateReferralCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ตัดตัวที่สับสน (0,O,1,I)
  let code = 'SMILE-';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    shopName, taxId, branch, phone, email, password,
    addressDetail, subDistrict, district, province, postalCode,
    bankName, bankAccountName, bankAccountNumber, bankAccountType,
    userType, lineUserId,
    referralCode,       // รหัสแนะนำเพื่อนที่ได้รับมา (จาก ?ref=SMILE-XXXX)
    termsAccepted,      // ต้องติ๊กยอมรับเงื่อนไข/นโยบายความเป็นส่วนตัวก่อนสมัครเสมอ
  } = req.body;

  if (!shopName || !email || !phone || !lineUserId) {
    return res.status(400).json({ error: 'ข้อมูลไม่ครบถ้วน กรุณากรอกใหม่อีกครั้ง' });
  }
  if (!termsAccepted) {
    return res.status(400).json({ error: 'กรุณายอมรับเงื่อนไขการใช้บริการและนโยบายความเป็นส่วนตัวก่อนสมัครครับ' });
  }

  try {
    // ตรวจสอบเบอร์โทรซ้ำ
    const { data: existingPhone } = await supabase
      .from('shop_profiles').select('id').eq('phone', phone).maybeSingle();
    if (existingPhone) return res.status(400).json({ error: 'เบอร์โทรศัพท์นี้ถูกใช้งานแล้ว กรุณาตรวจสอบอีกครั้ง' });

    // ตรวจสอบอีเมลซ้ำ
    const { data: existingEmail } = await supabase
      .from('shop_profiles').select('id').eq('email', email).maybeSingle();
    if (existingEmail) return res.status(400).json({ error: 'อีเมลนี้ถูกใช้งานแล้ว กรุณาใช้อีเมลอื่น' });

    // ตรวจสอบ referral code ว่ามีจริงไหม
    let referredByCode = null;
    if (referralCode) {
      const { data: referrer } = await supabase
        .from('shop_profiles').select('id').eq('referral_code', referralCode.toUpperCase()).maybeSingle();
      if (referrer) referredByCode = referralCode.toUpperCase();
    }

    const fullAddress = `${addressDetail} ต.${subDistrict} อ.${district} จ.${province} ${postalCode}`;
    const passwordHash = password ? hashPassword(password) : null;

    // สร้าง referral code ของร้านใหม่นี้ (unique)
    let myReferralCode;
    let codeAttempts = 0;
    do {
      myReferralCode = generateReferralCode();
      const { data: codeExists } = await supabase
        .from('shop_profiles').select('id').eq('referral_code', myReferralCode).maybeSingle();
      if (!codeExists) break;
      codeAttempts++;
    } while (codeAttempts < 10);

    // บันทึก shop_profiles
    const { data: newShop, error: insertError } = await supabase
      .from('shop_profiles')
      .insert([{
        shop_name: shopName,
        owner_line_id: lineUserId,
        tax_id: taxId || null,
        branch_name: branch || 'สำนักงานใหญ่',
        address: fullAddress,
        email,
        phone,
        user_type: userType,
        password_hash: passwordHash,
        referral_code: myReferralCode,
        referred_by: referredByCode,
        terms_accepted_at: new Date().toISOString(),
        terms_version_accepted: CURRENT_TERMS_VERSION,
      }])
      .select()
      .single();

    if (insertError) throw insertError;

    // แยกอัปเดต district/province ต่างหาก + กันพัง — ถ้ายังไม่ได้รัน ALTER TABLE (ดู CLAUDE.md)
    // จะ error เงียบๆ ไม่ทำให้การสมัครสมาชิกหลักล้มเหลวไปด้วย (แบบเดียวกับ pattern receipt_paper_size/vat_registered)
    if (district || province) {
      try {
        await supabase.from('shop_profiles').update({ district: district || null, province: province || null }).eq('id', newShop.id);
      } catch {}
    }

    // ตั้งค่า trial 30 วันสำหรับร้านใหม่เท่านั้น (ร้านเก่าก่อนหน้านี้จะไม่มีค่านี้เลย = ยกเว้นตลอดไป
    // ตามที่ผู้ใช้ตัดสินใจไว้ — ดู CLAUDE.md เรื่อง 30-Day Free Trial) — แยก update ต่างหากกันพัง
    // เหมือน district/province ถ้ายังไม่ได้รัน SQL เพิ่มคอลัมน์
    //
    // ป้องกันการลบร้านแล้วสมัครใหม่เพื่อขอทดลองฟรี 30 วันซ้ำไม่จำกัดรอบ (ผู้ใช้ยืนยันชัดเจนว่า
    // ต้องปิดช่องโหว่นี้ — trial_used_line_ids แยกตารางจาก shop_profiles โดยเจตนา เพื่อให้
    // "ประวัติเคยใช้สิทธิ์ทดลองแล้ว" อยู่รอดต่อไปแม้ร้านจะถูกลบทิ้งทั้งหมด) — เช็คก่อนเสมอว่า
    // ไลไอดีนี้เคยได้ trial มาก่อนหรือยัง (ไม่ว่าจะร้านนี้หรือร้านอื่นที่เคยสมัคร/ลบไปแล้ว)
    let trialAlreadyUsed = false;
    try {
      const { data: usedRow } = await supabase
        .from('trial_used_line_ids')
        .select('line_user_id')
        .eq('line_user_id', lineUserId)
        .maybeSingle();
      trialAlreadyUsed = !!usedRow;
    } catch { /* ตาราง trial_used_line_ids ยังไม่ถูกสร้าง — ถือว่ายังไม่เคยใช้ (ปลอดภัยสุดเท่าที่ทำได้ก่อนรัน SQL) */ }

    try {
      if (trialAlreadyUsed) {
        // เคยใช้สิทธิ์ทดลองไปแล้ว (จากร้านเดิมที่อาจถูกลบไปแล้ว) — ไม่ให้ trial ใหม่
        // ตั้ง status ตรงๆ เป็น trial_expired (ไม่ใช่ปล่อย trial_started_at/trial_ends_at เป็น NULL
        // เพราะ NULL ในระบบนี้แปลว่า "ร้านเก่าก่อนยุค trial ได้รับการยกเว้นตลอดไป" ซึ่งตรงข้ามกับที่ต้องการ)
        await supabase.from('shop_profiles').update({ status: 'trial_expired' }).eq('id', newShop.id);
      } else {
        const trialStart = new Date();
        const trialEnd = new Date(trialStart.getTime() + 30 * 24 * 60 * 60 * 1000);
        await supabase.from('shop_profiles').update({
          trial_started_at: trialStart.toISOString(),
          trial_ends_at: trialEnd.toISOString(),
        }).eq('id', newShop.id);
      }
    } catch {}

    // บันทึกว่าไลไอดีนี้ใช้สิทธิ์ทดลอง (หรือพยายามสมัคร) ไปแล้ว — upsert เสมอทุกครั้งที่สมัคร
    // (ไม่ว่าจะเป็นการสมัครครั้งแรกหรือครั้งต่อไป) กันได้ trial ซ้ำแม้จะยังไม่เคยลบร้านเลยก็ตาม
    // (สมัครร้านที่สองแยกต่างหากโดยไม่ลบร้านแรก ก็จะไม่ได้ trial ใหม่เช่นกัน — เป็นนโยบายที่ตั้งใจ)
    try {
      await supabase.from('trial_used_line_ids').upsert(
        { line_user_id: lineUserId },
        { onConflict: 'line_user_id', ignoreDuplicates: true }
      );
    } catch {}

    // เครดิตเริ่มต้น 20 แผ่น (ถ้ามี referral จะได้โบนัสเพิ่มอีก 30 หลัง Google connect)
    await supabase.from('shop_credits').insert([{ shop_id: newShop.id, balance_credits: 20 }]);

    // บันทึกบัญชีธนาคาร (ถ้ากรอก)
    if (bankName && bankAccountNumber && bankAccountName) {
      await supabase.from('shop_bank_accounts').insert([{
        shop_id: newShop.id,
        bank_name: bankName,
        account_name: bankAccountName,
        account_number: bankAccountNumber,
        account_type: bankAccountType || 'ออมทรัพย์'
      }]);
    }

    return res.status(200).json({
      success: true,
      shopId: newShop.id,
      referralCode: myReferralCode,
    });

  } catch (err) {
    console.error('Registration error:', err.message);
    if (err.message?.includes('password_hash') || err.message?.includes('referral_code') || err.message?.includes('referred_by')) {
      // fallback: ลองใหม่โดยไม่มี column ที่ยังไม่ได้สร้าง
      try {
        const fullAddress = `${addressDetail} ต.${subDistrict} อ.${district} จ.${province} ${postalCode}`;
        const { data: newShop, error } = await supabase
          .from('shop_profiles')
          .insert([{ shop_name: shopName, owner_line_id: lineUserId, tax_id: taxId || null, branch_name: branch || 'สำนักงานใหญ่', address: fullAddress, email, phone, user_type: userType, terms_accepted_at: new Date().toISOString(), terms_version_accepted: CURRENT_TERMS_VERSION }])
          .select().single();
        if (error) throw error;
        await supabase.from('shop_credits').insert([{ shop_id: newShop.id, balance_credits: 20 }]);
        if (bankName && bankAccountNumber && bankAccountName) {
          await supabase.from('shop_bank_accounts').insert([{ shop_id: newShop.id, bank_name: bankName, account_name: bankAccountName, account_number: bankAccountNumber, account_type: bankAccountType || 'ออมทรัพย์' }]);
        }
        return res.status(200).json({ success: true, shopId: newShop.id, warning: 'Referral columns missing — please run SQL migration' });
      } catch (fallbackErr) {
        return res.status(500).json({ error: `บันทึกไม่สำเร็จ: ${fallbackErr.message}` });
      }
    }
    return res.status(500).json({ error: `บันทึกไม่สำเร็จ: ${err.message}` });
  }
}
