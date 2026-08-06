import { createClient } from '@supabase/supabase-js';
import { deleteShopCompletely } from '../../../lib/shop-deletion';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

function verifyAdmin(req) {
  const token = req.headers['x-admin-token'];
  if (!token) return false;
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    return decoded.startsWith('smileslip-admin:');
  } catch { return false; }
}

async function upsertCredits(shopId, balance) {
  const { error } = await supabase
    .from('shop_credits')
    .upsert({ shop_id: shopId, balance_credits: balance, updated_at: new Date().toISOString() },
            { onConflict: 'shop_id' });
  if (error) throw new Error('upsertCredits: ' + error.message);
}

export default async function handler(req, res) {
  if (!verifyAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  if (req.method !== 'POST') return res.status(405).end();

  const { action, shopId, value, currentCredits, expiresAt } = req.body;
  if (!action || !shopId) return res.status(400).json({ error: 'ข้อมูลไม่ครบ' });

  try {
    // ── เปลี่ยน Tier (+ วันหมดอายุ ถ้าระบุมา) ──
    if (action === 'update_tier') {
      const updates = { subscription_tier: value };
      if (expiresAt !== undefined) updates.subscription_expires_at = expiresAt || null;
      await supabase.from('shop_profiles').update(updates).eq('id', shopId);
      return res.status(200).json({ success: true });
    }

    // ── เปลี่ยน Tier + เติมเครดิตตาม plan (manual payment) + วันหมดอายุ ──
    if (action === 'manual_assign_tier') {
      const TIER_CREDITS = { normal: 0, pro: 200, advance: 500, business: 1000, enterprise: 0, super: 0 };
      const plan = value;
      const updates = { subscription_tier: plan };
      if (expiresAt !== undefined) updates.subscription_expires_at = expiresAt || null;
      await supabase.from('shop_profiles').update(updates).eq('id', shopId);
      const addCredits = TIER_CREDITS[plan] ?? 0;
      if (addCredits > 0) {
        const cur = parseInt(currentCredits) || 0;
        await upsertCredits(shopId, cur + addCredits);
        return res.status(200).json({ success: true, creditsAdded: addCredits, newTotal: cur + addCredits });
      }
      return res.status(200).json({ success: true, creditsAdded: 0 });
    }

    // ── ตั้ง/ล้างวันหมดอายุเฉยๆ (ไม่เปลี่ยน tier) ──
    if (action === 'set_expiry') {
      await supabase.from('shop_profiles')
        .update({ subscription_expires_at: expiresAt || null })
        .eq('id', shopId);
      return res.status(200).json({ success: true });
    }

    // ── เติมเครดิต ──
    if (action === 'add_credits') {
      const amount = parseInt(value);
      if (isNaN(amount) || amount <= 0) return res.status(400).json({ error: 'จำนวนไม่ถูกต้อง' });
      const newTotal = (parseInt(currentCredits) || 0) + amount;
      await upsertCredits(shopId, newTotal);
      return res.status(200).json({ success: true, newTotal });
    }

    // ── ตั้งเครดิต ──
    if (action === 'set_credits') {
      const amount = parseInt(value);
      if (isNaN(amount) || amount < 0) return res.status(400).json({ error: 'จำนวนไม่ถูกต้อง' });
      await upsertCredits(shopId, amount);
      return res.status(200).json({ success: true, newTotal: amount });
    }

    // ── เพิ่ม Shop Admin โดยตรง (admin panel ใส่ LINE ID เอง) ──
    if (action === 'add_shop_admin') {
      const { lineUserId, displayName } = req.body;
      if (!lineUserId) return res.status(400).json({ error: 'กรอก LINE User ID' });
      const { error } = await supabase.from('shop_admins').upsert({
        shop_id: shopId,
        line_user_id: lineUserId,
        display_name: displayName || null,
        status: 'approved',
      }, { onConflict: 'shop_id,line_user_id' });
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ success: true });
    }

    // ── ลบ Shop Admin ──
    if (action === 'remove_shop_admin') {
      const { adminRowId } = req.body;
      await supabase.from('shop_admins').delete().eq('id', adminRowId).eq('shop_id', shopId);
      return res.status(200).json({ success: true });
    }

    // ── แก้ไขข้อมูลร้านค้า ──
    if (action === 'update_profile') {
      const { shopName, email, phone, taxId, address, userType } = req.body;
      const updates = {};
      if (shopName  !== undefined) updates.shop_name  = shopName;
      if (email     !== undefined) updates.email      = email;
      if (phone     !== undefined) updates.phone      = phone;
      if (taxId     !== undefined) updates.tax_id     = taxId;
      if (address   !== undefined) updates.address    = address;
      if (userType  !== undefined) updates.user_type  = userType;
      const { error } = await supabase.from('shop_profiles').update(updates).eq('id', shopId);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ success: true });
    }

    // ── ลบร้านค้า ──
    // ใช้ deleteShopCompletely() ตัวเดียวกับที่ /api/shop/delete-shop.js (ฝั่งลูกค้าลบร้านตัวเอง)
    // ใช้อยู่แล้ว — เดิมไฟล์นี้มี logic ลบแยกของตัวเอง ลบแค่ 5 ตาราง ไม่ยกเลิก Stripe subscription
    // เลย (ลูกค้าที่ยังมี subscription active จะโดนเก็บเงินต่อไปเรื่อยๆ ทั้งที่ร้านถูกแอดมินลบไปแล้ว)
    // และไม่เคยอัปเดตตามหลังระบบ POS ถูกสร้างขึ้น (ข้อมูล POS ทั้งหมดของร้านจะค้างอยู่ในระบบตลอดไป)
    if (action === 'delete_shop') {
      const result = await deleteShopCompletely(shopId);
      if (result.notFound) return res.status(404).json({ error: 'ไม่พบร้านค้านี้' });
      return res.status(200).json({ success: true, stripeCancelWarning: result.stripeCancelWarning });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('Admin update error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
