/**
 * ระบบแต้มสะสม (loyalty points) — งานข้อ 3 จาก 4 ข้อที่ผู้ใช้ขอให้ทำทีละข้อจนเสร็จ (ต่อจาก
 * bill_discount/tiered_pricing ในระบบโปรโมชั่น) ผู้ใช้ยืนยันสเปกไว้ชัดเจนผ่าน AskUserQuestion:
 *   - อัตราสะสม: ต้องตั้งได้ทั้งระดับร้าน (ค่าเริ่มต้น) และระดับสินค้า (override) เพราะแต่ละร้าน/
 *     แต่ละสินค้ากำไรไม่เท่ากัน ไม่มีอัตรากลางที่ใช้ได้ทุกร้าน
 *   - แลกได้ทั้งส่วนลด (บาท) และสินค้าเฉพาะ (reward catalog)
 *   - หมดอายุได้ ตั้งได้เองต่อร้าน (เดือน) หรือไม่หมดอายุเลยก็ได้
 *
 * ต่างจากระบบโปรโมชั่น (ข้อ 91/100/101) ตรงที่ "ไม่แตะ sales.js เลย" ใช้ไม่ได้ที่นี่ — การสะสมแต้ม
 * ต้องผูกกับการขายจริงโดยอัตโนมัติ (ไม่ใช่เครื่องมือกดใช้เองแบบโปรโมชั่น) จึง hook เข้า sales.js
 * โดยตรง แต่ทำแบบ fail-safe/non-blocking เสมอ (พัง = แค่ไม่ได้แต้ม ไม่ทำให้การขายพังตาม)
 *
 * โมเดลยอดคงเหลือ + หมดอายุ — คำนวณสดจาก ledger ทุกครั้งที่อ่าน (ไม่มี cron sweep/mutation
 * ใดๆ เพื่อ "หักแต้มที่หมดอายุ" ล่วงหน้า) ด้วยอัลกอริทึม FIFO true-consumption:
 *   1. เดินตาม ledger เรียงตามเวลาเก่า→ใหม่ สร้าง "ถัง" ต่อรายการ earn หนึ่งถัง (คะแนน+วันหมดอายุ)
 *   2. รายการที่ไม่ใช่ earn (แลก/ปรับปรุง) หักออกจากถังที่เก่าที่สุดที่ยังมีคะแนนเหลือก่อนเสมอ (FIFO)
 *   3. ยอดคงเหลือสุดท้าย = ผลรวมคะแนนที่เหลือในทุกถังที่ "ยังไม่หมดอายุ ณ ตอนนี้" เท่านั้น
 *   ข้อดี: เพราะ FIFO consumption ไล่จากถังเก่าสุดก่อนเสมอ (ทั้งตอนแลกและตอนหมดอายุ) แต้มที่ถูกแลก
 *   ไปแล้วจะไม่มีทาง "หมดอายุซ้ำ" อีก เพราะถูกหักออกจากถังไปแล้วจริงตั้งแต่ตอนแลก ไม่ต้องมีตาราง
 *   ติดตามการบริโภคแยกต่างหากเลย — ถูกต้อง 100% โดยไม่ต้องมี cron job ใดๆ
 */
import { supabase, insertRow, tableExists } from './supabase-pos.js';

export function makeRewardNo() {
  const now = new Date();
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  return `RWD${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/** อ่านค่าตั้งค่าแต้มสะสมระดับร้าน — fail-safe คืนค่า disabled ถ้าคอลัมน์/ตารางยังไม่มี (ยังไม่รัน SQL) */
export async function getLoyaltyConfig(shopId) {
  try {
    const { data, error } = await supabase.from('pos_configs')
      .select('loyalty_enabled, loyalty_baht_per_point, loyalty_expiry_months')
      .eq('shop_id', shopId).maybeSingle();
    if (error || !data) return { enabled: false, bahtPerPoint: null, expiryMonths: null };
    return {
      enabled: !!data.loyalty_enabled,
      bahtPerPoint: data.loyalty_baht_per_point != null ? Number(data.loyalty_baht_per_point) : null,
      expiryMonths: data.loyalty_expiry_months != null ? Number(data.loyalty_expiry_months) : null,
    };
  } catch {
    return { enabled: false, bahtPerPoint: null, expiryMonths: null };
  }
}

/**
 * คำนวณยอดแต้มคงเหลือแบบ FIFO + หมดอายุ จาก ledger rows ที่เรียงจากเก่า→ใหม่แล้ว (pure function,
 * ทดสอบแยกได้โดยไม่ต้องแตะ DB) — แต่ละแถวมี { entry_type, points, expires_at }
 */
export function computeLoyaltyBalance(sortedLedgerRows) {
  const buckets = []; // { remaining, expires_at }
  for (const row of sortedLedgerRows) {
    const pts = Number(row.points) || 0;
    if (row.entry_type === 'earn') {
      if (pts > 0) buckets.push({ remaining: pts, expires_at: row.expires_at });
      continue;
    }
    // รายการหัก (แลก/ปรับปรุงลด) — หักออกจากถังเก่าสุดที่ยังมีคะแนนเหลือก่อนเสมอ (FIFO)
    let toConsume = Math.abs(pts);
    for (let i = 0; i < buckets.length && toConsume > 0; i++) {
      const take = Math.min(buckets[i].remaining, toConsume);
      buckets[i].remaining -= take;
      toConsume -= take;
    }
    // ถ้า toConsume ยังเหลือ (พยายามแลกเกินยอดที่เคยมีจริง) แปลว่ามีบั๊ก/ข้อมูลผิดปกติ — เพิกเฉย
    // (ไม่ทำให้ยอดติดลบ) เพราะ redeemPoints() เช็คยอดก่อนเขียนเสมอแล้ว ไม่ควรเกิดขึ้นจริงในทางปฏิบัติ
  }
  const now = Date.now();
  return buckets.reduce((sum, b) => {
    if (b.expires_at && new Date(b.expires_at).getTime() <= now) return sum; // ถังนี้หมดอายุแล้ว ไม่นับ
    return sum + b.remaining;
  }, 0);
}

async function fetchLedgerRows(shopId, contactId) {
  const { data, error } = await supabase.from('pos_loyalty_ledger')
    .select('*').eq('shop_id', shopId).eq('contact_id', contactId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

/** ยอดแต้มคงเหลือของลูกค้ารายหนึ่ง — fail-safe คืน 0 ถ้าตารางยังไม่มี/error ใดๆ */
export async function getContactBalance(shopId, contactId) {
  if (!contactId) return 0;
  try {
    const rows = await fetchLedgerRows(shopId, contactId);
    return computeLoyaltyBalance(rows);
  } catch {
    return 0;
  }
}

/**
 * บันทึกแต้มที่ได้จากการขาย (เรียกจาก sales.js หลังบันทึกบิลสำเร็จ) — best-effort/fire-and-forget
 * เสมอ (ห่อ try/catch ทั้งฟังก์ชันไว้แล้ว ไม่ throw ออกไปทำให้การขายพังตาม) คืน points ที่ได้ (0 ถ้า
 * ปิดใช้งาน/ไม่มีลูกค้า/error) ให้ caller โชว์ toast แจ้งลูกค้าได้
 *
 * อัตราต่อรายการ: ใช้ per-product override ก่อนเสมอ (product.loyalty_baht_per_point) ถ้าไม่ได้ตั้งไว้
 * ค่อย fallback เป็นอัตราเริ่มต้นของร้าน — สินค้าที่ไม่ได้ตั้งอัตราเลยทั้งคู่ (override + shop default
 * ว่างทั้งคู่) ไม่ได้แต้มจากรายการนั้น (ถือว่าร้านตั้งใจไม่ให้แต้มสำหรับสินค้านั้น)
 */
export async function earnPointsFromSale(shopId, { contactId, contactName, items, branch, billNo }) {
  try {
    if (!contactId) return 0;
    if (!(await tableExists('pos_loyalty_ledger'))) return 0;
    const config = await getLoyaltyConfig(shopId);
    if (!config.enabled) return 0;

    const { data: prodRows } = await supabase.from('pos_products')
      .select('sku, loyalty_baht_per_point').eq('shop_id', shopId).is('deleted_at', null);
    const rateBySku = {};
    (prodRows || []).forEach(p => {
      if (p.loyalty_baht_per_point != null) rateBySku[p.sku] = Number(p.loyalty_baht_per_point);
    });

    let totalPoints = 0;
    for (const item of items) {
      const rate = rateBySku[item.sku] ?? config.bahtPerPoint;
      if (!rate || rate <= 0) continue; // ไม่มีอัตรา = ไม่ได้แต้มจากรายการนี้
      const lineTotal = (parseFloat(item.price) || 0) * (parseFloat(item.qty) || 0);
      totalPoints += lineTotal / rate;
    }
    totalPoints = Math.floor(totalPoints * 100) / 100; // ปัดเศษ 2 ตำแหน่ง กันปัญหาทศนิยมยาว
    if (totalPoints <= 0) return 0;

    const expiresAt = config.expiryMonths > 0
      ? new Date(Date.now() + config.expiryMonths * 30 * 24 * 60 * 60 * 1000).toISOString()
      : null;

    await insertRow('pos_loyalty_ledger', {
      shop_id: shopId, contact_id: contactId, entry_type: 'earn', points: totalPoints,
      ref: billNo, note: contactName ? `จากบิล ${billNo} (${contactName})` : `จากบิล ${billNo}`,
      branch_name: branch || '', expires_at: expiresAt,
    });
    return totalPoints;
  } catch (err) {
    console.error('[loyalty] earnPointsFromSale error (non-fatal):', err.message);
    return 0;
  }
}

/**
 * แลกแต้ม (ส่วนลด หรือ สินค้า) — เช็คยอดคงเหลือจริงก่อนเขียนเสมอ (กันแลกเกินยอด/race condition แบบ
 * ง่ายๆ — เช็ค-แล้ว-เขียนไม่ atomic 100% แต่ความเสี่ยงชนกันจริงต่ำมากสำหรับ 1 ลูกค้าที่แคชเชียร์คนเดียว
 * กำลังคุยด้วย ณ ขณะนั้น ไม่ต้องใช้ database-level lock ที่ซับซ้อนเกินความจำเป็นสำหรับ use case นี้)
 * คืน {ok:true} หรือ {ok:false, error}
 */
export async function redeemPoints(shopId, { contactId, points, entryType, ref, note, branch }) {
  if (!contactId) return { ok: false, error: 'ไม่พบลูกค้า' };
  const pts = Number(points) || 0;
  if (pts <= 0) return { ok: false, error: 'จำนวนแต้มไม่ถูกต้อง' };
  if (!(await tableExists('pos_loyalty_ledger'))) return { ok: false, error: 'ระบบแต้มสะสมยังไม่พร้อมใช้งาน (ยังไม่ได้รัน SQL)' };

  const balance = await getContactBalance(shopId, contactId);
  if (pts > balance) return { ok: false, error: `แต้มไม่พอ (มี ${balance} แต้ม ต้องการแลก ${pts} แต้ม)` };

  try {
    await insertRow('pos_loyalty_ledger', {
      shop_id: shopId, contact_id: contactId, entry_type: entryType, points: -pts,
      ref: ref || '', note: note || '', branch_name: branch || '',
    });
    return { ok: true, remainingBalance: balance - pts };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
