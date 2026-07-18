/**
 * GET /api/shop/heatmap?shopId=xxx
 * Enterprise only — ดึงข้อมูล Peak Time Heatmap + RFM Customer Segments
 * อ่านจาก slip_analytics (heatmap) และ sender_profiles (RFM)
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

const TIER_ORDER = { normal: 0, pro: 1, advance: 2, business: 3, enterprise: 4, super: 4 };

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const { shopId, branch: branchFilter, brand: brandFilter } = req.query;
  if (!shopId) return res.status(400).json({ error: 'shopId required' });

  const { data: shop } = await supabase
    .from('shop_profiles')
    .select('subscription_tier')
    .eq('id', shopId)
    .single();

  const tier = (shop?.subscription_tier || 'normal').toLowerCase();
  if ((TIER_ORDER[tier] || 0) < 4) {
    return res.status(403).json({ error: 'ฟีเจอร์นี้ใช้ได้เฉพาะ Enterprise', requireUpgrade: true });
  }

  try {
    // ── หาแบรนด์ทั้งหมดของร้าน (สาขาที่ไม่ตั้ง brand_name ถือเป็นแบรนด์เดียวกับร้านหลัก) ──
    const { data: branchRows } = await supabase
      .from('shop_branches').select('id, branch_name, brand_name').eq('shop_id', shopId);

    const defaultBrandKey = shopId;
    const brandKeyOf = (brandName) => brandName?.trim() ? `${shopId}:${brandName.trim().toLowerCase()}` : defaultBrandKey;

    const brandMap = new Map(); // brandKey -> { label, branchIds: [] }
    brandMap.set(defaultBrandKey, { label: 'แบรนด์หลัก', branchIds: [null] }); // null = สำนักงานใหญ่/แชทเจ้าของ
    for (const b of (branchRows || [])) {
      const key = brandKeyOf(b.brand_name);
      if (!brandMap.has(key)) brandMap.set(key, { label: b.brand_name?.trim() || 'แบรนด์หลัก', branchIds: [] });
      brandMap.get(key).branchIds.push(b.id);
    }
    const availableBrands = Array.from(brandMap.entries()).map(([key, v]) => ({ key, label: v.label }));

    const selectedBrandKey = (brandFilter && brandMap.has(brandFilter)) ? brandFilter : defaultBrandKey;
    const selectedBrandBranchIds = brandMap.get(selectedBrandKey).branchIds;

    // ── Peak Time Heatmap: 90 วันล่าสุด (กรองตามสาขาจริง ถ้าระบุ — ช่วงเวลาขายดีขึ้นกับทำเลจริง) ──
    const since = new Date();
    since.setDate(since.getDate() - 90);
    const sinceStr = since.toISOString().split('T')[0];

    let heatmapQuery = supabase
      .from('slip_analytics')
      .select('hour_of_day, day_of_week, transaction_type, amount_bucket')
      .eq('shop_id', shopId)
      .gte('slip_date', sinceStr);
    if (branchFilter === '__main__') heatmapQuery = heatmapQuery.is('branch_id', null);
    else if (branchFilter) heatmapQuery = heatmapQuery.eq('branch_id', branchFilter);

    const { data: heatmapRows, error: hErr } = await heatmapQuery;

    if (hErr) throw hErr;

    // grid[dayOfWeek 0-6][hour 0-23] = count
    const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
    const hourTotals = Array(24).fill(0);
    const dayTotals  = Array(7).fill(0);
    let peakHour = 0, peakDay = 0;

    for (const r of (heatmapRows || [])) {
      const d = Number(r.day_of_week);
      const h = Number(r.hour_of_day);
      if (d >= 0 && d < 7 && h >= 0 && h < 24) {
        grid[d][h]++;
        hourTotals[h]++;
        dayTotals[d]++;
      }
    }

    // หาชั่วโมงและวันที่ขายดีที่สุด
    hourTotals.forEach((v, i) => { if (v > hourTotals[peakHour]) peakHour = i; });
    dayTotals.forEach((v, i) => { if (v > dayTotals[peakDay]) peakDay = i; });

    const maxCell = Math.max(...grid.flat(), 1);

    // ── RFM Customer Segments (รวมตามแบรนด์ที่เลือก ไม่ใช่ทั้งร้านดิบๆ) ──
    const { data: senders, error: sErr } = await supabase
      .from('sender_profiles')
      .select('sender_hash, first_seen, last_seen, total_transactions, amount_bucket_mode, frequency_score, updated_at')
      .eq('shop_id', shopId)
      .eq('brand_key', selectedBrandKey);

    if (sErr) throw sErr;

    // ── หา "สาขาประจำ" ของลูกค้าแต่ละคน — นับจาก slip_analytics ดิบ (มี branch_id ทุกแถวอยู่แล้ว) ──
    // จำกัดเฉพาะสาขาที่อยู่ในแบรนด์เดียวกับที่เลือก กันไม่ให้ลูกค้าแบรนด์อื่นมาปนสาขาประจำผิด
    const homeBranchMap = {}; // sender_hash -> { branchId, branchName, count }
    if (senders?.length) {
      const senderHashes = senders.map(s => s.sender_hash);
      const nonNullIds = selectedBrandBranchIds.filter(x => x !== null);
      const hasNull = selectedBrandBranchIds.includes(null);
      const orParts = [];
      if (hasNull) orParts.push('branch_id.is.null');
      if (nonNullIds.length) orParts.push(`branch_id.in.(${nonNullIds.join(',')})`);

      let branchTxQuery = supabase
        .from('slip_analytics')
        .select('sender_hash, branch_id')
        .eq('shop_id', shopId)
        .in('sender_hash', senderHashes);
      if (orParts.length) branchTxQuery = branchTxQuery.or(orParts.join(','));

      const { data: branchTxRows } = await branchTxQuery;
      const branchNameById = new Map((branchRows || []).map(b => [b.id, b.branch_name]));
      const counts = {}; // sender_hash -> { branchKey -> count }
      for (const r of (branchTxRows || [])) {
        const bKey = r.branch_id || '__main__';
        counts[r.sender_hash] = counts[r.sender_hash] || {};
        counts[r.sender_hash][bKey] = (counts[r.sender_hash][bKey] || 0) + 1;
      }
      for (const [senderHash, bCounts] of Object.entries(counts)) {
        let topKey = null, topCount = 0;
        for (const [bKey, c] of Object.entries(bCounts)) { if (c > topCount) { topKey = bKey; topCount = c; } }
        homeBranchMap[senderHash] = {
          branchId: topKey === '__main__' ? null : topKey,
          branchName: topKey === '__main__' ? 'สำนักงานใหญ่' : (branchNameById.get(topKey) || '-'),
          count: topCount,
        };
      }
    }

    const now = Date.now();

    const scored = (senders || []).map(s => {
      const daysSince = Math.floor((now - new Date(s.last_seen).getTime()) / 86400000);
      const tx = s.total_transactions || 1;
      const bucket = (s.amount_bucket_mode || '').toLowerCase();

      // R: recency score (5=ดีที่สุด)
      const R = daysSince <= 7 ? 5 : daysSince <= 30 ? 4 : daysSince <= 60 ? 3 : daysSince <= 90 ? 2 : 1;
      // F: frequency score
      const F = tx >= 20 ? 5 : tx >= 10 ? 4 : tx >= 5 ? 3 : tx >= 2 ? 2 : 1;
      // M: monetary score
      const M = bucket === 'high' ? 5 : bucket === 'medium' ? 3 : 1;

      let segment;
      if (R >= 4 && F >= 4)       segment = 'champions';  // โอนบ่อย + เพิ่งมา
      else if (R >= 4 && F >= 2)  segment = 'loyal';       // ประจำ + เพิ่งมา
      else if (R >= 4 && F === 1) segment = 'new';         // เพิ่งมาครั้งแรก
      else if (R >= 3 && F >= 1)  segment = 'regular';     // ปกติทั่วไป
      else if (R <= 2 && F >= 3)  segment = 'at_risk';     // เคยประจำ แต่หายไป
      else if (R === 1)           segment = 'lost';        // ไม่มา 90+ วัน
      else                         segment = 'dormant';    // นานๆ มาที แต่ไม่ถึงขั้น at_risk

      return { segment, R, F, M, daysSince, tx, senderHash: s.sender_hash, senderBank: s.sender_bank, amountBucket: bucket };
    });

    const seg = (name) => scored.filter(s => s.segment === name).length;
    const rfm = {
      champions: seg('champions'),
      loyal:     seg('loyal'),
      regular:   seg('regular'),
      new:       seg('new'),
      at_risk:   seg('at_risk'),
      lost:      seg('lost'),
      dormant:   seg('dormant'),
      total:     scored.length,
      // ลูกค้าเสี่ยงหาย: เคยประจำ ไม่มา > 30 วัน
      riskCount: scored.filter(s => s.segment === 'at_risk').length,
      // insight
      retentionRate: scored.length > 0
        ? Math.round(((seg('champions') + seg('loyal') + seg('regular')) / scored.length) * 100)
        : 0,
    };

    // รายชื่อ sender แต่ละราย (PDPA-safe: ไม่มีชื่อจริง ใช้ hash) + สาขาประจำ
    const rfmSenders = scored.map(s => ({
      hash:        s.senderHash,
      bank:        s.senderBank,
      segment:     s.segment,
      transactions: s.tx,
      daysSince:   s.daysSince,
      amountBucket: s.amountBucket,
      R: s.R, F: s.F, M: s.M,
      homeBranch: homeBranchMap[s.senderHash]?.branchName || null,
    }));

    return res.status(200).json({
      heatmap: {
        grid,
        hourTotals,
        dayTotals,
        peakHour,
        peakDay,
        maxCell,
        totalTransactions: heatmapRows?.length || 0,
        since: sinceStr,
      },
      rfm,
      rfmSenders,
      branches: (branchRows || []).map(b => ({ id: b.id, name: b.branch_name })),
      availableBrands,
      selectedBrandKey,
    });

  } catch (err) {
    console.error('[heatmap API]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
