/**
 * POST /api/cron/booking-reminders
 * แจ้งเตือนลูกค้าล่วงหน้าก่อนถึงนัด (Phase 5) — ยิงทุกชั่วโมง หาการจองที่ยืนยันแล้ว (status:'confirmed'),
 * มี customer_line_id ผูกไว้แล้ว (ผ่าน LINE Login — ดู api/auth/line.js's intent=booking_link),
 * ยังไม่เคยแจ้งเตือน (reminder_sent_at เป็น null), และเวลานัดอยู่ในช่วง "พรุ่งนี้ประมาณช่วงนี้"
 * (now+20h ถึง now+28h — กว้างพอให้ cron รายชั่วโมงจับได้แน่นอน 1 ครั้ง ไม่พลาด/ไม่ซ้ำ เพราะ
 * mark reminder_sent_at ทันทีหลังส่งสำเร็จ — pattern เดียวกับ notify_weekly_last_sent/
 * trial_day25_notified) — เคารพสวิตช์ line_reminder_enabled ของแต่ละร้าน (Phase 1) ด้วย แม้จะมี
 * customer_line_id อยู่แล้วก็ตาม (ร้านอาจปิดฟีเจอร์นี้ทีหลัง)
 *
 * เรียกโดย Cloud Scheduler ทุกชั่วโมง (ต้องส่ง x-cron-secret ตรงกับ CRON_SECRET)
 */
import { createClient } from '@supabase/supabase-js';
import { formatBangkokHM } from '../../../lib/booking';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

async function pushLineMessage(lineId, message) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token || !lineId) return false;
  try {
    const r = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: lineId, messages: [message] }),
    });
    return r.ok;
  } catch (err) {
    console.error('[cron/booking-reminders] pushLineMessage error:', err.message);
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const secret = req.headers['x-cron-secret'] || req.query.secret;
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const now = Date.now();
  const windowStart = new Date(now + 20 * 3600 * 1000).toISOString();
  const windowEnd = new Date(now + 28 * 3600 * 1000).toISOString();

  try {
    const { data: due, error } = await supabase.from('booking_reservations')
      .select('shop_id, booking_no, service_name, customer_line_id, start_at')
      .eq('status', 'confirmed')
      .not('customer_line_id', 'is', null)
      .is('reminder_sent_at', null)
      .gte('start_at', windowStart).lt('start_at', windowEnd);
    if (error) {
      console.error('[cron/booking-reminders] query error:', error.message);
      return res.status(500).json({ error: error.message });
    }
    if (!due?.length) return res.json({ ok: true, sent: 0, skipped: 0 });

    // เช็ค line_reminder_enabled ต่อร้าน (batch เดียว กันยิง query ซ้ำต่อรายการ)
    const shopIds = [...new Set(due.map(r => r.shop_id))];
    const [{ data: configs }, { data: shops }] = await Promise.all([
      supabase.from('booking_configs').select('shop_id, line_reminder_enabled').in('shop_id', shopIds),
      supabase.from('shop_profiles').select('id, shop_name').in('id', shopIds),
    ]);
    const configMap = new Map((configs || []).map(c => [c.shop_id, c]));
    const shopNameMap = new Map((shops || []).map(s => [s.id, s.shop_name]));

    let sent = 0, skipped = 0;
    for (const r of due) {
      const cfg = configMap.get(r.shop_id);
      if (cfg && cfg.line_reminder_enabled === false) { skipped++; continue; }

      const bkk = new Date(new Date(r.start_at).getTime() + 7 * 3600 * 1000);
      const dateLabel = `${bkk.getUTCDate()}/${bkk.getUTCMonth() + 1}/${bkk.getUTCFullYear() + 543}`;
      const timeLabel = formatBangkokHM(new Date(r.start_at));
      const shopName = shopNameMap.get(r.shop_id) || 'ร้านค้า';
      const text = [
        `🔔 แจ้งเตือนนัดหมาย`,
        `พรุ่งนี้ (${dateLabel}) คุณมีนัด "${r.service_name}" เวลา ${timeLabel} น. ที่ ${shopName}`,
        `รหัสการจอง: ${r.booking_no}`,
      ].join('\n');

      const ok = await pushLineMessage(r.customer_line_id, { type: 'text', text });
      if (ok) {
        await supabase.from('booking_reservations').update({ reminder_sent_at: new Date().toISOString() })
          .eq('shop_id', r.shop_id).eq('booking_no', r.booking_no);
        sent++;
      } else {
        skipped++;
      }
    }

    return res.json({ ok: true, sent, skipped, total: due.length });
  } catch (err) {
    console.error('[cron/booking-reminders]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
