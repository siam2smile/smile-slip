/**
 * POST /api/banking/scb-notify
 * SCB API Platform Webhook — รับแจ้งเตือนการโอนเงิน
 *
 * TODO: ใส่ logic จริงเมื่อได้รับ API key จาก SCB
 * ต้องสมัคร SCB API Platform ที่ https://developer.scb.co.th/
 *
 * Format ของ payload ที่ SCB ส่งมา (ตัวอย่าง):
 * {
 *   transactionId: "TXN20240705123456",
 *   transactionType: "CREDIT",
 *   transactionDateTime: "2024-07-05T14:30:00.000Z",
 *   amount: 350.00,
 *   currency: "THB",
 *   debtorAccount: { accountNumber: "xxx", name: "นาย สมชาย", bank: { code: "014" } },
 *   creditorAccount: { accountNumber: "xxx", name: "ร้านค้า" },
 *   paymentRef1: "...",
 *   paymentRef2: "...",
 *   paymentRef3: "..."
 * }
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // TODO: Verify SCB webhook token
  // const token = req.headers['authorization'];

  const body = req.body || {};
  console.log('[scb-notify] received:', JSON.stringify(body));

  try {
    // TODO: หา shop ที่มี scb_api_key ตรงกับบัญชีรับเงิน
    // TODO: หาบิล POS ที่ status=รอยืนยัน และยอดตรงกับ body.amount ภายใน 30 นาที
    // TODO: เรียก confirm-payment เพื่ออัปเดตสถานะ

    return res.json({ ok: true, received: true });

  } catch (err) {
    console.error('[scb-notify]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
