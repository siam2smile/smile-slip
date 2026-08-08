/**
 * GET /api/shop/analytics?shopId=xxx&year=2026
 * ดึงข้อมูล Analytics สำหรับ Dashboard กราฟ — อ่านจาก ledger_transactions (Supabase)
 * Pro+: monthly summary, daily summary, income/expense totals
 * Business+: top senders, branch comparison
 *
 * เดิมอ่านจาก Google Sheets ตรงๆ (เหมือน 4 endpoint ที่แก้ไปแล้วในข้อ 61 — transactions.js/
 * export.js/tax-report.js/add-transaction.js) แต่ตกหล่นจากรอบนั้น — Phase 3 Tier 6 ตัดบอทไม่ให้
 * เขียน Sheets แล้ว (เขียน ledger_transactions อย่างเดียว) ทำให้กราฟไม่เห็นรายการใหม่เลยตั้งแต่นั้นมา
 * ย้ายมาอ่าน Supabase ที่เดียวกับรายงานอื่นๆ แล้ว — ไม่ต้องเชื่อมต่อ Google เลยด้วย (เดิมบังคับ)
 */
import { createClient } from '@supabase/supabase-js';
import { requireOwnerAuth } from '../../../lib/owner-auth';
import { fetchLedgerRows } from '../../../lib/ledger-supabase';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

// ตรวจสอบ tier ขั้นต่ำ
const TIER_ORDER = { normal: 0, pro: 1, advance: 2, business: 3, enterprise: 4, super: 4 };
const hasFeature = (tier, minTier) => (TIER_ORDER[tier] || 0) >= (TIER_ORDER[minTier] || 0);

const THAI_MONTHS = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { shopId, year, month, branch: branchFilter } = req.query;
  if (!shopId) return res.status(400).json({ error: 'ไม่พบ shopId' });
  // เรียกจาก useEffect ที่รอ shopInfo.id พร้อมแล้วเสมอ (dashboard.js) — fetch-override
  // แนบ token ทันเวลาแล้วตอนนี้ ต่างจาก shop/data.js ที่เรียกก่อนรู้ shopId เลย (ยังไม่ gate)
  if (!requireOwnerAuth(req, res, shopId, { enforce: true })) return;

  try {
    // ดึงข้อมูลร้าน
    const { data: shop } = await supabase
      .from('shop_profiles')
      .select('subscription_tier')
      .eq('id', shopId)
      .single();

    if (!shop) return res.status(404).json({ error: 'ไม่พบร้านค้า' });

    const tier = (shop.subscription_tier || 'normal').toLowerCase();
    if (!hasFeature(tier, 'pro')) {
      return res.status(403).json({ error: 'กราฟ Analytics ใช้ได้เฉพาะ Pro ขึ้นไป', requireUpgrade: true });
    }

    // ─── ดึงข้อมูลจาก ledger_transactions (Supabase) — คนละ field จาก Sheets เดิม แต่ shape
    // เดียวกับที่ dashboard.js Ledger tab/Export ใช้อยู่แล้ว (rowToLedgerRow) ───
    const targetYear = year || new Date().getFullYear().toString();
    let allRows = await fetchLedgerRows(shopId, { year: targetYear });

    // กรองตามสาขา ถ้าระบุมา (ดูแนวโน้มของสาขานั้นๆ แทนยอดรวมทุกสาขา)
    if (branchFilter && branchFilter !== 'all' && hasFeature(tier, 'advance')) {
      allRows = allRows.filter(row => (row.branch === '-' ? 'สำนักงานใหญ่' : row.branch) === branchFilter);
    }

    // ─── สรุปรายเดือน (12 เดือน) ───
    const monthlyMap = {};
    for (let m = 1; m <= 12; m++) {
      const key = m.toString().padStart(2, '0');
      monthlyMap[key] = { month: THAI_MONTHS[m - 1], income: 0, expense: 0, count: 0 };
    }

    // ─── สรุปรายวัน (เดือนที่เลือก หรือเดือนปัจจุบัน) ───
    const today = new Date();
    const targetMonth = month ? month.padStart(2, '0') : (today.getMonth() + 1).toString().padStart(2, '0');
    const daysInMonth = new Date(parseInt(targetYear), parseInt(targetMonth), 0).getDate();
    const dailyMap = {};
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${targetYear}-${targetMonth}-${d.toString().padStart(2, '0')}`;
      dailyMap[key] = { day: d, label: `${d}`, income: 0, expense: 0, count: 0 };
    }

    // ─── สรุปผู้โอน top (Business+) ───
    const senderMap = {};

    // ─── สรุปสาขา (Advance+) ───
    const branchMap = {};

    // ─── สรุปหมวดหมู่ (Business+) — แยก income/expense ───
    const incomeCatMap  = {};
    const expenseCatMap = {};

    // ─── Marketing Spend (Enterprise+) ───
    const marketingSpendMap = {};

    // รวมตัวเลข
    let totalIncome = 0, totalExpense = 0, totalCount = 0;

    for (const row of allRows) {
      // group ตามวันที่ทำธุรกรรมจริง (ปฏิทินกรุงเทพ, รองรับ backdate) — ต่างจาก Sheets เดิมที่ group
      // ตาม "วันที่บันทึก" (recorded_at, ไม่ backdate) แต่ transaction date ถูกต้องตามหลักบัญชีมากกว่า
      const txIsoDate = row.transactionIsoDate || '';
      const type       = row.type;
      const amount     = row.amount;
      const sender     = row.sender && row.sender !== '-' ? row.sender : 'ไม่ระบุ';
      const branch     = row.branch && row.branch !== '-' ? row.branch : 'สำนักงานใหญ่';
      const category   = row.category && row.category !== '-' ? row.category : '';

      if (!txIsoDate.startsWith(targetYear)) continue;

      const monthKey = txIsoDate.substring(5, 7);
      const dayKey   = txIsoDate.substring(0, 10);

      // monthly
      if (monthlyMap[monthKey]) {
        if (type === 'รายรับ') { monthlyMap[monthKey].income += amount; totalIncome += amount; }
        if (type === 'รายจ่าย') { monthlyMap[monthKey].expense += amount; totalExpense += amount; }
        monthlyMap[monthKey].count++;
        totalCount++;
      }

      // daily (เดือนที่เลือก)
      if (dailyMap[dayKey]) {
        if (type === 'รายรับ') { dailyMap[dayKey].income += amount; dailyMap[dayKey].count++; }
        if (type === 'รายจ่าย') { dailyMap[dayKey].expense += amount; dailyMap[dayKey].count++; }
      }

      // top senders (Business+)
      if (hasFeature(tier, 'business') && type === 'รายรับ' && sender !== 'ไม่ระบุ') {
        senderMap[sender] = senderMap[sender] || { name: sender, amount: 0, count: 0 };
        senderMap[sender].amount += amount;
        senderMap[sender].count++;
      }

      // branch comparison (Advance+)
      if (hasFeature(tier, 'advance')) {
        branchMap[branch] = branchMap[branch] || { branch, income: 0, expense: 0, count: 0 };
        if (type === 'รายรับ') branchMap[branch].income += amount;
        if (type === 'รายจ่าย') branchMap[branch].expense += amount;
        branchMap[branch].count++;
      }

      // Marketing ROI (Enterprise+) — รายจ่ายค่าการตลาด vs รายรับ รายวัน เดือนที่เลือก
      if (hasFeature(tier, 'enterprise') && type === 'รายจ่าย' && category === 'ค่าการตลาด/โฆษณา' && monthKey === targetMonth) {
        const mktKey = dayKey;
        marketingSpendMap[mktKey] = (marketingSpendMap[mktKey] || 0) + amount;
      }

      // หมวดหมู่ (Business+) — เฉพาะเดือนที่เลือก
      if (hasFeature(tier, 'business') && category && category !== '-' && monthKey === targetMonth) {
        if (type === 'รายรับ') {
          incomeCatMap[category] = incomeCatMap[category] || { category, amount: 0, count: 0 };
          incomeCatMap[category].amount += amount;
          incomeCatMap[category].count++;
        }
        if (type === 'รายจ่าย') {
          expenseCatMap[category] = expenseCatMap[category] || { category, amount: 0, count: 0 };
          expenseCatMap[category].amount += amount;
          expenseCatMap[category].count++;
        }
      }
    }

    // เรียงผู้โอนจากยอดมากสุด
    const topSenders = Object.values(senderMap)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10);

    // เรียงหมวดหมู่จากยอดมากสุด
    const incomeByCategory  = Object.values(incomeCatMap).sort((a, b) => b.amount - a.amount);
    const expenseByCategory = Object.values(expenseCatMap).sort((a, b) => b.amount - a.amount);

    // Marketing ROI รายวัน (Enterprise+)
    const marketingROI = hasFeature(tier, 'enterprise')
      ? Object.values(dailyMap).map(d => ({
          day: d.day,
          label: d.label,
          income: d.income,
          marketingSpend: marketingSpendMap[`${targetYear}-${targetMonth}-${d.day.toString().padStart(2, '0')}`] || 0,
        })).filter(d => d.income > 0 || d.marketingSpend > 0)
      : [];

    // เรียงสาขา
    const branchData = Object.values(branchMap).sort((a, b) => b.income - a.income);

    // monthly data เป็น array — **ห้ามใช้ Object.values(monthlyMap) ตรงๆ**: คีย์ '10'/'11'/'12' เป็น
    // "canonical integer string" ตามสเปก JS ทำให้ engine เรียงคีย์เหล่านี้ขึ้นก่อนคีย์ '01'-'09' เสมอ
    // ไม่ว่าจะ insert ตามลำดับไหนก็ตาม (ผลลัพธ์เดิม: ต.ค.,พ.ย.,ธ.ค.,ม.ค.,...,ก.ย. — เดือนสลับผิดลำดับ
    // มาตั้งแต่สร้างไฟล์นี้) — ต้อง build array ตามลำดับเดือนตรงๆ แทน
    const monthlyData = [];
    for (let m = 1; m <= 12; m++) monthlyData.push(monthlyMap[m.toString().padStart(2, '0')]);

    // daily data เป็น array ของเดือนที่เลือก
    const dailyData = Object.values(dailyMap);

    // สรุปรายวัน (เฉพาะเดือนที่เลือก)
    const dailySummary = dailyData.reduce((acc, d) => ({
      income: acc.income + d.income,
      expense: acc.expense + d.expense,
      count: acc.count + d.count,
    }), { income: 0, expense: 0, count: 0 });

    return res.status(200).json({
      summary: {
        totalIncome: Math.round(totalIncome),
        totalExpense: Math.round(totalExpense),
        profit: Math.round(totalIncome - totalExpense),
        totalCount,
        year: targetYear,
      },
      dailySummary: {
        income: Math.round(dailySummary.income),
        expense: Math.round(dailySummary.expense),
        profit: Math.round(dailySummary.income - dailySummary.expense),
        count: dailySummary.count,
        month: targetMonth,
        year: targetYear,
      },
      monthlyData,
      dailyData,
      topSenders: hasFeature(tier, 'business') ? topSenders : [],
      branchData: hasFeature(tier, 'advance') ? branchData : [],
      incomeByCategory:  hasFeature(tier, 'business') ? incomeByCategory  : [],
      expenseByCategory: hasFeature(tier, 'business') ? expenseByCategory : [],
      marketingROI:      hasFeature(tier, 'enterprise') ? marketingROI : [],
      tier,
    });

  } catch (err) {
    console.error('[Analytics API]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
