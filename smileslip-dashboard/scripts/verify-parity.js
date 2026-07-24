/**
 * เครื่องมือกลาง เทียบข้อมูลระหว่าง Google Sheets (ของเดิม) กับ Supabase (ตารางใหม่ที่ย้ายมา
 * ระหว่าง migration แบบ strangler-fig) — รันหลังทำ dual-write ของแต่ละตารางเสร็จ ก่อนจะสลับ
 * ไปอ่านจาก Supabase จริง (ดูแผน migration เต็มใน git history/แชท)
 *
 * ตั้งใจไม่ hardcode schema ต่อตาราง (เพราะแต่ละ tier ยังไม่ได้สร้างตารางจริงตอนเขียนสคริปต์นี้)
 * — รับพารามิเตอร์ทาง CLI แทน ใช้ซ้ำได้กับทุกตารางที่ย้ายในอนาคตโดยไม่ต้องแก้โค้ด
 *
 * วิธีใช้:
 *   node scripts/verify-parity.js \
 *     --shop <shopId> \
 *     --sheet-tab "กะเงินสด" --sheet-amount-col 5 [--sheet-header-rows 1] \
 *     --supabase-table pos_cash_shifts --supabase-amount-col opening_cash [--supabase-shop-col shop_id]
 *
 * คืนค่า exit code 0 ถ้ายอด/จำนวนแถวตรงกัน, 1 ถ้าไม่ตรง (เผื่อเอาไปต่อ CI ในอนาคต)
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      out[key] = val;
    }
  }
  return out;
}

async function getAccessToken(refreshToken) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
  });
  const d = await res.json();
  if (!d.access_token) throw new Error('Google token refresh ล้มเหลว: ' + JSON.stringify(d));
  return d.access_token;
}

async function readSheet(accessToken, sheetId, range) {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const d = await res.json();
  if (!res.ok) throw new Error(`Sheets read error: ${d.error?.message || res.status}`);
  return d.values || [];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const required = ['shop', 'sheet-tab', 'sheet-amount-col', 'supabase-table', 'supabase-amount-col'];
  const missing = required.filter(k => args[k] === undefined);
  if (missing.length) {
    console.error('ขาดพารามิเตอร์:', missing.map(k => `--${k}`).join(', '));
    console.error('ตัวอย่าง: node scripts/verify-parity.js --shop <shopId> --sheet-tab "กะเงินสด" --sheet-amount-col 5 --supabase-table pos_cash_shifts --supabase-amount-col opening_cash');
    process.exit(2);
  }

  const shopId = args.shop;
  const headerRows = parseInt(args['sheet-header-rows'] || '1', 10);
  const sheetAmountCol = parseInt(args['sheet-amount-col'], 10);
  const supabaseShopCol = args['supabase-shop-col'] || 'shop_id';

  // ── ฝั่ง Sheets ──────────────────────────────────────────────────────────
  const { data: pc } = await supabase.from('pos_configs').select('pos_sheet_id').eq('shop_id', shopId).single();
  const { data: gc } = await supabase.from('shop_google_configs').select('google_refresh_token').eq('shop_id', shopId).single();
  if (!pc?.pos_sheet_id) throw new Error('ร้านนี้ยังไม่ได้ตั้งค่า POS (ไม่มี pos_sheet_id)');
  if (!gc?.google_refresh_token) throw new Error('ร้านนี้ยังไม่ได้เชื่อมต่อ Google');

  const token = await getAccessToken(gc.google_refresh_token);
  const rows = await readSheet(token, pc.pos_sheet_id, `'${args['sheet-tab']}'!A:Z`);
  const dataRows = rows.slice(headerRows).filter(r => r.some(c => c));
  const sheetCount = dataRows.length;
  const sheetSum = dataRows.reduce((s, r) => s + (parseFloat(r[sheetAmountCol]) || 0), 0);

  // ── ฝั่ง Supabase ────────────────────────────────────────────────────────
  const { data: supaRows, error: supaErr, count: supaCount } = await supabase
    .from(args['supabase-table'])
    .select(args['supabase-amount-col'], { count: 'exact' })
    .eq(supabaseShopCol, shopId);

  if (supaErr) {
    console.error(`อ่านตาราง Supabase "${args['supabase-table']}" ไม่ได้:`, supaErr.message);
    console.error('(ถ้ายังไม่ได้รัน SQL สร้างตาราง ผลลัพธ์นี้คือที่คาดไว้ — ยังเทียบไม่ได้จนกว่าจะสร้างตาราง)');
    process.exit(2);
  }
  const supabaseSum = (supaRows || []).reduce((s, r) => s + (parseFloat(r[args['supabase-amount-col']]) || 0), 0);

  console.log(`\n=== เทียบข้อมูล: ${args['sheet-tab']} (Sheets) vs ${args['supabase-table']} (Supabase) — shop ${shopId} ===`);
  console.log(`จำนวนแถว   — Sheets: ${sheetCount}  |  Supabase: ${supaCount}  |  ${sheetCount === supaCount ? '✅ ตรงกัน' : '❌ ไม่ตรงกัน'}`);
  console.log(`ยอดรวม     — Sheets: ${sheetSum.toFixed(2)}  |  Supabase: ${supabaseSum.toFixed(2)}  |  ${Math.abs(sheetSum - supabaseSum) < 0.01 ? '✅ ตรงกัน' : '❌ ไม่ตรงกัน'}`);

  const ok = sheetCount === supaCount && Math.abs(sheetSum - supabaseSum) < 0.01;
  process.exit(ok ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(1); });
