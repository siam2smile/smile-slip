/**
 * GET  /api/booking/setup?shopId=xxx  — เช็คว่าเปิดใช้ระบบจองแล้วหรือยัง
 * POST /api/booking/setup { shopId }  — เปิดใช้ครั้งแรก (สร้างแถว booking_configs)
 *
 * ต่างจาก delivery/setup.js ตรงที่ไม่ต้องพึ่ง Google Drive/Sheets เลย — โมดูลนี้เป็น Supabase
 * ล้วนตั้งแต่วันแรก จึงไม่มีขั้นตอน provisioning ภายนอกให้รอ
 */
import { createClient } from '@supabase/supabase-js';
import { requireOwnerAuth } from '../../../lib/owner-auth';
import { hasFeature, upgradeMessage } from '../../../lib/tier-features';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  const { shopId } = req.method === 'GET' ? req.query : req.body;
  if (!shopId) return res.status(400).json({ error: 'Missing shopId' });
  if (!requireOwnerAuth(req, res, shopId, { enforce: true })) return;

  if (req.method === 'GET') {
    const { data } = await supabase.from('booking_configs').select('*').eq('shop_id', shopId).maybeSingle();
    return res.json({ configured: !!data, enabled: !!data?.enabled });
  }

  if (req.method === 'POST') {
    try {
      const { data: shop } = await supabase.from('shop_profiles').select('subscription_tier').eq('id', shopId).maybeSingle();
      const tier = shop?.subscription_tier || 'normal';
      if (!hasFeature(tier, 'booking')) {
        return res.status(403).json({ error: upgradeMessage('booking'), featureLocked: true });
      }

      const { error } = await supabase.from('booking_configs')
        .upsert({ shop_id: shopId, enabled: true }, { onConflict: 'shop_id' });
      if (error) throw error;
      return res.json({ ok: true });
    } catch (err) {
      console.error('[booking/setup]', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ error: 'Method not allowed' });
}
