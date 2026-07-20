/**
 * ตรวจสอบว่าร้านค้ายังเขียนข้อมูลได้อยู่ไหม (30-Day Free Trial Lock Mechanism — เพิ่ม 2026-07-20)
 * เรียกใช้ที่ต้นทุก POST/PUT/PATCH ของ POS API — ถ้าหมดเวลาทดลองใช้แล้วและยังไม่มี subscription
 * จริง ให้ปฏิเสธการเขียนข้อมูล (ข้อมูลเดิมใน Google Sheets/Drive ของร้านยังอ่านได้ปกติเสมอ ไม่แตะ)
 *
 * Fail-safe เสมอ: ถ้าคอลัมน์ status ยังไม่ถูกสร้าง (รอรัน SQL) หรือ query ผิดพลาดใดๆ ให้ถือว่า
 * "เขียนได้" เสมอ (ไม่ล็อกใครโดยไม่ตั้งใจ) — ความเสี่ยงฝั่งนี้ปลอดภัยกว่าการบล็อกลูกค้าจริงผิดคน
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

export async function isShopWritable(shopId) {
  try {
    const { data, error } = await supabase
      .from('shop_profiles')
      .select('status')
      .eq('id', shopId)
      .maybeSingle();
    if (error || !data) return true; // คอลัมน์ยังไม่มี/หา shop ไม่เจอ — fail-safe เปิดให้เขียนได้
    return data.status !== 'trial_expired';
  } catch {
    return true;
  }
}

// เรียกใช้ต้น handler ของ endpoint ที่ต้องกันการเขียนตอน trial หมดอายุ
// คืน true ถ้าถูกบล็อกแล้ว (เขียน error response ให้เลย ไม่ต้องทำอะไรต่อ)
export async function blockIfTrialExpired(req, res, shopId) {
  if (!(await isShopWritable(shopId))) {
    res.status(403).json({
      error: 'ระยะเวลาทดลองใช้ฟรี 30 วันหมดอายุแล้ว กรุณาอัปเกรดแพ็กเกจเพื่อใช้งานต่อ (ข้อมูลเดิมของร้านยังอยู่ครบใน Google Sheets/Drive ไม่มีการสูญหาย)',
      trialExpired: true,
    });
    return true;
  }
  return false;
}
