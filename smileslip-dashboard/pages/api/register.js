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
