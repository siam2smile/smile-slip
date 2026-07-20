/**
 * Verified Hyper-Local Market Price Index + Procurement Fraud Detection (v1, retail-only)
 *
 * ทุกฟังก์ชันในไฟล์นี้เป็น fail-safe (ไม่ throw ออกไปนอกไฟล์) — เรียกใช้จาก api/pos/receives.js
 * หลังบันทึกรับสินค้าจริงสำเร็จแล้วเท่านั้น ถ้าตารางกลางยังไม่ถูกสร้าง (รอผู้ใช้รัน SQL) หรือ Gemini
 * ล่ม จะ log แล้วข้ามเงียบๆ ไม่ทำให้การรับสินค้าเข้าสต็อคจริงพังไปด้วยเด็ดขาด
 *
 * กฎสำคัญ (ดู CLAUDE.md "เหตุการณ์และบั๊กที่แก้แล้ว" ข้อ 30 สำหรับเหตุผลเต็ม):
 * - ตาราง anonymous_market_prices ห้ามเก็บ shop_id ตรงๆ ห้ามเก็บลิงก์รูป ห้ามเก็บชื่อผู้จำหน่าย
 *   เก็บได้แค่ shop_hash (sha256 ทางเดียว ผูก salt ลับ) ไว้นับ COUNT(DISTINCT) เท่านั้น
 * - นับเข้าตารางกลางเฉพาะรายการที่มีรูปแนบ (verified) เท่านั้น — คีย์มือเปล่าๆ ไม่มีรูปข้าม
 * - เกณฑ์ 5 ร้านขึ้นไปต่ออำเภอ ถึงจะคำนวณราคากลางระดับอำเภอ ไม่พอ fallback ไปจังหวัด
 *
 * MARKET_PRICE_FEATURE_LIVE (ดู lib/market-price-flag.js) — สวิตช์เดียวคุมว่า "เปิดให้ลูกค้าเห็นผลลัพธ์"
 * หรือยัง แยกไฟล์ต่างหากเพื่อให้ pages/pos.js (client) import ได้ตรงๆ โดยไม่ดึงโค้ดฝั่งเซิร์ฟเวอร์ไฟล์นี้
 * เข้าไปใน client bundle — ฟังก์ชันเก็บข้อมูล/ตรวจ red flag ในไฟล์นี้ทำงานเบื้องหลังเสมอไม่ขึ้นกับ flag นี้
 * (flag นี้ใช้แค่ตอน response กลับที่ api/pos/receives.js เท่านั้น)
 */
export { MARKET_PRICE_FEATURE_LIVE } from './market-price-flag';

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
const MIN_SHOPS_FOR_DISTRICT = 5;
const FRAUD_DEVIATION_THRESHOLD = 20; // % แพงกว่าราคากลางถึงจะขึ้น red flag

function normalizeName(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, '');
}

export function hashShopId(shopId) {
  const salt = process.env.MARKET_HASH_SALT || '';
  return crypto.createHash('sha256').update(`${shopId}:${salt}`).digest('hex');
}

// ── Canonicalization (แคชก่อนเสมอ ไม่แคชค่อยเรียก Gemini แบบ text-only ทีเดียวทั้งใบ) ──
async function canonicalizeViaGemini(rawNames) {
  if (!GEMINI_API_KEY || !rawNames.length) return {};
  const url = `https://generativelanguage.googleapis.com/v1/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const prompt = `แปลงชื่อสินค้า/วัตถุดิบต่อไปนี้ให้เป็นชื่อมาตรฐานสากล (canonical name) และจัดหมวดหมู่สินค้า
ตอบเป็น JSON array เท่านั้น ห้ามมีข้อความอื่น รูปแบบ:
[{"raw":"ชื่อดิบที่ให้มา","canonical_name":"ชื่อมาตรฐาน","category":"หมวดหมู่ เช่น ของสด/เนื้อสัตว์, เชื้อเพลิง/พลังงาน, บรรจุภัณฑ์"}]

รายการ: ${JSON.stringify(rawNames)}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        // maxOutputTokens ต้องสูงพอสำหรับ "thinking token" ภายในของโมเดล (gemini-3.5-flash เผื่อ
        // token คิดก่อนตอบเสมอ แม้งานจะเล็กมาก — ทดสอบจริงพบว่า 512 ตัดจบก่อนได้ JSON ครบ)
        generationConfig: { temperature: 0, maxOutputTokens: 4096 },
      }),
    });
    const data = await res.json();
    // รวมทุก part เข้าด้วยกัน — Gemini บางครั้งแบ่งเอาต์พุตเป็นหลาย part ในคำตอบเดียว
    // (เจอจริงตอน debug: part แรกมีแค่ "```json" ส่วน JSON จริงอยู่ใน part ถัดไป)
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const text = parts.map(p => p.text || '').join('');
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) {
      console.error('[market-price] Gemini ไม่ตอบ JSON ที่ใช้ได้ — finishReason:', data?.candidates?.[0]?.finishReason, 'text:', text.slice(0, 200));
      return {};
    }
    const parsed = JSON.parse(match[0]);
    const out = {};
    for (const p of parsed) {
      if (p.raw) out[normalizeName(p.raw)] = { canonical_name: p.canonical_name || p.raw, category: p.category || 'ไม่ระบุหมวด' };
    }
    return out;
  } catch (err) {
    console.error('[market-price] canonicalizeViaGemini error:', err.message);
    return {};
  }
}

// items: [{name, ...}] → คืน Map raw name(normalized) -> {canonical_name, category}
export async function canonicalizeItems(items) {
  const result = {};
  try {
    const uniqueNames = [...new Set(items.map(i => i.name).filter(Boolean))];
    if (!uniqueNames.length) return result;
    const normalizedMap = {}; // normalized -> original
    for (const n of uniqueNames) normalizedMap[normalizeName(n)] = n;
    const normalizedKeys = Object.keys(normalizedMap);

    // 1. เช็คแคชก่อน
    const { data: cached } = await supabase
      .from('canonical_name_cache')
      .select('raw_name_normalized, canonical_name, category')
      .in('raw_name_normalized', normalizedKeys);
    const cacheMiss = [];
    for (const key of normalizedKeys) {
      const hit = cached?.find(c => c.raw_name_normalized === key);
      if (hit) result[key] = { canonical_name: hit.canonical_name, category: hit.category };
      else cacheMiss.push(normalizedMap[key]);
    }

    // 2. เรียก Gemini เฉพาะที่ไม่มีในแคช (1 call ต่อทั้งใบ ไม่ใช่ต่อรายการ)
    if (cacheMiss.length) {
      const fromGemini = await canonicalizeViaGemini(cacheMiss);
      const rowsToCache = [];
      for (const [key, val] of Object.entries(fromGemini)) {
        result[key] = val;
        rowsToCache.push({ raw_name_normalized: key, canonical_name: val.canonical_name, category: val.category });
      }
      if (rowsToCache.length) {
        try {
          await supabase.from('canonical_name_cache').upsert(rowsToCache, { onConflict: 'raw_name_normalized' });
        } catch (e) { console.error('[market-price] cache upsert error:', e.message); }
      }
    }
  } catch (err) {
    console.error('[market-price] canonicalizeItems error:', err.message);
  }
  return result;
}

// ── บันทึกเข้าตารางกลางนิรนาม (เรียกเฉพาะเมื่อมีรูปแนบเป็นหลักฐานเท่านั้น) ──
export async function insertAnonymousMarketPrices({ shopId, items, district, province, priceType = 'retail' }) {
  if (!district || !province) return; // ไม่รู้อำเภอ/จังหวัด ก็เก็บไม่ได้ (ร้านเก่าที่ยังไม่ backfill)
  try {
    const canonMap = await canonicalizeItems(items);
    const shopHash = hashShopId(shopId);
    const logged_month = new Date().toISOString().slice(0, 7) + '-01';
    const rows = [];
    for (const item of items) {
      const key = normalizeName(item.name);
      const canon = canonMap[key];
      if (!canon || !item.unitBase || item.unitBase <= 0) continue;
      rows.push({
        item_name: canon.canonical_name,
        category: canon.category,
        unit_price: Math.round(item.unitBase * 100) / 100,
        uom: item.unit || null,
        district, province,
        price_type: priceType,
        shop_hash: shopHash,
        logged_month,
      });
    }
    if (rows.length) {
      const { error } = await supabase.from('anonymous_market_prices').insert(rows);
      if (error) console.error('[market-price] insertAnonymousMarketPrices error:', error.message);
    }
  } catch (err) {
    console.error('[market-price] insertAnonymousMarketPrices error:', err.message);
  }
}

// ── เช็คราคากลาง (อำเภอ ถ้าไม่ถึง 5 ร้าน fallback จังหวัด) — คืน { median, fallback, shopCount } หรือ null ──
async function getMarketMedian(itemName, district, province, priceType = 'retail') {
  try {
    const { data: districtRows } = await supabase
      .from('anonymous_market_prices')
      .select('unit_price, shop_hash')
      .eq('item_name', itemName).eq('district', district).eq('price_type', priceType);
    const districtShopCount = new Set((districtRows || []).map(r => r.shop_hash)).size;

    let rows = districtRows, fallback = false;
    if (districtShopCount < MIN_SHOPS_FOR_DISTRICT) {
      const { data: provinceRows } = await supabase
        .from('anonymous_market_prices')
        .select('unit_price, shop_hash')
        .eq('item_name', itemName).eq('province', province).eq('price_type', priceType);
      rows = provinceRows;
      fallback = true;
    }
    if (!rows || !rows.length) return null;

    const prices = rows.map(r => r.unit_price).sort((a, b) => a - b);
    const mid = Math.floor(prices.length / 2);
    const median = prices.length % 2 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2;
    return { median, fallback, shopCount: fallback ? new Set(rows.map(r => r.shop_hash)).size : districtShopCount };
  } catch (err) {
    console.error('[market-price] getMarketMedian error:', err.message);
    return null;
  }
}

// ── ตรวจทุจริตจัดซื้อ: เทียบราคาที่ซื้อจริงกับราคากลาง บันทึก red flag ถ้าแพงเกินเกณฑ์ ──
export async function checkProcurementFraud({ shopId, branchName, receiveDocNo, items, district, province }) {
  if (!district || !province) return [];
  const warnings = [];
  try {
    const canonMap = await canonicalizeItems(items);
    for (const item of items) {
      const key = normalizeName(item.name);
      const canon = canonMap[key];
      if (!canon || !item.unitBase || item.unitBase <= 0) continue;

      const market = await getMarketMedian(canon.canonical_name, district, province, 'retail');
      if (!market || market.median <= 0) continue;

      const deviation = ((item.unitBase - market.median) / market.median) * 100;
      if (deviation >= FRAUD_DEVIATION_THRESHOLD) {
        warnings.push(`⚠️ "${item.name}" ราคา ฿${item.unitBase.toLocaleString()} แพงกว่าราคากลาง${market.fallback ? 'จังหวัด' : 'อำเภอ'} (฿${market.median.toLocaleString()}) อยู่ ${Math.round(deviation)}%`);
        try {
          await supabase.from('procurement_alerts').insert({
            shop_id: shopId, branch_name: branchName || null, receive_doc_no: receiveDocNo,
            item_name: canon.canonical_name, submitted_price: item.unitBase,
            market_median_price: market.median, deviation_percentage: Math.round(deviation * 100) / 100,
          });
        } catch (e) { console.error('[market-price] insert procurement_alerts error:', e.message); }
      }
    }
  } catch (err) {
    console.error('[market-price] checkProcurementFraud error:', err.message);
  }
  return warnings;
}

// ── ดึงอำเภอ/จังหวัดของร้าน (คืน null ถ้ายังไม่ backfill) ──
export async function getShopDistrictProvince(shopId) {
  try {
    const { data } = await supabase.from('shop_profiles').select('district, province').eq('id', shopId).single();
    return { district: data?.district || null, province: data?.province || null };
  } catch {
    return { district: null, province: null };
  }
}
