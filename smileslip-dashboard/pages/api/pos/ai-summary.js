/**
 * GET /api/pos/ai-summary?shopId&dateFrom&dateTo&branch
 * สรุปผลประกอบการร้านด้วย AI (Gemini) — งานกลยุทธ์ "6P Data Matrix" ข้อ 89 Phase 5
 *
 * ดึงข้อมูลจาก report types ที่มีอยู่แล้ว (sales/pl/topsellers/customer_rfm/peak_hours) ผ่าน
 * internal fetch ไปยัง /api/pos/reports เอง (pattern เดียวกับ api/export/analytics-pdf.js ที่ทำแบบนี้
 * อยู่แล้ว) แทนที่จะ duplicate logic คำนวณซ้ำทั้งก้อน — แนบ token เดียวกับที่ caller ส่งมาต่อไปด้วยเสมอ
 * (เจ้าของร้าน/แอดมิน หรือ staff-session ที่มีสิทธิ์) ทำให้แต่ละ report ที่ดึงมาผ่านการเช็คสิทธิ์ของ
 * ตัวเองอยู่แล้ว (defense-in-depth — เช็คซ้ำสองชั้น ไม่ใช่แค่ชั้นเดียวที่นี่)
 *
 * customer_rfm อาจ 403 (feature-locked ถ้าไม่ใช่ Enterprise) — ไม่เป็นไร ข้ามได้เงียบๆ ยังสรุปจาก
 * ข้อมูลที่เหลือได้ตามปกติ (ทุกจุดที่ดึงข้อมูลเขียนแบบ fail-safe เสมอ)
 *
 * รวมตัวเลขสำคัญเป็น context สั้นๆ (ไม่ส่งข้อมูลดิบทั้งก้อน) ส่งให้ Gemini ตาม pattern เดียวกับ
 * lib/market-price.js's canonicalizeViaGemini เป๊ะ (maxOutputTokens สูงพอสำหรับ thinking token ภายใน
 * ของ gemini-3.5-flash, รวมทุก parts[] ก่อน parse เสมอ) ขอสรุปเป็น bullet 3-5 ข้อภาษาไทย
 *
 * Fail-safe เสมอทุกจุด — ถ้าไม่มีข้อมูลพอ/Gemini ล่ม/ไม่ได้ตั้ง GEMINI_API_KEY จะคืน 200 พร้อม
 * {summary:null, fallback:'...'} เสมอ ไม่ throw/500 ทำให้หน้ารายงานพัง (เป็นแค่ปุ่มเสริม ไม่ใช่ core flow)
 */
import { createClient } from '@supabase/supabase-js';
import { requirePermission } from '../../../lib/pos-auth';
import { hasFeature, upgradeMessage } from '../../../lib/tier-features';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

async function fetchInternalReport(baseUrl, shopId, type, params, forwardHeaders) {
  try {
    const qs = new URLSearchParams({ shopId, type, ...params }).toString();
    const r = await fetch(`${baseUrl}/api/pos/reports?${qs}`, { headers: forwardHeaders });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

const fmtB = (n) => Math.round(Number(n) || 0).toLocaleString('th-TH');

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { shopId, dateFrom, dateTo, branch } = req.query;
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });

  // gate ด้วยสิทธิ์ที่ครอบคลุมที่สุด (perm_view_pl) เพราะสรุปนี้รวมกำไร-ขาดทุนไว้ด้วยเสมอ — เจ้าของ
  // ร้าน/แอดมิน (ไม่มี staff-session เลย) ไม่ถูกกระทบ ผ่านเสมอเหมือนทุก report type อื่น
  if (!(await requirePermission(req, res, shopId, 'perm_view_pl'))) return;

  // สรุปยอด AI เป็นส่วนหนึ่งของ "6P Data Matrix" — ล็อก Enterprise เหมือนส่วนอื่นทั้งชุด
  const { data: shopRow } = await supabase.from('shop_profiles').select('subscription_tier').eq('id', shopId).maybeSingle();
  if (!hasFeature((shopRow?.subscription_tier || 'normal').toLowerCase(), 'strategy_analytics')) {
    return res.status(403).json({ error: upgradeMessage('strategy_analytics'), featureLocked: true });
  }

  const forwardHeaders = {};
  const ownerToken = req.headers['x-owner-session'] || req.query?.ownerSession;
  const staffToken = req.headers['x-staff-session'] || req.query?.session;
  if (ownerToken) forwardHeaders['x-owner-session'] = ownerToken;
  if (staffToken) forwardHeaders['x-staff-session'] = staffToken;

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
  const commonParams = {};
  if (dateFrom) commonParams.dateFrom = dateFrom;
  if (dateTo) commonParams.dateTo = dateTo;
  if (branch) commonParams.branch = branch;

  const [salesData, plData, topData, rfmData, peakData] = await Promise.all([
    fetchInternalReport(baseUrl, shopId, 'sales', commonParams, forwardHeaders),
    fetchInternalReport(baseUrl, shopId, 'pl', commonParams, forwardHeaders),
    fetchInternalReport(baseUrl, shopId, 'topsellers', commonParams, forwardHeaders),
    fetchInternalReport(baseUrl, shopId, 'customer_rfm', commonParams, forwardHeaders),
    fetchInternalReport(baseUrl, shopId, 'peak_hours', commonParams, forwardHeaders),
  ]);

  // สร้าง context กระชับจากตัวเลขสรุปเท่านั้น (ไม่ส่งรายการดิบทั้งหมดเข้า Gemini)
  const lines = [];

  if (salesData?.summary) {
    const s = salesData.summary;
    lines.push(`ยอดขาย: รวม ${s.count || 0} บิล ยอดชำระแล้วรวม ฿${fmtB(s.total_income)} (เงินสด ฿${fmtB(s.cash)}, โอน ฿${fmtB(s.transfer)}, เชื่อ ฿${fmtB(s.credit)}), ค้างชำระ/รอยืนยัน ฿${fmtB(s.pending)}`);
  }

  if (plData?.summary) {
    const p = plData.summary;
    lines.push(`กำไรขาดทุน: รายได้รวม ฿${fmtB(p.total_revenue)}, ต้นทุนสินค้า ฿${fmtB(p.total_cost)}, กำไรขั้นต้น ฿${fmtB(p.gross_profit)} (${p.gross_margin || 0}%), ค่าใช้จ่ายร้าน+เงินเดือนรวม ฿${fmtB(p.total_expenses)}, กำไรสุทธิ ฿${fmtB(p.net_profit)} (${p.net_margin || 0}%)`);
  }
  if (plData?.categories?.length) {
    const topCats = [...plData.categories].sort((a, b) => b.revenue - a.revenue).slice(0, 5);
    lines.push(`หมวดหมู่สินค้าที่ทำรายได้สูงสุด: ${topCats.map(c => `${c.category} ฿${fmtB(c.revenue)} (กำไร ${c.margin}%)`).join(', ')}`);
  }

  if (topData?.top_sellers?.length) {
    const top5 = topData.top_sellers.slice(0, 5);
    lines.push(`สินค้าขายดีที่สุด (ตามจำนวนขาย): ${top5.map(t => `${t.name} ${t.qty} ชิ้น (฿${fmtB(t.revenue)})`).join(', ')}`);
  }

  if (rfmData?.summary && !rfmData.error) {
    const r = rfmData.summary;
    lines.push(`กลุ่มลูกค้าสมาชิกร้าน: ลูกค้าคนสำคัญ ${r.champions || 0} คน, ลูกค้าประจำ ${r.loyal || 0} คน, ลูกค้าใหม่ ${r.new || 0} คน, เสี่ยงหายไป ${r.at_risk || 0} คน, หายไปแล้ว ${r.lost || 0} คน (จากทั้งหมด ${r.total_scored || 0} คนที่มีประวัติซื้อ)`);
  }

  // ข้าม peak_hours ถ้าไม่มีธุรกรรมเลยในช่วงที่เลือก — hourCounts/dayCounts เป็นศูนย์ทั้งหมด
  // ทำให้ peakHour/peakDay ตกที่ index 0 เสมอ (artifact ของอาเรย์ที่ไม่เคยถูกอัปเดตเลย ไม่ใช่ข้อมูลจริง)
  if (peakData?.summary?.total_transactions > 0 && !peakData.error) {
    lines.push(`ช่วงเวลาขายดีที่สุด: วัน${peakData.peakDayLabel || ''} เวลา ${peakData.peakHour}:00 น. (จากทั้งหมด ${peakData.summary.total_transactions} รายการที่นับ)`);
  }

  if (!lines.length) {
    return res.status(200).json({ summary: null, fallback: 'ยังไม่มีข้อมูลเพียงพอสำหรับสรุปในช่วงเวลาที่เลือก' });
  }

  if (!GEMINI_API_KEY) {
    return res.status(200).json({ summary: null, fallback: 'ฟีเจอร์สรุปด้วย AI ยังไม่พร้อมใช้งานในขณะนี้' });
  }

  try {
    const prompt = `คุณเป็นที่ปรึกษาธุรกิจให้ร้านค้า SME ไทย จากข้อมูลสรุปผลประกอบการด้านล่าง ให้เขียนสรุป
เป็นภาษาไทย 3-5 bullet สั้นกระชับ เข้าใจง่าย เน้นข้อสังเกตที่เป็นประโยชน์ต่อการตัดสินใจของเจ้าของร้าน
(เช่น สินค้า/หมวดหมู่ไหนควรเน้น กลุ่มลูกค้าไหนควรดูแลเป็นพิเศษ ช่วงเวลาไหนควรจัดพนักงานเพิ่ม จุดไหน
น่ากังวล) ห้ามพูดเกินจากข้อมูลที่ให้มา ห้ามเดา/สมมติตัวเลขที่ไม่มีในข้อมูล ห้ามให้คำแนะนำที่การันตี
ผลลัพธ์ทางการเงิน ตอบเป็น bullet ขึ้นต้นด้วย "•" เท่านั้น ห้ามมีหัวข้อ/คำนำ/สรุปท้าย/markdown อื่นใด

ข้อมูล:
${lines.join('\n')}`;

    const url = `https://generativelanguage.googleapis.com/v1/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const geminiRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        // maxOutputTokens ต้องสูงพอสำหรับ thinking token ภายในของ gemini-3.5-flash เสมอ (ดู
        // lib/market-price.js's เหตุผลเดียวกัน — เคยเจอบั๊กจริงหลายจุดถ้าตั้งค่านี้ต่ำเกินไป)
        generationConfig: { temperature: 0.3, maxOutputTokens: 4096 },
      }),
    });
    const data = await geminiRes.json();
    // รวมทุก part เข้าด้วยกันเสมอ — Gemini บางครั้งแบ่งเอาต์พุตเป็นหลาย part ในคำตอบเดียว
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const text = parts.map((p) => p.text || '').join('').trim();
    if (!text) {
      console.error('[ai-summary] Gemini ไม่ตอบข้อความ — finishReason:', data?.candidates?.[0]?.finishReason);
      return res.status(200).json({ summary: null, fallback: 'ไม่สามารถสร้างสรุปได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง' });
    }
    return res.status(200).json({ summary: text });
  } catch (err) {
    console.error('[ai-summary] error:', err.message);
    return res.status(200).json({ summary: null, fallback: 'ไม่สามารถสร้างสรุปได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง' });
  }
}
