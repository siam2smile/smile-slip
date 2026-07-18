/**
 * POST /api/banking/kbank-notify
 * KBank Business API Webhook — รับแจ้งเตือนการโอนเงิน
 *
 * TODO: ใส่ logic จริงเมื่อได้รับ API key จาก KBank
 * ต้องสมัคร KBank Biz API ที่ https://apiportal.kasikornbank.com/
 *
 * Format ของ payload ที่ KBank ส่งมา (ตัวอย่าง):
 * {
 *   transRef: "TXN20240705123456",
 *   amount: 350.00,
 *   currency: "THB",
 *   sendingBank: "004",
 *   senderAccountNo: "xxx",
 *   senderName: "นาย สมชาย",
 *   receivingBank: "004",
 *   receiverAccountNo: "xxx",
 *   transactionDateTime: "2024-07-05T14:30:00+07:00",
 *   billPaymentRef1: "...",
 *   billPaymentRef2: "..."
 * }
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // TODO: Verify KBank webhook signature
  // const signature = req.headers['x-kbank-signature'];

  const body = req.body || {};
  console.log('[kbank-notify] received:', JSON.stringify(body));

  try {
    // TODO: หา shop ที่มี kbank_api_key ตรงกับบัญชีรับเงิน
    // TODO: หาบิล POS ที่ status=รอยืนยัน และยอดตรงกับ body.amount ภายใน 30 นาที
    // TODO: เรียก confirm-payment เพื่ออัปเดตสถานะ

    // ตอนนี้แค่ log ไว้
    return res.json({ ok: true, received: true });

  } catch (err) {
    console.error('[kbank-notify]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
