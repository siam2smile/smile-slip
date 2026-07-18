/**
 * GET /api/export/analytics-pdf?shopId=xxx&year=2026&month=06
 * สร้าง PDF รายงานสรุปยอดรายเดือน (Pro+)
 */
import { createClient } from '@supabase/supabase-js';
import PDFDocument from 'pdfkit';
import path from 'path';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

const TIER_ORDER = { normal: 0, pro: 1, advance: 2, business: 3, enterprise: 4, super: 4 };

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { shopId, year, month } = req.query;
  if (!shopId || !year || !month) return res.status(400).json({ error: 'shopId, year, month required' });

  // ตรวจสิทธิ์ Pro+
  const { data: shop } = await supabase
    .from('shop_profiles')
    .select('shop_name, subscription_tier')
    .eq('id', shopId)
    .single();

  if (!shop) return res.status(404).json({ error: 'ไม่พบร้านค้า' });
  if ((TIER_ORDER[shop.subscription_tier] || 0) < 1) {
    return res.status(403).json({ error: 'ฟีเจอร์นี้ใช้ได้กับ Pro ขึ้นไป' });
  }

  // ดึง analytics data จาก API ภายใน
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
  const analyticsRes = await fetch(`${baseUrl}/api/shop/analytics?shopId=${shopId}&year=${year}&month=${month}`);
  const data = await analyticsRes.json();

  if (data.error) return res.status(500).json({ error: data.error });

  const { dailyData = [], summary = {}, monthlyData = [] } = data;

  const thaiMonths = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
    'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
  const monthLabel = thaiMonths[parseInt(month) - 1];
  const thaiYear = parseInt(year) + 543;
  const fmt = (n) => (n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Font paths
  const fontRegular = path.join(process.cwd(), 'fonts', 'Sarabun-Regular.ttf');
  const fontBold    = path.join(process.cwd(), 'fonts', 'Sarabun-Bold.ttf');

  // สร้าง PDF
  const doc = new PDFDocument({ margin: 40, size: 'A4' });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="report-${year}-${month}.pdf"`);
  doc.pipe(res);

  doc.registerFont('Regular', fontRegular);
  doc.registerFont('Bold', fontBold);

  // ── Header ──
  doc.rect(0, 0, doc.page.width, 70).fill('#1e293b');
  doc.font('Bold').fontSize(16).fillColor('#ffffff')
    .text('📊 รายงานสรุปยอด', 40, 18);
  doc.font('Regular').fontSize(10).fillColor('#94a3b8')
    .text(`${shop.shop_name}  ·  ${monthLabel} ${thaiYear}`, 40, 42);
  doc.font('Regular').fontSize(8).fillColor('#64748b')
    .text(`สร้างเมื่อ ${new Date().toLocaleDateString('th-TH', { dateStyle: 'long' })}`, 40, 56);

  let y = 90;

  // ── Summary Cards ──
  const totalIncome  = summary.totalIncome  || 0;
  const totalExpense = summary.totalExpense || 0;
  const net = totalIncome - totalExpense;

  const cards = [
    { label: 'รายรับรวม',     value: `฿${fmt(totalIncome)}`,  color: '#10B981' },
    { label: 'รายจ่ายรวม',    value: `฿${fmt(totalExpense)}`, color: '#EF4444' },
    { label: 'กำไร/ขาดทุน',   value: (net >= 0 ? '+' : '') + `฿${fmt(net)}`, color: net >= 0 ? '#10B981' : '#EF4444' },
    { label: 'รายการทั้งหมด', value: `${(summary.countIncome||0) + (summary.countExpense||0)} รายการ`, color: '#3B82F6' },
  ];

  const cardW = (doc.page.width - 80 - 15) / 4;
  cards.forEach((c, i) => {
    const x = 40 + i * (cardW + 5);
    doc.rect(x, y, cardW, 52).fillAndStroke('#f8fafc', '#e2e8f0');
    doc.font('Regular').fontSize(8).fillColor('#64748b').text(c.label, x + 6, y + 8, { width: cardW - 12 });
    doc.font('Bold').fontSize(11).fillColor(c.color).text(c.value, x + 6, y + 24, { width: cardW - 12 });
  });

  y += 68;

  // ── Daily Data Table ──
  if (dailyData.length > 0) {
    doc.font('Bold').fontSize(10).fillColor('#1e293b').text('รายละเอียดรายวัน', 40, y);
    y += 16;

    // Table header
    doc.rect(40, y, doc.page.width - 80, 18).fill('#1e293b');
    const cols = [
      { label: 'วันที่', x: 48,  w: 40 },
      { label: 'รายรับ', x: 100, w: 110 },
      { label: 'รายจ่าย', x: 220, w: 110 },
      { label: 'สลิป', x: 340, w: 50 },
      { label: 'คีย์เอง', x: 400, w: 50 },
      { label: 'สุทธิ', x: 460, w: 90 },
    ];
    doc.font('Bold').fontSize(8).fillColor('#ffffff');
    cols.forEach(c => doc.text(c.label, c.x, y + 4, { width: c.w, align: 'left' }));
    y += 18;

    // Table rows
    dailyData.forEach((row, idx) => {
      if (y > doc.page.height - 60) { doc.addPage(); y = 40; }
      const bg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
      doc.rect(40, y, doc.page.width - 80, 16).fill(bg);
      const rowNet = (row.income || 0) - (row.expense || 0);
      doc.font('Regular').fontSize(8).fillColor('#334155');
      doc.text(String(row.day || '').padStart(2, '0'), cols[0].x, y + 3, { width: cols[0].w });
      doc.fillColor('#10B981').text(`฿${fmt(row.income)}`, cols[1].x, y + 3, { width: cols[1].w });
      doc.fillColor('#EF4444').text(`฿${fmt(row.expense)}`, cols[2].x, y + 3, { width: cols[2].w });
      doc.fillColor('#64748b').text(String(row.slipCount || 0), cols[3].x, y + 3, { width: cols[3].w });
      doc.fillColor('#64748b').text(String(row.manualCount || 0), cols[4].x, y + 3, { width: cols[4].w });
      doc.fillColor(rowNet >= 0 ? '#10B981' : '#EF4444')
        .text((rowNet >= 0 ? '+' : '') + `฿${fmt(rowNet)}`, cols[5].x, y + 3, { width: cols[5].w });
      y += 16;
    });
  }

  // ── Footer ──
  y = Math.max(y + 20, doc.page.height - 50);
  doc.moveTo(40, y).lineTo(doc.page.width - 40, y).stroke('#e2e8f0');
  doc.font('Regular').fontSize(7).fillColor('#94a3b8')
    .text('สร้างโดย Smile Slip Pro · ข้อมูลนี้เป็นความลับทางธุรกิจ', 40, y + 8, { align: 'center', width: doc.page.width - 80 });

  doc.end();
}
