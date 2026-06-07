import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const hashPassword = (password) => {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    shopName, taxId, branch, phone, email, password,
    addressDetail, subDistrict, district, province, postalCode,
    bankName, bankAccountName, bankAccountNumber, bankAccountType,
    userType, lineUserId
  } = req.body;

  if (!shopName || !email || !phone || !lineUserId) {
    return res.status(400).json({ error: 'ข้อมูลไม่ครบถ้วน กรุณากรอกใหม่อีกครั้ง' });
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

    const fullAddress = `${addressDetail} ต.${subDistrict} อ.${district} จ.${province} ${postalCode}`;
    const passwordHash = password ? hashPassword(password) : null;

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
        password_hash: passwordHash
      }])
      .select()
      .single();

    if (insertError) throw insertError;

    // เครดิตเริ่มต้น 20 แผ่น
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

    return res.status(200).json({ success: true, shopId: newShop.id });

  } catch (err) {
    console.error('Registration error:', err.message);
    // ถ้า password_hash column ยังไม่มีใน DB ให้ลองใหม่โดยไม่บันทึก password
    if (err.message?.includes('password_hash')) {
      try {
        const fullAddress = `${addressDetail} ต.${subDistrict} อ.${district} จ.${province} ${postalCode}`;
        const { data: newShop, error } = await supabase
          .from('shop_profiles')
          .insert([{ shop_name: shopName, owner_line_id: lineUserId, tax_id: taxId || null, branch_name: branch || 'สำนักงานใหญ่', address: fullAddress, email, phone, user_type: userType }])
          .select().single();
        if (error) throw error;
        await supabase.from('shop_credits').insert([{ shop_id: newShop.id, balance_credits: 20 }]);
        if (bankName && bankAccountNumber && bankAccountName) {
          await supabase.from('shop_bank_accounts').insert([{ shop_id: newShop.id, bank_name: bankName, account_name: bankAccountName, account_number: bankAccountNumber, account_type: bankAccountType || 'ออมทรัพย์' }]);
        }
        return res.status(200).json({ success: true, shopId: newShop.id, warning: 'password_hash column missing — please add it to Supabase' });
      } catch (fallbackErr) {
        return res.status(500).json({ error: `บันทึกไม่สำเร็จ: ${fallbackErr.message}` });
      }
    }
    return res.status(500).json({ error: `บันทึกไม่สำเร็จ: ${err.message}` });
  }
}
