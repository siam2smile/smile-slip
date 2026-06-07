# Smile Slip Pro — Project Brief for Claude

โปรเจกต์ของ Vespa / Siam Global Network Enterprise
ภาษาหลักในโค้ดและ comment: **ไทย**
อัปเดตล่าสุด: 2026-06-06 (deploy-web.sh + .env refactor)

---

## ภาพรวม

Smile Slip Pro คือ B2B SaaS สำหรับร้านค้าและ SME ไทย — ให้พนักงานส่งรูปสลิปโอนเงินหรือบิลรายจ่ายเข้ากลุ่ม LINE บอทจะอ่าน OCR ด้วย Gemini AI แล้วบันทึกลง Google Drive + Google Sheets ของลูกค้าอัตโนมัติ มีระบบเครดิต (สแกน 1 ครั้ง = 1 เครดิต) และ Dashboard เว็บสำหรับจัดการร้านค้า

**หลักการสำคัญ (PDPA):** ข้อมูลการเงินส่วนตัว (ยอดเงิน, ชื่อผู้โอน, รูปสลิป) เก็บใน **Google Drive/Sheets ของลูกค้าเท่านั้น** ไม่เก็บลง Supabase

---

## Tech Stack

### Bot (`smileslip-pro/`)
| Layer | Tech |
|-------|------|
| Runtime | Node.js ≥20, Express |
| LINE | Webhook POST `/webhook`, Reply API + Push API |
| OCR | Gemini API `gemini-3.5-flash` (fallback: `gemini-2.5-flash`) via REST |
| Storage | Google Drive API v3 (multipart upload) |
| Spreadsheet | Google Sheets API v4 |
| Database | Supabase (`@supabase/supabase-js` ^2) — เฉพาะข้อมูลร้านค้า/เครดิต |
| Deploy | Cloud Run `smileslip-service`, region `asia-southeast1` |

### Dashboard (`smileslip-dashboard/`)
| Layer | Tech |
|-------|------|
| Framework | Next.js 14, React 18 |
| UI | Tailwind CSS, lucide-react |
| Auth | LINE LIFF SDK (CDN) + Email+Password fallback |
| Database | Supabase (anon key บน client, service role บน server) |
| Billing | Stripe (Checkout Sessions + Webhook) — Next.js API routes |
| Deploy | Cloud Run `smileslip-dashboard-...`, region `asia-southeast1` |

---

## โครงสร้างไฟล์สำคัญ

```
/
├── smileslip-pro/
│   ├── index.js            ← หัวใจหลัก: webhook bot + OCR + Google integration
│   ├── package.json
│   ├── deploy-bot.sh       ← สคริปต์ deploy (รันจาก smileslip-pro/ เสมอ)
│   └── .env                ← secrets (gitignored)
│
├── smileslip-dashboard/
│   ├── pages/
│   │   ├── index.js        ← landing page (มี SEO meta tags)
│   │   ├── login.js        ← LIFF auto-login + Email fallback
│   │   ├── register.js     ← สมัครสมาชิก 4 ขั้น (dropdown จังหวัด/อำเภอ, ธนาคาร, password)
│   │   ├── dashboard.js    ← หน้าหลัก (top navbar สีน้ำเงิน, วันที่/เวลา real-time)
│   │   ├── pricing.js      ← แพ็กเกจ + เติมเครดิต (มี UI ครบ 3 แพ็กเกจ)
│   │   ├── admin.js        ← admin panel (password จาก env, ไม่ใช้ Supabase Auth)
│   │   ├── terms.js        ← เงื่อนไข 8 ข้อ (PDPA + Stripe compliant)
│   │   ├── privacy.js      ← นโยบายความเป็นส่วนตัว 8 ข้อ (PDPA compliant)
│   │   ├── 404.js          ← custom error page
│   │   ├── payment/
│   │   │   └── success.js  ← หน้าชำระเงินสำเร็จ (auto redirect 5 วิ)
│   │   └── api/
│   │       ├── create-checkout-session.js  ← Stripe checkout (Next.js API)
│   │       ├── register.js                 ← บันทึกร้านค้า + เครดิต + ธนาคาร + password hash
│   │       ├── webhooks/
│   │       │   └── stripe.js              ← Stripe webhook (raw body, signature verify)
│   │       ├── admin/
│   │       │   ├── login.js               ← verify ADMIN_PASSWORD
│   │       │   └── update-shop.js         ← update tier/credits/delete
│   │       ├── auth/
│   │       │   ├── line.js                ← LINE OAuth redirect / LIFF profile handler
│   │       │   ├── check-user.js          ← เช็คว่า LINE userId มีในระบบหรือยัง
│   │       │   ├── email-login.js         ← verify email + password_hash (Node crypto)
│   │       │   ├── callback/line.js       ← LINE OAuth callback → dashboard/register
│   │       │   └── google/
│   │       │       ├── connect.js         ← redirect to Google OAuth
│   │       │       └── callback.js        ← สร้าง Drive folder + Sheet (10 col) + bonus 30 เครดิต
│   │       └── sheets/
│   │           └── transactions.js        ← อ่าน Google Sheets ส่งให้ Dashboard Ledger
│   ├── data/
│   │   └── thailand-address.js            ← ข้อมูลจังหวัด/อำเภอ 77 จังหวัด + ธนาคาร 17 แห่ง
│   ├── stripe-server.js    ← Express server เก่า (ไม่ได้รันใน production แล้ว — ใช้ Next.js API แทน)
│   ├── deploy-web.sh       ← deploy dashboard (รันจาก smileslip-dashboard/)
│   └── .env                ← secrets (gitignored)
│
├── cloudbuild.yaml         ← CI/CD: push main → auto-deploy bot
└── deploy.sh               ← wrapper
```

---

## Supabase Tables (ข้อมูลจริง)

| ตาราง | ใช้ทำอะไร | หมายเหตุ |
|-------|----------|---------|
| `shop_profiles` | ข้อมูลร้านค้า: owner_line_id, line_group_id, shop_name, subscription_tier, google_folder_id, google_sheet_id, tax_id, address, email, phone, **password_hash** | `subscription_tier`: normal/pro/advance/super |
| `shop_credits` | เครดิตคงเหลือ `balance_credits` (integer) | |
| `shop_google_configs` | google_refresh_token, google_folder_id, google_sheet_id, google_email | **bot อ่าน token จากตารางนี้** |
| `shop_branches` | สาขา: shop_id, branch_name, line_group_id, is_active | รองรับ multi-branch |
| `shop_bank_accounts` | บัญชีธนาคาร: bank_name, account_name, account_number, account_type | |
| `credit_purchase_history` | ประวัติซื้อแพ็กเกจผ่าน Stripe | |
| `credit_topup_history` | ประวัติเติมเครดิต | |
| `usage_logs` | log การใช้งาน | |

> **สำคัญ:** `google_tokens` table ไม่มีอยู่จริง — bot อ่าน refresh_token จาก `shop_google_configs` เท่านั้น
> **สำคัญ:** `ledger_transactions` ยังมีใน DB แต่ bot **ไม่ได้ insert** แล้ว (PDPA) — ข้อมูลธุรกรรมอยู่ใน Google Sheets ลูกค้า
> **สำคัญ:** `password_hash` column ถูกเพิ่มแล้ว 2026-06-03 ด้วย `ALTER TABLE shop_profiles ADD COLUMN IF NOT EXISTS password_hash TEXT;`

---

## Bot Flow (เมื่อมีคนส่งสลิปใน LINE)

```
1. ตอบ HTTP 200 ทันที (กัน LINE timeout → retry)
2. เช็ค duplicate ด้วย webhookEventId (in-memory Map, TTL 5 นาที)
3. findShopBySource(sourceId):
   - ค้นหาจาก shop_profiles.line_group_id หรือ owner_line_id
   - ถ้าไม่พบ → ค้นหาจาก shop_branches.line_group_id (สาขา)
4. เช็คเครดิตคงเหลือ (Super plan ข้ามขั้นตอนนี้ไม่ตัดเครดิต)
5. ดาวน์โหลดรูปจาก LINE (timeout 15s)
6. extractDataWithGemini() → ด้วย withRetry(3 ครั้ง, backoff 2s)
   - Primary: gemini-3.5-flash (v1 endpoint)
   - Fallback: gemini-2.5-flash (เมื่อ 503 หมด retry)
   - อ่าน: type, amount, date, time, sender, receiver, note, tax_id, taxpayer_name, tax_amount, tax_address
7. [Optional] Google Drive/Sheets — แยก try/catch ไม่หยุดระบบถ้า Google พัง
   - อ่าน refresh_token จาก shop_google_configs
   - สร้างโฟลเดอร์: root → ปี ค.ศ. (2026) → เดือน (06-2026)
   - อัปโหลดรูป → บันทึก Sheets (10 คอลัมน์ รวม recorded_at ISO + branch_name)
8. ตัดเครดิต -1 (Super plan ข้าม)
9. Push แจ้งเจ้าของส่วนตัว (Pro+ เมื่อสาขาส่งสลิป)
10. ตอบ Flex Message ในกลุ่ม (แยก try/catch)
```

## Text Command Flow (เมื่อพิมพ์คำสั่งใน LINE)

```
#ช่วยเหลือ / #help    → ทุกแพ็กเกจ: แสดงคำสั่งที่ใช้ได้
#สรุปวันนี้           → Pro+: อ่าน Sheets filter วันนี้ → Flex สรุปยอด
#สรุปเดือนนี้         → Pro+: อ่าน Sheets filter เดือนนี้
#กำไรขาดทุน           → Pro+: รายรับ - รายจ่าย = กำไรสุทธิ
#สรุปทุกสาขา          → Advance+: รวมทุกสาขาเดือนนี้
```

---

## Google Sheets Structure (10 คอลัมน์) — ต้องตรงกับที่ Bot เขียน

| คอลัมน์ | Header | ข้อมูล |
|---------|--------|--------|
| A | วันที่สลิป | วันที่จาก OCR |
| B | เวลา | เวลาจาก OCR |
| C | ประเภท (รายรับ/รายจ่าย) | type จาก OCR |
| D | จำนวนเงิน (บาท) | amount |
| E | ผู้โอน | sender |
| F | ผู้รับ | receiver |
| G | หมายเหตุ | note |
| H | ลิงก์สลิป (Drive) | Google Drive URL |
| I | วันที่บันทึก (recorded_at) | YYYY-MM-DD |
| J | ชื่อสาขา | branch_name |

## Google Drive Structure

```
SMILE SLIP - {ชื่อร้าน}  ← root (google_folder_id ใน shop_profiles)
└── 2026/                 ← ปี ค.ศ.
    └── 06-2026/          ← เดือน-ปี
        └── slip_1500THB_06-2026_timestamp.jpg
```

---

## Auth Flow

### LINE LIFF (หลัก)
```
เปิดหน้า /login → โหลด LIFF SDK จาก CDN
→ liff.init({ liffId: NEXT_PUBLIC_LIFF_ID })
→ ถ้าไม่ได้ login → liff.login() auto-redirect
→ liff.getProfile() → userId, displayName
→ GET /api/auth/check-user?userId=xxx
→ มีบัญชี → /dashboard?userId=xxx
→ ไม่มีบัญชี → /register?userId=xxx&name=xxx
```

### LINE OAuth2 (fallback เมื่อ LIFF ไม่ทำงาน)
```
/api/auth/line → redirect LINE OAuth → /api/auth/callback/line
→ เช็ค shop_profiles → dashboard/register
```

### Email Login (fallback)
```
POST /api/auth/email-login → เช็ค email + verify password_hash (pbkdf2)
→ คืน userId → /dashboard?userId=xxx
```

### Register (ต้อง LINE เท่านั้นครั้งแรก)
```
Step 1: ข้อมูลธุรกิจ (ชื่อร้าน, เลขภาษี, สาขา, บุคคล/นิติบุคคล)
Step 2: ที่อยู่ + ติดต่อ (dropdown จังหวัด→อำเภอ, ตำบล, รหัสไปรษณีย์)
Step 3: บัญชีธนาคาร + ตั้ง Password + ยืนยัน Terms
Step 4: สำเร็จ (ได้เครดิตเริ่มต้น 20 แผ่น)
```

---

## Stripe Flow

```
pricing.js → POST /api/create-checkout-session → Stripe Checkout
→ ลูกค้าจ่ายเงิน
→ Stripe POST /api/webhooks/stripe (raw body, verify signature)
→ checkout.session.completed
  → subscription: update shop_profiles.subscription_tier
  → credit: update shop_credits.balance_credits
→ redirect /payment/success → auto redirect dashboard 5s
```

**Webhook URL ที่ตั้งใน Stripe Dashboard:**
`https://smileslip-backend-832247688217.asia-southeast1.run.app/webhook/stripe`

---

## Admin Panel

- URL: `/admin`
- Login: ใช้ `ADMIN_PASSWORD` จาก env (ไม่ใช้ Supabase Auth)
- Password เริ่มต้น: `SmileSlipAdmin2569!` (เปลี่ยนได้ใน `smileslip-dashboard/.env`)
- Session: เก็บใน sessionStorage (token base64)
- Features: ดูร้านทั้งหมด, เปลี่ยน tier inline, เติม/ตั้งค่าเครดิต, ลบร้าน, ค้นหา, filter by tier

---

## ระบบ Tier / แพ็กเกจ

| แพ็กเกจ | ราคา | สาขา Max | ฟีเจอร์พิเศษใน Bot |
|---------|------|---------|-------------------|
| Normal | ฟรี | 1 | สแกนสลิปอย่างเดียว |
| Shop Pro | 199/เดือน | 1 | #สรุปวันนี้, #สรุปเดือน, #กำไรขาดทุน, Push แจ้งเจ้าของ |
| Advance | 499/เดือน | 5 | + #สรุปทุกสาขา |
| Super | 2990/เดือน | 20 | ไม่ตัดเครดิต (unlimited scan) |

เครดิตเติมแยก: 100 แผ่น (฿99) / 500 แผ่น (฿299) / 1,000 แผ่น (฿499)

---

## Environment Variables สำคัญ

### Bot (`smileslip-pro/.env`)
```
SUPABASE_URL, SUPABASE_KEY
LINE_CHANNEL_ACCESS_TOKEN       ← Messaging API (ไม่ใช่ LINE Login)
GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
GEMINI_API_KEY
GEMINI_MODEL=gemini-3.5-flash
FRONTEND_URL
```

### Dashboard (`smileslip-dashboard/.env`)
> `deploy-web.sh` อ่าน secret จาก `.env` อัตโนมัติ — **ไม่มี hardcode ในสคริปต์แล้ว** (แก้ไข 2026-06-06)
```
NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_KEY   ← sb_publishable_... (key format ใหม่)
SUPABASE_URL, SUPABASE_KEY                            ← sb_publishable_...
SUPABASE_SERVICE_ROLE_KEY                             ← sb_secret_... (bypass RLS สำหรับ Stripe webhook)
STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
LINE_CHANNEL_ACCESS_TOKEN                             ← Messaging API (Push notification)
LINE_CHANNEL_SECRET                                   ← Messaging API channel secret
LINE_LOGIN_SECRET                                     ← LINE Login channel (แยกจาก Messaging API)
NEXT_PUBLIC_LINE_LOGIN_CHANNEL_ID=2009797558
NEXT_PUBLIC_LIFF_ID=2009797558-LMletOqM
GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI
NEXT_PUBLIC_BASE_URL, FRONTEND_URL
ADMIN_PASSWORD=SmileSlipAdmin2569!
```

---

## Deploy

```bash
# Bot — รันจาก smileslip-pro/ เสมอ
cd smileslip-pro && bash deploy-bot.sh

# Dashboard — รันจาก smileslip-dashboard/ เสมอ
cd smileslip-dashboard && bash deploy-web.sh

# ดู log prod
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="smileslip-service"' \
  --limit=50 --freshness=1h --format='value(timestamp,textPayload)' --project=smileslip-accounting-pro
```

---

## สิ่งที่ทำเสร็จแล้ว ✅

### Bot
- [x] รับสลิปจาก LINE → Gemini 3.5-flash OCR (endpoint: v1)
- [x] Retry 3 ครั้ง + Fallback gemini-2.5-flash อัตโนมัติเมื่อ 503
- [x] อ่านสลิปโอนเงิน + บิลรายจ่าย + ข้อมูลภาษี
- [x] Google Drive: root → ปี ค.ศ. → เดือน-ปี (Gregorian year)
- [x] Google Sheets: 10 คอลัมน์ (รวม recorded_at + branch_name)
- [x] Flex Message ละเอียด (สีเขียว=รายรับ/แดง=รายจ่าย)
- [x] ตอบ 200 OK ทันที + Duplicate Guard (webhookEventId, TTL 5 นาที)
- [x] Multi-branch: findShopBySource()
- [x] Super plan ไม่ตัดเครดิต
- [x] Push แจ้งเจ้าของส่วนตัว (Pro+)
- [x] Text Commands: #สรุปวันนี้, #สรุปเดือนนี้, #กำไรขาดทุน (Pro+)
- [x] #สรุปทุกสาขา (Advance+)
- [x] #ช่วยเหลือ แสดงคำสั่งตามแพ็กเกจ
- [x] PDPA compliant (ไม่เก็บข้อมูลการเงินใน Supabase)
- [x] LINE Signature Verification (HMAC-SHA256)

### Dashboard
- [x] Login: LIFF (CDN) + LINE OAuth2 fallback + Email+Password
- [x] Register: 4 ขั้น (dropdown จังหวัด/อำเภอ 77 จังหวัด, ธนาคาร 17 แห่ง, password)
- [x] Dashboard: top navbar สีน้ำเงิน, วันที่/เวลา real-time, sidebar slim
- [x] Ledger: อ่านจาก Google Sheets
- [x] สาขา: เพิ่ม/ลบ shop_branches
- [x] Settings: บัญชีธนาคาร
- [x] Pricing: ทุก plan + เติมเครดิต UI ครบ + Stripe Checkout
- [x] Admin Panel: tier/credits/delete, ค้นหา, filter, expand detail
- [x] Google OAuth: สร้าง Drive + Sheet (10 col ถูกต้อง) + bonus 30 เครดิต
- [x] Settings tab: แสดง shop profile (name/email/phone/address/tier) + แก้ไขได้ + Google Drive connect section (แก้ไข 2026-06-06)
- [x] API: `/api/shop/update-profile` — update shop_name, email, phone ด้วย service role key
- [x] Terms (8 ข้อ) + Privacy (8 ข้อ) PDPA+Stripe compliant
- [x] 404 custom page
- [x] SEO meta tags ใน landing page
- [x] payment/success.js (auto redirect 5 วิ)

### Billing
- [x] Stripe Checkout Session: `/api/create-checkout-session` (Next.js API)
- [x] Stripe Webhook: `/api/webhooks/stripe` (raw body + signature verify)
- [x] Webhook: เติมเครดิตอัตโนมัติ
- [x] Webhook: อัปเดต subscription_tier
- [x] Test mode prices สร้างแล้ว 2026-06-06 (ใช้สำหรับทดสอบด้วยบัตร Stripe test)

### Infrastructure
- [x] CI/CD: push main → Cloud Build → deploy bot อัตโนมัติ
- [x] LIFF ID: `2009797558-LMletOqM`
- [x] Admin password: ใน env var (ไม่ hardcode)
- [x] `deploy-web.sh` อ่าน secret จาก `.env` (ไม่มี hardcode) — เหมือน `deploy-bot.sh` (แก้ไข 2026-06-06)
- [x] Supabase key format ใหม่: `sb_publishable_...` (anon), `sb_secret_...` (service role)

---

## สิ่งที่ยังเหลือ / ต้องทำด้วยมือ ⬜

- [x] **อัปเดต Stripe Webhook URL** → `https://smileslip-backend-832247688217.asia-southeast1.run.app/webhook/stripe`
- [x] **เพิ่ม `SUPABASE_SERVICE_ROLE_KEY`** ใน .env เรียบร้อย
- [x] **ลบ `pages/edit.js` และ `pages/ledger.js`** — ลบแล้ว 2026-06-06
- [ ] แจ้งเตือนเครดิตใกล้หมด (Push LINE เมื่อ < 10 แผ่น)
- [ ] Rate limiting บน `/api/webhooks/stripe`
- [ ] Error monitoring (Sentry หรือ Cloud Error Reporting)
- [ ] หน้าแก้ไขโปรไฟล์ร้านค้า (ชื่อ, ที่อยู่, เบอร์)
- [ ] Export รายงาน PDF/Excel รายเดือน
- [ ] Trial period (Pro 7 วันฟรี)

---

## ข้อควรระวังสำคัญ

1. **deploy-bot.sh ต้องรันจาก `smileslip-pro/`**
2. **deploy-web.sh ต้องรันจาก `smileslip-dashboard/`** — ถ้ารันจาก root จะ upload `.codeoss` และ crash
3. **LINE channel แยกกัน** — `LINE_CHANNEL_ACCESS_TOKEN` + `LINE_CHANNEL_SECRET` = Messaging API, `LINE_LOGIN_SECRET` = LINE Login (คนละ channel คนละค่า)
4. **Google token** — bot อ่านจาก `shop_google_configs.google_refresh_token` เท่านั้น
5. **Supabase columns** — เครดิตใช้ `balance_credits`, password ใช้ `password_hash`
6. **Gemini endpoint** — ใช้ `v1` (ไม่ใช่ `v1beta`) สำหรับ gemini-3.5-flash
7. **ห้าม hardcode secret** — repo เป็น public, deploy scripts อ่านจาก `.env` เสมอ
8. **PDPA** — ห้าม insert ข้อมูลธุรกรรม (ยอดเงิน, ชื่อคน) ลง Supabase
9. **stripe-server.js** — เป็น Express server เก่า ไม่ได้รันใน production แล้ว (ใช้ Next.js API แทน)
10. **@line/liff** — ห้ามติดตั้งเป็น npm package (SSR พัง) ใช้ CDN เท่านั้น
11. **Supabase key format ใหม่** — ใช้ `sb_publishable_...` สำหรับ anon key, `sb_secret_...` สำหรับ service role (ไม่ใช่ JWT `eyJ...` อีกต่อไป)
12. **ห้าม query Supabase จาก client โดยตรง** — แอปใช้ LINE Auth ไม่ใช่ Supabase Auth ทำให้ RLS `auth.uid()` ใช้ไม่ได้ ทุก DB query ต้องผ่าน API route ที่ใช้ service role key เสมอ (`/api/shop/data`, `/api/shop/branches`, `/api/shop/update-profile`, ฯลฯ)

---

## Cloud Run Services

| Service | URL |
|---------|-----|
| Bot | `https://smileslip-service-832247688217.asia-southeast1.run.app` |
| Dashboard | `https://smileslip-dashboard-832247688217.asia-southeast1.run.app` |
| Project | `smileslip-accounting-pro` |
| Dashboard Revision ล่าสุด | `smileslip-dashboard-00100-jrb` |
