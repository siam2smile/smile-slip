# Smile Slip Pro — Project Brief for Claude

โปรเจกต์ของ Vespa / Siam Global Network Enterprise
ภาษาหลักในโค้ดและ comment: **ไทย**
อัปเดตล่าสุด: 2026-07-15 (แก้ pos.js เสียหายระดับ disk, แก้บั๊ก VCF quoted-printable, เพิ่ม retry ให้ Google Sheets ใน POS — ดูหัวข้อ "เหตุการณ์และบั๊กที่แก้แล้ว (2026-07-15)")

---

## ภาพรวม

Smile Slip Pro คือ B2B SaaS สำหรับร้านค้าและ SME ไทย — ให้พนักงานส่งรูปสลิปโอนเงินหรือบิลรายจ่ายเข้ากลุ่ม LINE บอทจะอ่าน OCR ด้วย Gemini AI แล้วบันทึกลง Google Drive + Google Sheets ของลูกค้าอัตโนมัติ มีระบบเครดิต (สแกน 1 ครั้ง = 1 เครดิต) และ Dashboard เว็บสำหรับจัดการร้านค้า

**หลักการสำคัญ (PDPA):** ข้อมูลการเงินส่วนตัว (ยอดเงิน, ชื่อผู้โอน, รูปสลิป) เก็บใน **Google Drive/Sheets ของลูกค้าเท่านั้น** ไม่เก็บลง Supabase

---

## เหตุการณ์และบั๊กที่แก้แล้ว (2026-07-15)

**บริบท:** วินโดว์เครื่อง dev ล่มก่อนหน้านี้ ย้ายโปรเจกต์ไปไดร์ใหม่ + ลงเครื่องใหม่ทั้งหมด (Node.js, Google Cloud SDK ไม่มีเลยตอนแรก) ระหว่างตรวจสอบพบว่าไฟล์หลายไฟล์ (`smileslip-dashboard/pages/pos.js`, `smileslip-dashboard/lib/*`, ไฟล์ API หลายสิบไฟล์) **ไม่เคย commit ขึ้น git มาก่อนเลย** ทำให้เกือบเสียงานถาวรตอนไฟล์เสียหาย (ดูข้อถัดไป)

1. **`pos.js` (4,212 บรรทัด, ไฟล์ใหญ่สุดในโปรเจกต์) เสียหายระดับ disk** — พบ NUL byte ยาว 4,096 ไบต์ (เท่าขนาด disk block) แทรกอยู่ 4 จุด (บรรทัด ~812, 1991, 2825, 3708) ทับซ้อนโค้ดจริงจนไฟล์ compile ไม่ผ่าน `/pos` ใช้งานไม่ได้เลย เพราะไฟล์นี้ไม่เคย commit จึงไม่มี backup ใน git — กู้คืนสำเร็จโดยดึง source จาก Cloud Build ของ deploy ที่สำเร็จล่าสุด (bucket `run-sources-smileslip-accounting-pro-asia-southeast1`) มาเทียบ byte-diff กับไฟล์เสีย พบว่าเหมือนกันทุกไบต์ยกเว้น 4 จุดที่เสีย → กู้คืนแล้ว commit เข้า git ทันที (commit `bd5ac1f`)
2. **บั๊กนำเข้าผู้ติดต่อจาก VCF (มือถือ) แสดงชื่อเป็นรหัสดิบ** — เช่น `=E0=B8=AA=E0=B8=B8...` แทนที่จะเป็นชื่อไทย สาเหตุ: `parseVCFText` ใน `pos.js` ไม่รองรับ vCard ที่เข้ารหัส `ENCODING=QUOTED-PRINTABLE` (พบมากในไฟล์ export จาก Android/Samsung) แก้โดยเพิ่ม decoder แปลง `=XX` เป็นไบต์แล้ว decode UTF-8 จริง รวมถึงรองรับกรณีค่ายาวถูกตัดข้ามบรรทัดแบบ soft-break ด้วย (commit `055e27e`)
3. **เพิ่มสินค้าใน POS ไม่ได้ (500 error)** — log จริงจาก production: `[pos/products] Sheets append error: The service is currently unavailable` (Google Sheets API 503 ชั่วคราว) แต่ `lib/google-pos.js` ไม่มี retry เลยสักฟังก์ชัน (ต่างจากบอทที่มี retry ให้ Gemini) แก้โดยเพิ่ม retry 3 ครั้งพร้อม backoff บน 429/500/502/503/504 ให้ `readSheet`/`appendSheet`/`updateSheetRow` (commit `9602058`)
4. **พบไฟล์เสียหายจากเหตุการณ์เดียวกันอีกไฟล์: `pages/api/pos/sales.js`** — ตอน deploy ขึ้น production ครั้งแรกหลังแก้ 3 ข้อบน Cloud Build fail ด้วย error `stream did not contain valid UTF-8` ตรวจสอบพบว่าไฟล์ขนาดเท่าเดิมทุกไบต์แต่มีข้อมูลผิดเพี้ยนกระจายอยู่ ~3,000 จุด (คนละแบบกับ NUL-byte padding ของ pos.js) — กู้คืนจาก Cloud Build source เดียวกัน (2026-07-08) แล้วรัน `npm run build` local เต็มโปรเจกต์เพื่อยืนยันว่าไม่มีไฟล์อื่นเสียหายอีก (สำเร็จทุก route) ก่อน deploy จริง (commit `ae8eb45` → revision `smileslip-dashboard-00234-j9l`, pin traffic 100% แล้ว)
   - **บทเรียน:** ไฟล์ที่เสียหายจากเหตุการณ์เครื่องล่มอาจมีมากกว่า 1 ไฟล์ และ syntax check แบบ sucrase เพียงอย่างเดียวไม่พอ (pos.js ผ่าน sucrase แต่จริง ๆ ก็เคยพังเพราะ NUL byte) — ทางที่ชัวร์สุดคือรัน `npm run build` เต็มโปรเจกต์ก่อน deploy ทุกครั้งหลังกู้ไฟล์ที่สงสัยว่าเสียหาย
5. **เพิ่มฟีเจอร์ QR รับเงินแบบ Biller ID (Thai QR Payment / Bill Payment)** — เดิม POS รองรับแค่พร้อมเพย์ส่วนบุคคล (Tag 29: เบอร์โทร/เลขนิติบุคคล 13 หลัก ผ่านไลบรารี `promptpay-qr`) แต่บางร้าน/บริษัทรับเงินผ่าน **Biller ID ที่ธนาคารออกให้ต่างหาก** (Tag 30, มาตรฐาน ITMX เดียวกันทุกธนาคาร ไม่จำกัดแค่ SCB/KBank) ซึ่งเป็นคนละระบบกับพร้อมเพย์โดยสิ้นเชิง (เงินไม่ผ่านทะเบียนพร้อมเพย์ แต่เข้าบัญชีที่ผูกกับ Biller ID นั้นตรง ๆ) เพิ่ม `lib/thai-qr-billpayment.js` (self-written ตามสเปก EMVCo/ธปท. เพราะไม่มี npm package รองรับ Tag 30) + แก้ `api/pos/promptpay-qr.js` ให้เช็ค `pos_configs.scb_biller_id` ก่อน ถ้ามีค่าใช้ Bill Payment แทนพร้อมเพย์ทันที + เพิ่มช่องกรอก "Biller ID จากธนาคาร" แยกในหน้าตั้งค่า POS ของ `pos.js` (self-service ต่อร้าน ไม่ hardcode) — commit `2cf344e`
   - **ข้อควรระวัง:** เลขที่โชว์บนหน้าจอ "QR รับเงิน" ของแอปธนาคาร (เช่น "เลขอ้างอิง" ใน K SHOP ของ KBank) **อาจไม่ใช่ Biller ID จริง** ต้องเข้าไปดูใน "แก้ไขข้อมูลร้านค้า"/merchant settings ของแอปธนาคารเพื่อหา Biller ID ตัวจริงมากรอก (พบเคสจริง: K SHOP โชว์ "เลขอ้างอิง: KPS004KB000001925570" แต่ Biller ID จริงคือ `010753600031508` คนละเลขกันเลย)
6. **แก้ 5 ข้อจาก punch list ตรวจสอบโค้ดเต็มโปรเจกต์ (commit `e01c927`):**
   - **Stripe webhook idempotency** — เพิ่ม insert `event.id` ลงตาราง `stripe_processed_events` ก่อนประมวลผลทุกครั้ง ถ้า insert ชนซ้ำ (unique violation, code `23505`) แปลว่าเคยประมวลผลไปแล้ว ข้ามได้เลย ถ้า error เป็นแบบอื่น (เช่น ตารางยังไม่ถูกสร้าง) จะ fail-open ทำงานต่อไปเหมือนเดิมกันไม่ให้ checkout พังทั้งระบบ — **สร้างตาราง `stripe_processed_events` แล้ว (verified 2026-07-16 ผ่าน REST query) กันซ้ำได้จริงแล้ว ไม่ fail-open อีกต่อไป**
   - **`api/admin/pos-stats.js` และ `delivery-stats.js`** เช็ค token ผิดรูปแบบมาตั้งแต่สร้าง (เทียบ decoded token กับ `ADMIN_PASSWORD` ตรง ๆ แทนที่จะเช็ค prefix `smileslip-admin:` แบบไฟล์ admin อื่น) ทำให้ admin login ปกติเรียกใช้ไม่ได้ 401 ตลอด — แก้ให้ตรงกับ pattern เดียวกับไฟล์ admin อื่นแล้ว
   - **`lib/google-delivery.js`** เดิมรู้อยู่แล้วว่าบัญชี Google ภาษาไทยได้ tab ชื่อ "แผ่น1" ไม่ใช่ "Sheet1" แต่ API ทุกไฟล์ hardcode "Sheet1" ตรง ๆ — แก้ที่ต้นตอโดยบังคับ rename tab แรกเป็น "Sheet1" เสมอตอนสร้าง spreadsheet ใหม่ (ไม่ต้องแก้ทุก API route)
   - **`api/shop/branches.js`** เพิ่มการเช็คจำนวนสาขาปัจจุบันเทียบ `MAX_BRANCHES` ตาม tier ก่อน insert (เดิมกันแค่ฝั่ง client เท่านั้น ยิง API ตรงเพิ่มเกิน limit ได้) — ต้องตรงกับ `MAX_BRANCHES` ใน `smileslip-pro/index.js` เสมอถ้าจะแก้ค่า limit ในอนาคต
   - ลบ `StampSVG()` dead code ใน `pages/invoice/request.js` ออกแล้ว (ยืนยันซ้ำว่าไม่มีที่เรียกใช้ที่ไหนก่อนลบ)
   - **ยังไม่ทำ:** ข้อ KBank/SCB auto-confirm webhook (`api/banking/kbank-notify.js`, `scb-notify.js`) ยังเป็น scaffolding 0% เหมือนเดิม — ต้องมี API credential จริงจากธนาคารก่อนถึงจะเขียนต่อได้ (รอผู้ใช้ติดต่อธนาคารขอ credential)

**ข้อควรระวังใหม่ที่เพิ่มจากเหตุการณ์นี้:**
- **Git identity ของเครื่องนี้ตั้งแบบ repo-local เท่านั้น** (`user.name=Vespa`, `user.email=six.papigod@gmail.com`) ไม่ใช่ global — ถ้าย้ายเครื่อง/ไดร์อีกต้องตั้งใหม่
- **ผู้ใช้ต้องการให้ commit + push ขึ้น GitHub ทันทีทุกครั้งที่แก้ไฟล์** ไม่ต้องรอถามก่อน (แต่ยังต้องเช็คไม่ให้ commit secret และไม่ bundle ไฟล์เก่าที่ค้างอยู่โดยไม่ถามก่อน)
- **Push ขึ้น GitHub ≠ deploy ขึ้น production** — dashboard ไม่มี auto-deploy จาก git push (มีแค่บอท `smileslip-service` ที่ auto-deploy ผ่าน Cloud Build เมื่อ push main) ทุกครั้งที่แก้ไฟล์ฝั่ง dashboard ต้องเตือนผู้ใช้/ถามว่าจะ `gcloud run deploy` เข้า production เลยไหม
- **ไฟล์ `smileslip-dashboard/lib/*` และ `pages/pos*.js`, `pages/delivery.js` ฯลฯ จำนวนมากไม่เคยอยู่ใน git มาก่อน** — ถ้าเจอไฟล์ที่ยังไม่ track ระหว่างทำงาน ให้ถือว่าเป็นความเสี่ยงเดียวกับที่เกิดกับ `pos.js` และ commit ทันทีเมื่อมีโอกาส

---

## Tech Stack

### Bot (`smileslip-pro/`)
| Layer | Tech |
|-------|------|
| Runtime | Node.js ≥20, Express |
| LINE | Webhook POST `/webhook`, Reply API + Push API |
| OCR | Hybrid: Google Cloud Vision → Gemini `gemini-3.5-flash` text-mode → Gemini image-mode (**ห้ามเปลี่ยน model เป็น gemini-2.5-flash — deprecated ในโปรเจกต์นี้**) |
| Storage | Google Drive API v3 (multipart upload) |
| Spreadsheet | Google Sheets API v4 |
| Database | Supabase (`@supabase/supabase-js` ^2) — เฉพาะข้อมูลร้านค้า/เครดิต |
| Deploy | Cloud Run `smileslip-service`, region `asia-southeast1` |

### Dashboard (`smileslip-dashboard/`)
| Layer | Tech |
|-------|------|
| Framework | Next.js 14, React 18 |
| UI | Tailwind CSS, lucide-react |
| Auth | LINE LIFF SDK (CDN) + LINE OAuth2 + Email+Password |
| Database | Supabase (ทุก DB query ต้องผ่าน API route ที่ใช้ service role key เท่านั้น) |
| Billing | Stripe Subscriptions + One-time payment — Next.js API routes |
| Charts | CSS bar charts (ห้ามใช้ recharts — lock file ไม่ sync) |
| Deploy | Cloud Run `smileslip-dashboard`, region `asia-southeast1` |

---

## Cloud Run Services

| Service | URL | Revision ล่าสุด |
|---------|-----|----------------|
| Bot | `https://smileslip-service-832247688217.asia-southeast1.run.app` | `smileslip-service-00137-8vb` |
| Dashboard | `https://smileslip-dashboard-832247688217.asia-southeast1.run.app` | `smileslip-dashboard-00223-mbm` |
| Project | `smileslip-accounting-pro` | region: `asia-southeast1` |

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
│   │   ├── register.js     ← สมัครสมาชิก 4 ขั้น + รองรับ ?ref=SMILE-XXXX
│   │   ├── dashboard.js    ← หน้าหลัก (tabs: home/ledger/analytics/branches/settings)
│   │   ├── pricing.js      ← 5-tier + เติมเครดิต 4 แพ็กเกจ + referral section
│   │   ├── admin.js        ← admin panel (tabs: shops / ใบแจ้งหนี้+ภาษี / ตั้งค่า Google+email)
│   │   ├── invoice/
│   │   │   └── request.js  ← หน้าขอใบแจ้งหนี้ (ลูกค้ากรอกข้อมูล → admin อนุมัติ → ใบกำกับภาษี)
│   │   ├── terms.js        ← เงื่อนไข 8 ข้อ (PDPA + Stripe compliant)
│   │   ├── privacy.js      ← นโยบายความเป็นส่วนตัว 8 ข้อ (PDPA compliant)
│   │   ├── 404.js          ← custom error page
│   │   ├── payment/
│   │   │   └── success.js  ← หน้าชำระเงินสำเร็จ (auto redirect 5 วิ)
│   │   └── api/
│   │       ├── create-checkout-session.js  ← Stripe checkout (ดึง stripe_customer_id, cancel_url ใช้ owner_line_id)
│   │       ├── register.js                 ← บันทึกร้านค้า + เครดิต 20 + ธนาคาร + password hash + referral_code
│   │       ├── webhooks/
│   │       │   └── stripe.js              ← Stripe webhook (checkout.completed / invoice.payment_succeeded / subscription.deleted)
│   │       ├── admin/
│   │       │   ├── login.js               ← verify ADMIN_PASSWORD
│   │       │   ├── update-shop.js         ← update tier/credits/delete
│   │       │   ├── invoices.js            ← GET/PATCH ใบแจ้งหนี้ + issue (→ Sheet + email)
│   │       │   ├── shops.js               ← GET รายชื่อร้านทั้งหมด
│   │       │   ├── settings.js            ← GET admin Google email + sheet id
│   │       │   ├── send-email.js          ← POST ส่ง HTML tax invoice ทาง Gmail (nodemailer)
│   │       │   └── google/
│   │       │       ├── connect.js         ← redirect ไป Google OAuth สำหรับ admin บริษัท
│   │       │       └── callback.js        ← รับ token + สร้าง Invoice Sheet + บันทึก admin_settings
│   │       ├── auth/
│   │       │   ├── line.js                ← LINE OAuth redirect / LIFF POST handler (ใช้ service role key, insert shop_credits ด้วย)
│   │       │   ├── check-user.js          ← เช็คว่า LINE userId มีในระบบหรือยัง
│   │       │   ├── email-login.js         ← verify email + password_hash (pbkdf2)
│   │       │   ├── callback/line.js       ← LINE OAuth callback (ใช้ service role key)
│   │       │   └── google/
│   │       │       ├── connect.js         ← redirect to Google OAuth
│   │       │       └── callback.js        ← สร้าง Drive folder + Sheet (11 col) + bonus 30/50 เครดิต + referral bonus
│   │       └── shop/
│   │           ├── data.js                ← GET ข้อมูลร้านทั้งหมด (profile + credits + google + branches + banks)
│   │           ├── bank-accounts.js       ← GET/POST/DELETE บัญชีธนาคาร
│   │           ├── branches.js            ← GET/POST/DELETE สาขา
│   │           ├── update-profile.js      ← PATCH shop_name, email, phone, tax_id, user_type, address (ครบทุกฟิลด์)
│   │           ├── referral.js            ← GET referral code + stats (auto-generate ถ้ายังไม่มี)
│   │           └── analytics.js          ← GET กราฟ/สถิติจาก Google Sheets (tier-gated)
│   │       └── sheets/
│   │           └── transactions.js        ← อ่าน Google Sheets ส่งให้ Dashboard Ledger
│   │       └── export/
│   │           └── excel.js              ← Export Excel รายเดือน (xlsx)
│   │       └── invoice/
│   │           └── save.js               ← POST บันทึก invoice_requests (ลูกค้ายื่นขอใบแจ้งหนี้)
│   ├── data/
│   │   └── thailand-address.js            ← ข้อมูลจังหวัด/อำเภอ 77 จังหวัด + ธนาคาร 17 แห่ง
│   ├── deploy-web.sh       ← deploy dashboard (รันจาก smileslip-dashboard/)
│   └── .env                ← secrets (gitignored)
│
├── cloudbuild.yaml         ← CI/CD: push main → auto-deploy bot
└── deploy.sh               ← wrapper
```

---

## Supabase Tables — Schema จริง (verified 2026-06-28)

| ตาราง | Columns จริง | หมายเหตุ |
|-------|-------------|---------|
| `shop_profiles` | id, owner_line_id, shop_name, tax_id, **entity_type**, address, created_at, **user_type**, email, phone, branch_name, subscription_tier, line_group_id, owner_id, google_folder_id, google_sheet_id, password_hash, referral_code, referred_by, stripe_customer_id, stripe_subscription_id, **subscription_expires_at**, **stripe_billed_tier**, **stripe_period_end**, **google_bonus_granted** | มีทั้ง entity_type และ user_type (สองคอลัมน์แยกกัน!) tier: normal/pro/advance/business/enterprise/super — 4 คอลัมน์ท้ายเพิ่ม 2026-06-28 (ดูหัวข้อ "Subscription Expiry + Stripe Mismatch Detection" ด้านล่าง) |
| `shop_credits` | shop_id (PK), balance_credits, updated_at | |
| `shop_google_configs` | shop_id (PK), google_refresh_token, google_folder_id, google_sheet_id, updated_at, google_email | **bot + dashboard อ่าน token จากตารางนี้** |
| `shop_branches` | id, shop_id, branch_name, line_group_id, is_active, created_at | |
| `shop_bank_accounts` | id, shop_id, bank_name, account_number, account_name, is_active, account_type | |
| `shop_admins` | id, shop_id, line_user_id, display_name, created_at, status | ผู้ดูแลระบบของแต่ละร้าน (ไม่ใช่ admin บริษัท) |
| `credit_packages` | id, package_name, price, credit_amount, is_active | |
| `credit_purchase_history` | id, shop_id, package_id (nullable), amount_paid, status, slip_url, created_at | bot insert แค่บางคอลัมน์ — suppress error ไว้แล้ว |
| `credit_topup_history` | id, shop_id, amount_paid, credits_added, topup_slip_url, topup_status, created_at | ยังไม่มีโค้ด insert (future) |
| `usage_logs` | id, created_at, transaction_id, line_user_id, **amont** (typo!), status, note | ยังไม่มีโค้ด insert; ถ้าจะ insert ต้องใช้ชื่อ `amont` ตามจริง |
| `ledger_transactions` | id, shop_id, type, amount, category, note, slip_url, slip_hash, status, created_at, sender_name, raw_data | มีใน DB แต่ bot **ไม่ insert** (PDPA) — ข้อมูลอยู่ใน Google Sheets |
| `invoice_requests` | id, shop_id, plan_id, is_yearly, base_price, vat_amount, total_price, wht_amount, net_amount, buyer_name, buyer_tax_id, buyer_branch, buyer_address, buyer_email, buyer_phone, invoice_no, tax_invoice_no, status, created_at, approved_at | status: pending/approved/issued/rejected ✅ มีอยู่แล้ว |
| `slip_analytics` | id, slip_id, shop_id, branch_id, slip_date, hour_of_day, day_of_week, week_of_year, month, year, amount_bucket, transaction_type, sender_hash, sender_bank, slip_type, created_at | ✅ มีอยู่แล้ว |
| `sender_profiles` | id, shop_id, sender_hash, sender_bank, first_seen, last_seen, total_transactions, amount_bucket_mode, frequency_score, updated_at | ✅ มีอยู่แล้ว |
| `shop_usage_daily` | id, shop_id, branch_id, date, slip_count, income_count, expense_count, active_hours, unique_senders | ✅ มีอยู่แล้ว |
| `admin_settings` | key (PK), value, updated_at | ✅ มีอยู่แล้ว (verified 2026-06-28) |
| `pos_configs` | shop_id (PK), pos_folder_id, pos_sheet_id, created_at | ❌ **ต้องสร้างก่อนใช้ /pos** |
| `delivery_configs` | shop_id (PK), delivery_folder_id, customer_sheet_id, order_sheet_id, created_at | ❌ **ต้องสร้างก่อนใช้ /delivery** |
| `users` | id, created_at, line_user_id, credits, google_sheet_id, display_name | Legacy table เก่า — ไม่ได้ใช้งานแล้ว |

> **สำคัญ:** `google_tokens` table ไม่มีอยู่จริง — bot อ่าน refresh_token จาก `shop_google_configs` เท่านั้น
> **สำคัญ:** ห้าม query Supabase จาก client โดยตรง — ทุก query ต้องผ่าน API route ที่ใช้ **service role key**

---

## ระบบ Tier / แพ็กเกจ (อัปเดต 2026-06-08)

| แพ็กเกจ | DB value | ราคา | สาขา Max | เครดิต/เดือน | ฟีเจอร์พิเศษ |
|---------|----------|------|---------|------------|------------|
| Starter | `normal` | ฟรี | 1 | 50 (ครั้งเดียว) | สแกนสลิป + คีย์เอง |
| Shop Pro | `pro` | ฿199 | 1 | 200 | #สรุป, #กำไรขาดทุน, Push แจ้งเจ้าของ, Analytics |
| Advance | `advance` | ฿499 | 5 | 500 | + #สรุปทุกสาขา, Branch comparison |
| Business | `business` | ฿999 | 10 | 1,000 | + Top Sender, 3 Admin |
| Enterprise | `enterprise` | ฿2,990 | 20 | ไม่จำกัด | Unlimited scan, VIP Support, Custom report |
| (legacy) | `super` | — | 20 | ไม่จำกัด | = enterprise (backward compat) |

**TIER_LEVEL:** `{ normal:0, pro:1, advance:2, business:3, enterprise:4, super:4 }`

### Stripe Price IDs (Production)

| แพ็กเกจ | รายเดือน | รายปี |
|--------|---------|------|
| Shop Pro ฿199 | `price_1TfERr3ZvivzvZ6qPXOhc10t` | `price_1TfERr3ZvivzvZ6qbsLKKPlV` |
| Advance ฿499 | `price_1TfERs3ZvivzvZ6qw9SB10YE` | `price_1TfERs3ZvivzvZ6qPKQaBSHQ` |
| Business ฿999 | `price_1Tg4zU3ZvivzvZ6ql61Q0szc` | `price_1Tg4zU3ZvivzvZ6qP2AE2Yz0` |
| Enterprise ฿2,990 | `price_1TfERs3ZvivzvZ6qrTxPwYKs` | `price_1TfERt3ZvivzvZ6qgpoAJvaU` |
| เติม 100 แผ่น ฿99 | `price_1TfERt3ZvivzvZ6qfbOMCZnp` | — |
| เติม 500 แผ่น ฿299 | `price_1TfERu3ZvivzvZ6q96qkkfKx` | — |
| เติม 1,000 แผ่น ฿499 | `price_1TfERu3ZvivzvZ6qpTZDUhHZ` | — |
| เติม 3,000 แผ่น ฿999 | `price_1Tg56f3ZvivzvZ6qX4163cg5` | — |

### Stripe Webhook Events (ต้องครบทั้ง 3)
- `checkout.session.completed` → อัปเดต tier + บันทึก stripe_customer_id/subscription_id
- `invoice.payment_succeeded` → เติมเครดิตรายเดือนอัตโนมัติ
- `customer.subscription.deleted` → downgrade กลับ normal

**Webhook URL:** `https://smileslip-backend-832247688217.asia-southeast1.run.app/webhook/stripe`

---

## Bot Flow (เมื่อมีคนส่งสลิปใน LINE)

```
1. ตอบ HTTP 200 ทันที (กัน LINE timeout → retry)
2. LINE Signature Verification (HMAC-SHA256) — reject ถ้าไม่ใช่ LINE จริง
3. Duplicate Guard ชั้น 1: webhookEventId (in-memory Map, TTL 5 นาที)
4. findShopBySource(sourceId):
   - ค้นหาจาก shop_profiles.line_group_id หรือ owner_line_id
   - ถ้าไม่พบ → ค้นหาจาก shop_branches.line_group_id (สาขา)
5. เช็คเครดิตคงเหลือ (Enterprise/Super ข้ามขั้นตอนนี้)
6. ดาวน์โหลดรูปจาก LINE + คำนวณ MD5 hash
7. Duplicate Guard ชั้น 2: image hash (in-memory, TTL 24 ชม.)
8. Hybrid OCR:
   - Cloud Vision API → ข้อความดิบ
   - ถ้าได้ข้อความ → Gemini text-mode (เร็วกว่า 2-3x)
   - ถ้าข้อความน้อยเกิน → Gemini image-mode
   - Fallback: retry ด้วย model เดิม (gemini-3.5-flash) 3 ครั้ง เมื่อ 503 — ห้ามเปลี่ยนเป็น gemini-2.5-flash
   - อ่าน: type, amount, date, time, sender, receiver, note, ref_no, tax_id, taxpayer_name, tax_amount, tax_address
9. ตรวจสอบ income/expense จากชื่อบัญชีร้าน (shop_bank_accounts) + ชื่อร้าน + ชื่อสาขาทุกสาขา:
   - receiver ตรงกับชื่อบัญชี/ชื่อร้าน/ชื่อสาขาใดก็ได้ → income
   - sender ตรงกับชื่อบัญชี/ชื่อร้าน/ชื่อสาขาใดก็ได้ → expense
   - ไม่ match → เชื่อ Gemini
   - (`detectTypeFromBankAccounts(slipData, bankAccounts, extraNames)` — extraNames = [shop_name, ...branch_names])
10. Duplicate Guard ชั้น 3: Sheets column K — ref_no หรือ image hash
11. [Optional] Google Drive/Sheets — แยก try/catch ไม่หยุดระบบถ้า Google พัง
    - อ่าน refresh_token จาก shop_google_configs
    - สร้างโฟลเดอร์: root → ปี ค.ศ. → เดือน-ปี
    - อัปโหลดรูป → บันทึก Sheets (11 คอลัมน์)
12. ตัดเครดิต -1 (Enterprise/Super ข้าม)
13. แจ้งเตือนเครดิตใกล้หมด (Push LINE เจ้าของเมื่อ < 10 แผ่น)
14. Push แจ้งเจ้าของส่วนตัว (Pro+ เมื่อสาขาส่งสลิป)
15. ตอบ Flex Message + quote รูปต้นทาง (quoteToken)
```

## Text Command Flow (เมื่อพิมพ์คำสั่งใน LINE)

```
#ช่วยเหลือ / #help      → ทุกแพ็กเกจ: แสดงคำสั่งตาม tier
#วิธีใช้งาน             → ทุกแพ็กเกจ: เมนู Flex เลือกหัวข้อสอนใช้งาน (8 หัวข้อ) แต่ละหัวข้อมีปุ่มสลับแบบคร่าวๆ/ละเอียด — เพิ่ม 2026-06-28
รับ NNN หมายเหตุ        → ทุกแพ็กเกจ (ทุกคนในกลุ่ม): คีย์รายรับเอง (เงินสด) — แก้ไข 2026-07-03
รับโอน NNN หมายเหตุ     → ทุกแพ็กเกจ (ทุกคนในกลุ่ม): คีย์รายรับเอง (เงินโอน) — แก้ไข 2026-07-03
จ่าย NNN หมายเหตุ       → ทุกแพ็กเกจ (ทุกคนในกลุ่ม): คีย์รายจ่ายเอง (เงินสด) — แก้ไข 2026-07-03
จ่ายโอน NNN หมายเหตุ    → ทุกแพ็กเกจ (ทุกคนในกลุ่ม): คีย์รายจ่ายเอง (เงินโอน) — แก้ไข 2026-07-03
#สรุปวันนี้             → Pro+: ยอดวันนี้
#สรุปเดือนนี้           → Pro+: ยอดเดือนนี้
#สรุปอาทิตย์นี้         → Pro+: ยอดอาทิตย์นี้ (จันทร์-อาทิตย์)
#สรุปปีนี้             → Pro+: ยอดทั้งปี
#สรุปวันที่ 07/06       → Pro+: ยอดย้อนหลังรายวัน
#กำไรขาดทุน            → Pro+: รายรับ - รายจ่าย
#รายงาน               → Pro+: รายงานเดือนนี้
#สรุปทุกสาขา           → Advance+: รวมทุกสาขาเดือนนี้
```

> **คำสั่งสรุปทุกแบบ (#สรุป...) แก้บั๊ก 400 เมื่อ tab ปียังไม่ถูกสร้าง — 2026-06-28:** ทุก handler เรียก `getOrCreateYearSheet()` ก่อนอ่านข้อมูลเสมอ (เดิมอ่าน range ตรงๆ ถ้า tab ปีนั้นไม่มีอยู่จะ throw 400 จาก Sheets API)

---

## Google Sheets Structure (18 คอลัมน์ A-R — อัปเดต 2026-06-28)

| คอลัมน์ | Header | ข้อมูล |
|---------|--------|--------|
| A | วันที่สลิป | วันที่จาก OCR |
| B | เวลา | เวลาจาก OCR |
| C | ประเภท (รายรับ/รายจ่าย) | type จาก OCR + bank account correction — **ห้ามแก้/เปลี่ยนความหมายคอลัมน์นี้** ระบบอื่นพึ่งพาอยู่มาก |
| D | จำนวนเงิน (บาท) | amount |
| E | ผู้โอน | sender |
| F | ผู้รับ | receiver |
| G | หมายเหตุ | note |
| H | ลิงก์สลิป (Drive) | Google Drive URL |
| I | วันที่บันทึก (recorded_at) | YYYY-MM-DD |
| J | ชื่อสาขา | branch_name |
| K | เลขอ้างอิง/Hash | ref_no จากธนาคาร หรือ MD5 image hash (ใช้ตรวจซ้ำ) |
| L | เลขภาษี | tax_id จาก OCR (ถ้ามี) |
| M | ชื่อผู้เสียภาษี | taxpayer_name จาก OCR |
| N | ยอดภาษี (บาท) | tax_amount จาก OCR |
| O | ที่อยู่ผู้เสียภาษี | tax_address จาก OCR |
| P | หมวดหมู่ | detectCategory() Gemini + learned rules (Business+) |
| Q | วิธีรับ-จ่าย (โอน/เงินสด) | สลิป OCR = "โอน" เสมอ, คีย์เอง = "เงินสด" ถ้าพิมพ์เปล่า หรือ "โอน" ถ้าพิมพ์ รับโอน/จ่ายโอน — **เพิ่ม 2026-06-28** |
| R | ผู้บันทึก | ชื่อ LINE display name ของคนที่คีย์รายการเอง (ไม่มีค่าถ้าเป็นสลิป OCR) — **เพิ่ม 2026-06-28** |

> **Sheet เก่า**: `getOrCreateYearSheet()` ใน bot จะ auto-patch header คอลัมน์ K/P/Q/R ที่ขาดไปทุกครั้งที่มีการบันทึกรายการใหม่เข้า tab ปีนั้น ไม่ต้องเข้าไปเติม header เองใน Sheets แล้ว (เดิมต้องทำมือ — แก้ไข 2026-06-28)

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
เปิดหน้า /login → โหลด LIFF SDK จาก CDN (ห้ามติดตั้งเป็น npm)
→ liff.init({ liffId: NEXT_PUBLIC_LIFF_ID })
→ liff.login() auto-redirect ถ้ายังไม่ login
→ liff.getProfile() → userId, displayName
→ GET /api/auth/check-user?userId=xxx
→ มีบัญชี → /dashboard?userId=xxx
→ ไม่มีบัญชี → /register?userId=xxx&name=xxx
```

### LINE OAuth2 (fallback)
```
GET /api/auth/line → redirect LINE OAuth → /api/auth/callback/line
→ เช็ค shop_profiles → /dashboard หรือ /register
```

### Email Login (fallback สุดท้าย)
```
POST /api/auth/email-login → เช็ค email + verify password_hash (pbkdf2)
→ คืน userId (owner_line_id) → /dashboard?userId=xxx
```

### Register
```
Step 1: ข้อมูลธุรกิจ (ชื่อร้าน, เลขภาษี, บุคคล/นิติบุคคล)
Step 2: ที่อยู่ + ติดต่อ (dropdown 77 จังหวัด → อำเภอ)
Step 3: บัญชีธนาคาร (17 แห่ง) + ตั้ง Password + ยืนยัน Terms
Step 4: สำเร็จ (ได้ 20 เครดิตเริ่มต้น)
→ รองรับ ?ref=SMILE-XXXX (referral code จะ set referred_by)
```

### Google OAuth (เชื่อมต่อ Drive)
```
Settings → "เชื่อมต่อ Google" → /api/auth/google/connect
→ Google OAuth → /api/auth/google/callback
→ ถ้า reconnect (มี folder/sheet เดิมอยู่แล้ว) → reuse folder/sheet เดิม ไม่สร้างใหม่
→ ถ้า first connect → สร้าง Drive folder + Sheet 18 คอลัมน์ใหม่
→ upsert shop_google_configs (refresh_token, folder_id, sheet_id, email)
→ bonus +30 เครดิต (หรือ +50 ถ้ามี referred_by) — เช็คผ่าน shop_profiles.google_bonus_granted เท่านั้น
→ referrer ได้ +50 เครดิตด้วย (ครั้งแรกเท่านั้น)
```
> **แก้ไข 2026-06-28:** เดิมเช็คว่าเคยให้โบนัสหรือยังจากการ "มีแถวอยู่ใน shop_google_configs" ซึ่งทำให้บางเคส reconnect ได้โบนัสซ้ำ (พบเคสจริง เครดิต 47→77) ตอนนี้ใช้ flag `google_bonus_granted` บน `shop_profiles` เช็คแทน กันซ้ำเด็ดขาด

---

## Referral System (อัปเดต 2026-06-08)

- ทุกร้านมี `referral_code` รูปแบบ `SMILE-XXXX` (auto-generate เมื่อเปิด dashboard)
- ลิงก์: `{BASE_URL}/register?ref=SMILE-XXXX`
- เงื่อนไขได้รับ bonus: ร้านที่ถูกแนะนำต้องเชื่อมต่อ Google Drive ก่อน (กัน abuse)
- bonus: ผู้ถูกแนะนำ +50 เครดิต, ผู้แนะนำ +50 เครดิต
- แต่ละร้านถูกแนะนำได้ครั้งเดียว (referred_by เปลี่ยนไม่ได้)
- API: `GET /api/shop/referral?shopId=xxx` → คืน referralCode, referralCount, creditsEarned, referralUrl

---

## Analytics System (อัปเดต 2026-06-12)

- API: `GET /api/shop/analytics?shopId=xxx&year=2026&month=06`
- อ่านจาก Google Sheets โดยตรง (ไม่เก็บใน Supabase)
- Tier-gated:
  - Pro+: รายวัน (default) + รายเดือน toggle, summary cards, month picker
  - Advance+: branch comparison
  - Business+: top senders table, Tax Report (year+month)
- Dashboard แสดงด้วย CSS bars (ไม่ใช้ recharts)
- response มี `dailyData` (เดือนที่เลือก) + `dailySummary` + `monthlyData` + `summary` (ทั้งปี)

---

## Stripe Flow

```
pricing.js → POST /api/create-checkout-session
  → ดึง stripe_customer_id จาก shop_profiles (สร้างใหม่ถ้าไม่มี)
  → Stripe Checkout Session (mode: subscription หรือ payment)
  → cancel_url ใช้ owner_line_id (ไม่ใช่ UUID!)
→ ลูกค้าจ่ายเงิน
→ Stripe POST /api/webhooks/stripe
  → checkout.session.completed → update tier + บันทึก customer/subscription id
  → invoice.payment_succeeded → เติมเครดิตรายเดือน (billing_reason: subscription_cycle)
  → customer.subscription.deleted → downgrade → normal
→ redirect /payment/success → auto redirect dashboard 5s
```

---

## Subscription Expiry + Stripe Mismatch Detection (เพิ่ม 2026-06-28)

ปัญหาที่แก้: Admin ตั้ง tier มือได้อิสระ (เช่น โปรโมชั่น, ทดลองใช้) แต่ไม่มีวันหมดอายุ และไม่มีทางรู้ว่า tier ที่ตั้งไว้ตรงกับที่ Stripe เก็บเงินจริงหรือไม่ (เช่น ลูกค้ายกเลิก Stripe แต่ Admin ลืม downgrade)

- **`subscription_tier`** — tier ที่ "ใช้งานจริงอยู่ตอนนี้" (สิ่งที่ระบบเช็คสิทธิ์ฟีเจอร์) Admin ตั้งได้อิสระ
- **`subscription_expires_at`** — วันหมดอายุของ tier ที่ Admin ตั้งมือ (เว้นว่าง = ไม่หมดอายุ, ใช้กับ tier ที่จ่ายผ่าน Stripe อัตโนมัติด้วยไม่ได้เพราะ Stripe ต่ออายุเอง)
- **`stripe_billed_tier`** + **`stripe_period_end`** — tier และวันหมดรอบบิลที่ Stripe เก็บเงินจริงล่าสุด (เขียนจาก webhook เท่านั้น ไม่ใช่ Admin ตั้ง)
- Admin UI (`/admin` → tab ร้านค้า) แสดง badge เตือนถ้า `subscription_tier` (ที่ตั้งมือ) ≠ `stripe_billed_tier` (ที่จ่ายจริง) — "⚠️ ไม่ตรงกับ Stripe"
- Admin UI แสดง countdown วันหมดอายุของ tier ที่ตั้งมือ (สีเหลืองถ้าเหลือ ≤7 วัน, สีแดงถ้าหมดแล้ว)
- ปุ่ม "Manual Payment" ใน Admin (โอนจ่ายผ่านบัญชีบริษัท) จะตั้ง tier + เติมเครดิตตาม plan + ตั้งวันหมดอายุให้พร้อมกันในคลิกเดียว
- **Cron `/api/cron/expire-subscriptions`** (Cloud Scheduler job `smileslip-expire-subscriptions`, schedule `0 19 * * *` UTC = 02:00 กรุงเทพ ทุกวัน) — เช็คร้านที่ `subscription_expires_at` หมดแล้วและ tier ≠ normal → downgrade กลับ normal อัตโนมัติ ต้องส่ง header `x-cron-secret` ตรงกับ `CRON_SECRET`

---

## Admin Panel

- URL: `/admin`
- Login: ใช้ `ADMIN_PASSWORD` จาก env
- Password เริ่มต้น: `SmileSlipAdmin2569!`
- Session: sessionStorage (token base64)
- Tabs: **ร้านค้า** / **ใบแจ้งหนี้/ภาษี** / **ตั้งค่า**
- Features ร้านค้า: ดูร้านทั้งหมด, เปลี่ยน tier (6 ตัวเลือก: normal/pro/advance/business/enterprise/super) + วันหมดอายุ, เติม/ตั้งเครดิต, ลบร้าน, ค้นหา, filter tier, เตือน mismatch กับ Stripe (ดูหัวข้อด้านบน)
- Stats card: แสดงจำนวนแยก Normal / Pro / Advance / Business / Enterprise / เครดิตรวม
- Features ใบแจ้งหนี้/ภาษี: ดูคำขอ, อนุมัติ/ปฏิเสธ, ออกใบกำกับภาษี (→ บันทึก Sheet + ส่งอีเมลอัตโนมัติ), พิมพ์ PDF
- Features ตั้งค่า: เชื่อม Google Drive/Sheets บริษัท, ดูสถานะอีเมล

## Invoice Flow (ใบแจ้งหนี้ → ใบกำกับภาษี)

```
1. ลูกค้าเปิด /invoice/request → กรอกข้อมูล → เห็น "ใบแจ้งหนี้" preview (ไม่มีตราประทับ)
2. กด "ส่งคำขอ" → POST /api/invoice/save → บันทึก invoice_requests (status: pending)
3. Admin เปิด /admin → tab "ใบแจ้งหนี้/ภาษี" → เห็น pending
4. Admin กด "อนุมัติ" (status: approved)
5. Admin กด "ออกใบกำกับภาษี" (status: issued):
   - สร้าง TAX-YYYY-XXXX sequential number
   - บันทึก Google Sheet ของบริษัท (admin_invoice_sheet_id)
   - ส่ง HTML email ให้ buyer_email ผ่าน nodemailer (Gmail)
6. Admin พิมพ์ PDF ได้จากหน้า Admin (มีตราประทับ + ลายเซ็น)
```

### Admin Google Sheet (Invoice Register)
สร้างอัตโนมัติตอน Google connect ชื่อ: `SMILE SLIP — ใบกำกับภาษี / Tax Invoice Register`
คอลัมน์: วันที่ออก | เลขที่ใบกำกับภาษี | อ้างอิงใบแจ้งหนี้ | ชื่อผู้ซื้อ | เลขภาษี | สาขา | แพ็กเกจ | รายปี/เดือน | ราคาก่อน VAT | VAT 7% | รวม VAT | WHT 3% | ยอดสุทธิ | อีเมล | เบอร์โทร

---

## Environment Variables สำคัญ

### Bot (`smileslip-pro/.env`)
```
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY   ← หรือ SUPABASE_KEY (fallback)
LINE_CHANNEL_ACCESS_TOKEN   ← Messaging API (ไม่ใช่ LINE Login)
LINE_CHANNEL_SECRET         ← Messaging API channel secret
GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
GEMINI_API_KEY
GEMINI_MODEL=gemini-3.5-flash
GOOGLE_VISION_API_KEY       ← optional, ถ้าไม่มีจะ degrade เป็น Gemini image-mode
FRONTEND_URL                ← URL ของ dashboard (ใช้ใน push notification ลิงก์)
CRON_SECRET                 ← secret สำหรับ /cron/daily-summary และ /cron/weekly-summary (ค่า: SmileSlipCron2569!)
```

### Dashboard (`smileslip-dashboard/.env`)
```
NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_KEY   ← sb_publishable_... (anon, client-side)
SUPABASE_URL, SUPABASE_KEY                            ← sb_publishable_...
SUPABASE_SERVICE_ROLE_KEY                             ← sb_secret_... (bypass RLS, server-side เท่านั้น)
STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
LINE_CHANNEL_ACCESS_TOKEN                             ← Messaging API (Push notification)
LINE_CHANNEL_SECRET                                   ← Messaging API channel secret
LINE_LOGIN_SECRET                                     ← LINE Login channel (คนละ channel!)
NEXT_PUBLIC_LINE_LOGIN_CHANNEL_ID=2009797558
NEXT_PUBLIC_LIFF_ID=2009797558-LMletOqM
GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI
NEXT_PUBLIC_BASE_URL                                  ← https://smileslip-dashboard-...run.app
FRONTEND_URL                                          ← เหมือน NEXT_PUBLIC_BASE_URL
ADMIN_PASSWORD=SmileSlipAdmin2569!
EMAIL_HOST=smtp.gmail.com            ← nodemailer (default smtp.gmail.com)
EMAIL_PORT=465                       ← SSL
EMAIL_USER                           ← Gmail address ของบริษัท
EMAIL_PASS                           ← Gmail App Password (16 ตัวอักษร, ต้องเปิด 2FA)
NEXT_PUBLIC_EMAIL_CONFIGURED         ← "true" หรือ "false" (แสดงใน Admin Settings UI)
CRON_SECRET                          ← ต้องตรงกับของ bot — ใช้ตรวจ header x-cron-secret ของ /api/cron/expire-subscriptions
```

---

## Deploy

```bash
# Bot — Bash tool ล้มเหลวบน Windows (Python not found) ใช้ PowerShell แทน:
# cd smileslip-pro && bash deploy-bot.sh  ← ใช้ไม่ได้บน Windows

# Dashboard — Bash tool ล้มเหลวบน Windows (Python not found) ใช้ PowerShell แทน:
# cd smileslip-dashboard && bash deploy-web.sh  ← ใช้ไม่ได้บน Windows

# วิธี deploy บน Windows — ใช้ PowerShell กับ gcloud โดยตรง (parse .env เอง):
# ดู pattern ใน session ก่อนหน้า หรือใช้ script ด้านล่าง

# ดู log prod (bot)
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="smileslip-service"' \
  --limit=50 --freshness=1h --format='value(timestamp,textPayload)' --project=smileslip-accounting-pro

# ดู log prod (dashboard)
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="smileslip-dashboard"' \
  --limit=50 --freshness=1h --format='value(timestamp,textPayload)' --project=smileslip-accounting-pro

# ดู builds ล่าสุด (region สำคัญ!)
gcloud builds list --region asia-southeast1 --limit=5
```

---

## สิ่งที่ทำเสร็จแล้ว ✅

### Bot
- [x] Hybrid OCR: Cloud Vision → Gemini text-mode → Gemini image-mode (fallback gemini-2.5-flash)
- [x] Retry 3 ครั้ง + backoff 2s + fallback อัตโนมัติเมื่อ 503
- [x] อ่านสลิปโอนเงิน + บิลรายจ่าย + ข้อมูลภาษี (tax_id, tax_amount, taxpayer_name)
- [x] ตรวจสอบ income/expense จากชื่อบัญชีร้าน (shop_bank_accounts) — 2026-06-08
- [x] Google Drive: root → ปี ค.ศ. → เดือน-ปี
- [x] Google Sheets: 11 คอลัมน์ (รวม recorded_at + branch_name + ref_no/hash)
- [x] Flex Message + quote รูปต้นทาง (สีเขียว=รายรับ/แดง=รายจ่าย)
- [x] ตอบ 200 OK ทันที + Duplicate Guard 3 ชั้น (webhookEventId / image hash / Sheets K)
- [x] Multi-branch: findShopBySource()
- [x] Enterprise/Super ไม่ตัดเครดิต
- [x] Push แจ้งเจ้าของส่วนตัว (Pro+)
- [x] แจ้งเตือนเครดิตใกล้หมด (Push LINE < 10 แผ่น)
- [x] Text Commands: #สรุปวันนี้/เดือน/อาทิตย์/ปี/วันที่/กำไร/รายงาน (Pro+)
- [x] #สรุปทุกสาขา (Advance+) — per-branch breakdown แยกรายสาขา — แก้ไข 2026-06-11
- [x] #ช่วยเหลือ แสดงคำสั่งตาม tier
- [x] คีย์รายการเอง: รับ/จ่าย NNN หมายเหตุ — **ทุกคนในกลุ่มใช้ได้** (แก้ไข 2026-07-03 เดิมล็อคเฉพาะเจ้าของ) บันทึกชื่อผู้คีย์ไว้ใน column R เพื่อ audit
- [x] LINE Signature Verification (HMAC-SHA256)
- [x] Error Monitoring (Cloud Error Reporting via structured stderr)
- [x] PDPA compliant (ไม่เก็บข้อมูลการเงินใน Supabase)
- [x] Analytics: recordAnalytics() PDPA-safe (sha256 sender, amount_bucket) — 2026-06-11 (ต้องสร้าง tables ก่อน)
- [x] findShopBySource() คืน branchId ด้วย — 2026-06-11
- [x] **แจ้งเตือนสรุปยอดรายวันอัตโนมัติ** POST `/cron/daily-summary` + Cloud Scheduler 18:00 BKK (job: smileslip-daily-summary) — 2026-06-12
- [x] **แจ้งเตือนสรุปยอดรายสัปดาห์อัตโนมัติ** POST `/cron/weekly-summary` + Cloud Scheduler ทุกวันจันทร์ 18:00 BKK (job: smileslip-weekly-summary)
- [x] **คีย์รายการเองแยกโอน/เงินสด** — รองรับคำขึ้นต้นหลากหลาย (รับ/รับเงิน/รับเงินสด/รับสด/รับโอน/รับโอนเงิน, จ่าย/จ่ายเงิน/จ่ายเงินสด/จ่ายสด/จ่ายตังสด/จ่ายโอน/โอนจ่าย) บันทึกผลลงคอลัมน์ Q — 2026-06-28
- [x] **บันทึกผู้คีย์รายการ** — รายการที่คีย์เอง (ไม่ใช่สลิป OCR) บันทึกชื่อ LINE display name ผู้คีย์ไว้คอลัมน์ R — 2026-06-28
- [x] **Sheets ขยายเป็น 18 คอลัมน์ (A-R)** — เพิ่ม L-O (ข้อมูลภาษี), P (หมวดหมู่), Q (วิธีรับ-จ่าย), R (ผู้บันทึก) — `getOrCreateYearSheet()` auto-patch header คอลัมน์ที่ขาดให้ sheet เก่าทุกครั้งที่บันทึกรายการใหม่ — 2026-06-28
- [x] **แก้บั๊ก #สรุป... ตอบ error 400** — ทุก summary command เรียก `getOrCreateYearSheet()` ก่อนอ่าน Sheets เสมอ (เดิม throw ถ้า tab ปียังไม่ถูกสร้าง) — 2026-06-28
- [x] **แก้บั๊ก OCR อ่านปี พ.ศ./ค.ศ. ผิด (ลายมือ)** — เพิ่ม context วันที่ปัจจุบันในพรอมต์ Gemini + กฎ sanity-bound ปฏิเสธปีที่ห่างจากปีปัจจุบันเกินเหตุ ใน `parseSlipDateForFolder()` — 2026-06-28
- [x] **`#วิธีใช้งาน`** — เมนู Flex เลือกหัวข้อสอนใช้งาน 8 หัวข้อ (สลิป/คีย์เอง/สรุปยอด/สาขา/เครดิต/แก้ไข/กูเกิล/แอดมิน) แต่ละหัวข้อสลับมุมมองคร่าวๆ ↔ ละเอียดได้ — 2026-06-28
- [x] **`#ช่วยเหลือ` อัปเดต** — เพิ่มคำสั่ง รับโอน/จ่ายโอน + แนะนำ `#วิธีใช้งาน` — 2026-06-28
- [x] **แก้บั๊กให้โบนัสเครดิตซ้ำตอน reconnect Google** — เปลี่ยนจากเช็ค "มีแถวใน shop_google_configs" เป็นเช็ค flag `google_bonus_granted` บน shop_profiles แทน (เคสจริง: เครดิตขึ้นจาก 47→77) — 2026-06-28
- [x] **แก้ QR slip "จ่ายบิล" อ่านเป็น expense แทน income** — ปัญหา: confidence <0.75 ทำให้ route ไป image-mode → Gemini อ่าน "จ่ายบิลสำเร็จ" เป็น expense แก้: `isHandwritten = avgConfidence < 0.75 && rawText.length < 100` (ต้องเป็นทั้งสองเงื่อนไข) สลิปดิจิทัลที่มีข้อความยาว >100 chars จะไม่ถูก route ไป image-mode — 2026-07-03
- [x] **เพิ่ม branch names ในการตรวจประเภทสลิป** — `detectTypeFromBankAccounts` รับ `extraNames = [shop_name, ...branch_names]` ด้วย เพราะสลิปอาจแสดงชื่อสาขา (เช่น "ดี แก๊ส") ไม่ใช่ชื่อร้านหลัก — 2026-07-03
- [x] **VAT breakdown ใน Flex Message** — แสดง "ราคาก่อน VAT" + "ภาษีมูลค่าเพิ่ม" เมื่อ OCR อ่าน tax_amount > 0 — 2026-07-03
- [x] **Tax fields ในหน้าแก้ไขธุรกรรม** — เพิ่มช่อง ยอด VAT / เลขภาษี / ชื่อผู้เสียภาษี ใน `/transaction/edit` + API `update-transaction` เขียน column L-N — 2026-07-03
- [x] **Tax Report CSV filter** — export เฉพาะแถวที่มี taxId (ไม่ใช่ "-") AND taxAmount > 0 (ไม่รวมแถวที่ไม่มี VAT) — 2026-07-03
- [x] **แก้ Google OAuth callback bug** — `shop_google_configs` มี PK = `shop_id` ไม่มี column `id` เดิม `.select('id, ...')` ทำให้ error `column shop_google_configs.id does not exist` แก้: ลบ `id` ออกจาก select — 2026-07-03
- [x] **Google OAuth redirect URI เพิ่ม custom domain** — เพิ่ม `https://smileslippro.com/api/auth/google/callback` (shop owner flow ผ่าน custom domain) — 2026-07-03
- [x] **Google OAuth verification** — app อยู่ใน verification queue แล้ว (status: under verification), branding verified, authorized domains: smileslippro.com + Cloud Run URL — 2026-07-03

### Dashboard
- [x] Login: LIFF (CDN) + LINE OAuth2 + Email+Password
- [x] Register: 4 ขั้น + referral code support (?ref=)
- [x] Dashboard tabs: Home / Ledger / Analytics / Branches / Settings
- [x] Home: referral section (auto-generate code, copy link, stats)
- [x] Ledger: อ่านจาก Google Sheets + Export Excel
- [x] Analytics: monthly bar chart + branch comparison + top senders (tier-gated)
- [x] Branches: เพิ่ม/ลบ shop_branches
- [x] Settings: shop profile + แก้ไข + บัญชีธนาคาร + Google Drive connect
- [x] Pricing: 5-tier + เติมเครดิต 4 แพ็กเกจ + yearly toggle (แสดงประหยัดกี่บาท) + FAQ
- [x] Admin Panel: 6 tiers, stats card ครบ, ค้นหา, filter, inline edit
- [x] Google OAuth: สร้าง Drive + Sheet 11 col + referral bonus
- [x] Referral System: SMILE-XXXX, auto-generate, bonus 50 credits ทั้งสองฝั่ง
- [x] Terms (9 ข้อ) + Privacy (9 ข้อ) — เพิ่มข้อ Analytics/PDPA consent — 2026-06-11
- [x] Register consent checkbox รวมข้อความ anonymized analytics — 2026-06-11
- [x] หน้าแก้ไขธุรกรรม `/transaction/edit?userId&ref&year` + API `update-transaction` (GET/PATCH, หาแถวจาก column K, แก้เฉพาะ A-G) — 2026-06-11
- [x] Ledger เพิ่มปุ่ม ✏️ ต่อแถว → หน้าแก้ไข | ปุ่ม Flex Message bot เปลี่ยนเป็น "✏️ แก้ไขข้อมูล" ลิงก์ตรงไปสลิปใบนั้น — 2026-06-11
- [x] 404 custom page + SEO meta tags + payment/success
- [x] **Analytics daily view** — toggle รายวัน/รายเดือน, month picker, summary cards แยกตาม view — 2026-06-12
- [x] **Ledger pagination** — 20 แถว/หน้า + date filter (กรองวันที่ 1-31) — 2026-06-12
- [x] **Settings แก้ไขโปรไฟล์ครบวงจร** — เพิ่ม tax_id, user_type (dropdown), address (textarea) — 2026-06-12
- [x] **Invoice flow** — หน้า `/invoice/request` เปลี่ยนเป็นขอ "ใบแจ้งหนี้" (ไม่มีตราประทับ/ลายเซ็น) ใบกำกับภาษีออกหลัง admin อนุมัติ — 2026-06-12
- [x] **Admin Google Connect** — `/api/admin/google/connect` + `/api/admin/google/callback` + สร้าง Invoice Register Sheet + บันทึก token ใน `admin_settings` — 2026-06-12
- [x] **Admin send-email** — `/api/admin/send-email` ส่ง HTML + **PDF แนบ** (pdfkit + Sarabun font) ทาง Gmail — 2026-06-12
- [x] **Admin invoices issue** — เมื่อกด "ออกใบกำกับภาษี" → บันทึก Google Sheet + ส่งอีเมลอัตโนมัติ — 2026-06-12
- [x] **Admin settings tab** — แสดงสถานะ Google connect + ปุ่มเชื่อมต่อ + สถานะ email — 2026-06-12
- [x] **แก้บั๊ก invoice PDF (`lib/invoice-pdf.js`) ตัวอักษร title/subtitle ทับกัน** — ใช้ทั้งดาวน์โหลดและแนบอีเมล — 2026-06-27
- [x] **Subscription expiry + Stripe mismatch detection ใน Admin** — ดูหัวข้อ "Subscription Expiry + Stripe Mismatch Detection" ด้านบน — 2026-06-27
- [x] **Ledger: คอลัมน์หมายเหตุ** — โชว์ note inline ในตาราง (เดิมไม่โชว์ ต้องเปิดดูใน Sheets เอง) — 2026-06-28
- [x] **Ledger: ตัวกรองรายรับ/รายจ่าย + ย่อย รับโอน/รับสด/จ่ายโอน/จ่ายสด** — 2026-06-28
- [x] **Ledger + Analytics: ตัวกรองรายสาขา** — เลือกดูสาขาเดียวหรือรวมทุกสาขา (เดิมมีแค่ตารางเปรียบเทียบสาขารวม ไม่มีตัวกรองดูแนวโน้มรายสาขาเดี่ยว) — `branch` query param ใน `/api/shop/analytics` — 2026-06-28
- [x] **แก้บั๊กปีเก่าดูไม่ได้** — Ledger/Analytics/Tax Report year selector เปลี่ยนจาก hardcode `[2024,2025,2026,2027]` เป็นช่วงไดนามิก (ปีปัจจุบัน+1 ถึง -8 ปี) 3 จุด — 2026-06-28
- [x] **"บันทึกเอง" บนเว็บ (`/api/sheets/add-transaction`) รองรับวิธีรับ-จ่าย** — เพิ่ม field โอน/เงินสด ในฟอร์ม + เขียนคอลัมน์ Q, R และ header เต็ม 18 คอลัมน์ตอนสร้าง tab ปีใหม่ (เดิมเขียนแค่ A-K เท่านั้น ไม่ตรงกับ schema ของบอท) — 2026-06-28
- [x] **หน้า "ช่วยเหลือ" ใน sidebar** — รวมคำสั่ง LINE ทั้งหมดสำหรับเจ้าของร้าน + FAQ accordion (ศึกษาเองได้ ไม่ต้องทักแอดมิน) — 2026-06-28

### Billing
- [x] Stripe Subscriptions (mode: subscription) + proration (stripe_customer_id)
- [x] Webhook: checkout.completed → tier update + customer/subscription ID บันทึก
- [x] Webhook: invoice.payment_succeeded → monthly credit refresh
- [x] Webhook: customer.subscription.deleted → downgrade to normal
- [x] Webhook: rate limiting (20 req/min per IP)
- [x] Cancel URL ใช้ owner_line_id (ไม่ใช่ UUID) — แก้ไข 2026-06-08
- [x] Business tier ฿999: Price IDs จริงใส่แล้ว
- [x] Mega Pack 3,000 แผ่น ฿999: `price_1Tg56f3ZvivzvZ6qX4163cg5`

### Infrastructure
- [x] CI/CD: push main → Cloud Build → deploy bot อัตโนมัติ
- [x] LIFF ID: `2009797558-LMletOqM`
- [x] LINE Bot OA: `@574unjqj` · Add link: `https://lin.ee/wdnoEN5`
- [x] deploy-web.sh + deploy-bot.sh อ่าน secret จาก .env (ไม่มี hardcode)
- [x] Supabase key format ใหม่: sb_publishable_... (anon), sb_secret_... (service role)
- [x] API routes ทุกไฟล์ใช้ SUPABASE_SERVICE_ROLE_KEY (bypass RLS) — แก้ไข 2026-06-08
- [x] api/auth/line.js: insert shop_credits เมื่อ auto-create shop — แก้ไข 2026-06-08

---

## สิ่งที่ยังเหลือ ⬜

### ต้องทำในโค้ด
- [x] **Sheets column K/P/Q/R header patch** — ไม่ต้องทำมือแล้ว `getOrCreateYearSheet()` auto-patch header ที่ขาดให้ทุกครั้งที่บันทึกรายการใหม่ — แก้ไข 2026-06-28
- [ ] **สร้าง shop_category_rules table** ใน Supabase (SQL: `CREATE TABLE shop_category_rules (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, shop_id uuid REFERENCES shop_profiles(id) ON DELETE CASCADE, keyword text NOT NULL, category text NOT NULL, created_at timestamptz DEFAULT now(), UNIQUE(shop_id, keyword));`)
- [x] **บังคับ branch limit ตาม tier จริง** — แก้แล้ว `/api/shop/branches` POST เช็คจำนวนสาขาปัจจุบันเทียบ `MAX_BRANCHES` ตาม tier ก่อน insert แล้ว — 2026-07-15 (commit `e01c927`)
- [x] **Stripe webhook idempotency** — แก้แล้ว insert `event.id` ลง `stripe_processed_events` ก่อนประมวลผล ข้ามถ้าซ้ำ — 2026-07-15 (commit `e01c927`, **ต้องรัน SQL สร้างตารางก่อนถึงจะกันซ้ำได้จริง** ดูหัวข้อ Supabase SQL ด้านบน)
- [x] **ลบโค้ดที่ไม่ใช้แล้ว: `StampSVG`** — ลบแล้ว — 2026-07-15 (commit `e01c927`)
- [x] **Upstash Redis live** — UPSTASH_REDIS_REST_URL + TOKEN ใส่ใน .env แล้ว, bot log `[BOOT] ✅ Upstash Redis connected` — Duplicate Guard ทำงานข้าม instance แล้ว — 2026-06-13
- [x] **รายงาน VAT/ภาษี** — สรุปตามผู้ขาย/เลขภาษี + Export CSV (Business+) — 2026-06-12
- [x] **Category System** — bot detectCategory() Gemini + learned rules (shop_category_rules), Sheets column P, edit page, analytics breakdown (Business+) — 2026-06-13
- [x] **Enterprise Marketing Intelligence** — Peak Time Heatmap (slip_analytics), RFM Segments (sender_profiles), Marketing ROI (category sheets), Revenue Forecast (linear regression) — 2026-06-13
- [x] **Sales Landing Page** — อัปเกรด pages/index.js เป็น Sales Page เต็มรูปแบบ: Sticky Header, Hero + LINE Chat Animation (CSS), 3 Core Benefits, How It Works, Enterprise Showcase + Heatmap Mockup, Pricing 4 tier, Testimonials (placeholder), FAQ accordion, Final CTA, Footer — 2026-06-13
- [x] **Upstash Redis Duplicate Guard** — bot ใช้ Redis SET NX EX แทน in-memory Map, fallback อัตโนมัติถ้าไม่มี key (ต้องใส่ UPSTASH_REDIS_REST_URL + TOKEN ใน .env แล้ว redeploy) — 2026-06-13
- [x] **Bug fix: RFM segment logic** — แยก "new" (R≥4, F=1) ออกจาก "dormant" (fallback), เพิ่ม dormant card ใน Dashboard — 2026-06-13
- [x] **Bug fix: useEffect dependency** — เพิ่ม isUnlimited ใน deps array เพื่อให้ fetchMarketing trigger เมื่อ upgrade tier — 2026-06-13
- [x] **POS Module (`/pos`)** — ระบบขายหน้าร้าน 4 tabs: หน้าขาย (product grid + cart + checkout), สินค้า/สต็อค (CRUD), รายงาน (daily/monthly), รับสินค้า (stock receive); ข้อมูลเก็บใน Google Sheets 2 tabs (สินค้า + ยอดขาย); `lib/google-pos.js` + 3 API routes `/api/pos/setup|products|sales` + `/api/admin/pos-stats`; ต้องสร้าง `pos_configs` table ก่อนใช้งาน — 2026-07-03
- [x] **Delivery Module (`/delivery`)** — ระบบส่งของ 4 tabs: ออเดอร์/สร้าง/ลูกค้า/พนักงาน; ข้อมูลเก็บใน Google Sheets (PDPA); `lib/google-delivery.js` + API routes; ต้องสร้าง `delivery_configs` table — 2026-07-03
- [x] **Dashboard: POS card + Delivery card** — ปุ่ม "เปิดระบบ" บน Home tab สำหรับทั้งสองโมดูล — 2026-07-03

### ต้องทำด้วยมือ — Supabase SQL

> **หมายเหตุ (2026-06-12):** ตรวจสอบจาก CSV export แล้ว — `invoice_requests`, `slip_analytics`, `sender_profiles`, `shop_usage_daily` มีอยู่แล้วทั้งหมด มีแค่ `admin_settings` ที่ยังไม่มี

**สร้าง admin_settings table (ก่อนใช้ Admin Google Connect):**
```sql
CREATE TABLE IF NOT EXISTS admin_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**สร้าง pos_configs table (ก่อนใช้ /pos POS Module):**
```sql
CREATE TABLE IF NOT EXISTS pos_configs (
  shop_id uuid PRIMARY KEY REFERENCES shop_profiles(id) ON DELETE CASCADE,
  pos_folder_id text,
  pos_sheet_id text,
  created_at timestamptz DEFAULT now()
);
```

**สร้าง delivery_configs table (ก่อนใช้ /delivery Delivery Module):**
```sql
CREATE TABLE IF NOT EXISTS delivery_configs (
  shop_id uuid PRIMARY KEY REFERENCES shop_profiles(id) ON DELETE CASCADE,
  delivery_folder_id text,
  customer_sheet_id text,
  order_sheet_id text,
  created_at timestamptz DEFAULT now()
);
```

**สร้าง stripe_processed_events table (ก่อนใช้ idempotency guard ใน webhooks/stripe.js — เพิ่ม 2026-07-15, ✅ สร้างแล้ว 2026-07-16):**
```sql
CREATE TABLE IF NOT EXISTS stripe_processed_events (
  event_id text PRIMARY KEY,
  event_type text,
  processed_at timestamptz DEFAULT now()
);
```

### ต้องทำด้วยมือ (ไม่ใช่โค้ด)
- [x] **สร้าง admin_settings table** ใน Supabase — มีแล้ว มีข้อมูลอยู่จริง (verified 2026-06-28 ผ่าน REST query)
- [x] **เพิ่ม Google OAuth redirect URI** สำหรับ admin + **กด "เชื่อมต่อ Google"** — เสร็จแล้ว (admin_settings มี `admin_invoice_sheet_id` แปลว่า connect สำเร็จแล้ว) — verified 2026-06-28
- [x] **ตั้งค่าอีเมล Gmail** — `EMAIL_USER`, `EMAIL_PASS`, `NEXT_PUBLIC_EMAIL_CONFIGURED` ตั้งค่าใน `.env` แล้ว — verified 2026-06-27
- [x] **Custom Domain** — `smileslippro.com` ผูกกับ Cloud Run `smileslip-dashboard` แล้ว ใช้งานจริง — verified 2026-06-27
- [ ] **Testimonials จริง** — ใส่คำรีวิวจากลูกค้ากลุ่มแรกแทน placeholder ใน `pages/index.js` บรรทัด TESTIMONIALS array
- [x] **Min-instances=1** บน Cloud Run `smileslip-service` — ตั้งไว้แล้ว (minScale=1) — verified 2026-06-27 ป้องกัน cold start 3-8 วิ
- [x] **Vision API Budget Alert** — ทำแล้ว (2026-06-12)
- [x] **เพิ่ม `subscription_expires_at`, `stripe_billed_tier`, `stripe_period_end`, `google_bonus_granted` columns** ใน `shop_profiles` — ทำแล้ว 2026-06-27/28
- [ ] **ไลน์ออฟฟิเชียลอื่น (ไม่ใช่บอทนี้)** — ผู้ใช้ถามว่า Claude แก้ Rich Menu/ข้อความตอบกลับอัตโนมัติของ LINE OA อื่นได้ไหม — ทำไม่ได้เพราะต้อง login LINE Official Account Manager ด้วยบัญชีผู้ใช้เอง (ห้ามกรอก credential ให้) ผู้ใช้ต้องอัปโหลดรูป/ใส่ข้อความเองหลัง Claude ออกแบบ/เขียนให้

---

## ข้อควรระวังสำคัญ

1. **deploy-bot.sh ต้องรันจาก `smileslip-pro/`** — ถ้ารันจาก root จะพัง
2. **deploy-web.sh ต้องรันจาก `smileslip-dashboard/`** — ถ้ารันจาก root จะ upload .codeoss และ crash
3. **LINE channel แยกกัน:** `LINE_CHANNEL_ACCESS_TOKEN`+`LINE_CHANNEL_SECRET` = Messaging API, `LINE_LOGIN_SECRET` = LINE Login (คนละ channel คนละค่า)
4. **Google token** — bot อ่านจาก `shop_google_configs.google_refresh_token` เท่านั้น
5. **Supabase columns** — เครดิตใช้ `balance_credits`, password ใช้ `password_hash`
6. **Gemini endpoint** — ใช้ `v1` (ไม่ใช่ `v1beta`) สำหรับ gemini-3.5-flash
7. **ห้าม hardcode secret** — repo เป็น public, deploy scripts อ่านจาก `.env` เสมอ
8. **PDPA** — ห้าม insert ข้อมูลธุรกรรม (ยอดเงิน, ชื่อคน) ลง Supabase
9. **@line/liff** — ห้ามติดตั้งเป็น npm package (SSR พัง) ใช้ CDN เท่านั้น
10. **ห้าม query Supabase จาก client โดยตรง** — ทุก query ต้องผ่าน API route ที่ใช้ service role key
11. **ห้ามใช้ recharts** — ไม่มีใน package-lock.json จะ build fail, ใช้ CSS bars แทน
12. **cancel_url ใน Stripe checkout** ต้องใช้ `owner_line_id` (LINE userId) ไม่ใช่ DB UUID
13. **Supabase schema cache error** (account_type ฯลฯ) — reload ที่ Supabase Dashboard → Settings → API → Reload schema
14. **stripe-server.js** — เป็น Express server เก่า ไม่ได้รันใน production แล้ว (ใช้ Next.js API แทน)
15. **Supabase key format ใหม่** — `sb_publishable_...` (anon), `sb_secret_...` (service role) ไม่ใช่ JWT `eyJ...`
16. **api/auth/line.js POST** — ต้องใช้ service role key และ insert shop_credits พร้อมกัน (แก้แล้ว 2026-06-08)
17. **`usage_logs.amont`** — มี typo ใน DB schema (ขาด u) — ถ้าจะ insert ต้องใช้ชื่อนี้ตามจริง
18. **Analytics tables** — `slip_analytics`, `sender_profiles`, `shop_usage_daily` มีอยู่แล้วใน DB (verified 2026-06-12) `recordAnalytics()` ใช้งานได้ทันที
19. **PDPA Analytics** — ห้ามเก็บชื่อผู้โอน/ยอดจริง/เลขบัญชีใน slip_analytics — ใช้ sha256 hash และ amount_bucket เท่านั้น
20. **#สรุปทุกสาขา** — อ่านจาก sheet เดียว (main shop sheet) แต่แตก by branch_name (column J) ถูกต้องแล้ว เพราะทุก branch เขียน sheet เดียวกัน
21. **quoteToken ห้ามใส่ใน Flex Message** — LINE รองรับ quote เฉพาะ type `text`/`sticker` เท่านั้น ถ้าใส่ใน flex จะถูก reject ทั้ง message (`The message type 'flex' does not support quote message`) — แก้แล้ว 2026-06-11
22. **deploy บน Windows** — `bash deploy-bot.sh` และ `bash deploy-web.sh` ล้มเหลวเพราะ Python not found ใน Bash tool ต้องใช้ **PowerShell** + `gcloud run deploy` โดยตรง พร้อม parse `.env` ด้วย PowerShell script
23. **nodemailer** เพิ่มใน dashboard package.json แล้ว — ต้องรัน `npm install` ก่อน deploy ไม่งั้น `npm ci` จะ fail เพราะ lock file ไม่ sync
24. **Admin Google token** — เก็บใน `admin_settings` table (key=`admin_google_refresh_token`) ไม่ใช่ `shop_google_configs` — admin บริษัทกับ shop เป็น คนละ table
25. **CRON_SECRET** — ใน `smileslip-pro/.env` ค่า `SmileSlipCron2569!` ต้องส่งใน header `x-cron-secret` เมื่อเรียก `/cron/daily-summary`, `/cron/weekly-summary`, `/api/cron/expire-subscriptions`
26. **shop_category_rules** — ต้องสร้าง table ก่อนใช้ category system (SQL อยู่ใน "ต้องทำด้วยมือ") bot detect ได้แต่ learnKeyword จะ error ถ้าไม่มี table (suppress แล้ว)
27. **Heatmap/RFM** — ข้อมูลมาจาก `slip_analytics` และ `sender_profiles` ที่ bot เขียนอัตโนมัติ — ต้องรอให้มีสลิปก่อนถึงจะแสดง
28. **Revenue Forecast** — ต้องมีข้อมูล Google Sheets อย่างน้อย 2 เดือนในปีนั้น
29. **Cloud Scheduler** — jobs ทั้งหมดอยู่ที่ region `asia-southeast1`: `smileslip-daily-summary` (`0 11 * * *` UTC = 18:00 กรุงเทพ ทุกวัน), `smileslip-weekly-summary` (`0 11 * * 1` UTC = จันทร์ 18:00 กรุงเทพ), `smileslip-expire-subscriptions` (`0 19 * * *` UTC = 02:00 กรุงเทพ ทุกวัน)
30. **ใบแจ้งหนี้ vs ใบกำกับภาษี** — `/invoice/request` ออก "ใบแจ้งหนี้" เท่านั้น (ไม่มีตราประทับ) ใบกำกับภาษีจริงออกโดย Admin เท่านั้นหลัง issue (มีตราประทับ + ลายเซ็น)
31. **คอลัมน์ C (ประเภท รายรับ/รายจ่าย) ห้ามแก้/แทนที่ความหมาย** — ตัดสินใจไว้ชัดเจนแล้ว (2026-06-28) ว่าฟีเจอร์โอน/เงินสดต้องเพิ่ม **คอลัมน์ใหม่ (Q)** เท่านั้น ห้ามรียูส column C เพราะระบบอื่นพึ่งพา (#สรุปทุกสาขา, analytics, RFM, category breakdown ฯลฯ) อ่านคอลัมน์ C เป็น "รายรับ"/"รายจ่าย" ตรงๆ
32. **google_bonus_granted คือ flag กันโบนัสซ้ำตัวเดียวที่เชื่อถือได้** — ห้ามกลับไปเช็คจาก "มีแถวใน shop_google_configs" หรือ "มี folder_id" เป็นเงื่อนไขให้โบนัสอีก (เคยมีบั๊กเครดิตซ้ำมาแล้ว)
33. **เมนู `#วิธีใช้งาน` กับหน้า "ช่วยเหลือ" ในเว็บ** — เนื้อหาคนละไฟล์ ไม่ได้ share ข้อมูลกัน (bot: TOPICS object ใน index.js / เว็บ: array inline ใน dashboard.js ส่วน Help tab) — แก้คำสั่ง/ข้อความใหม่ต้องแก้ทั้ง 2 ที่ให้ตรงกันเอง
34. **LINE Official Account อื่น (ไม่ใช่บอทนี้)** — Claude เข้าไปแก้ Rich Menu/ข้อความตอบกลับอัตโนมัติให้โดยตรงไม่ได้ เพราะต้อง login LINE Official Account Manager (manager.line.biz) ด้วยบัญชีผู้ใช้ ช่วยได้แค่ออกแบบรูป/เขียนข้อความให้ไปอัปโหลด/วางเอง หรือถ้าเปิด Messaging API ของ OA นั้นแล้วให้ token มา จะช่วยตั้ง Rich Menu ผ่าน API ได้ (แต่ auto-reply แบบคีย์เวิร์ดใน OA Manager จะใช้ไม่ได้แล้ว ต้องเขียนบอทแยก)
35. **Traffic pinning บน Cloud Run** — หลัง deploy ทุกครั้งต้องรัน `gcloud run services update-traffic smileslip-service --region asia-southeast1 --project smileslip-accounting-pro --to-revisions=REVISION_NAME=100` ด้วย เพราะ traffic อาจค้างอยู่ที่ revision เก่า (พบปัญหาจริง: deploy ใหม่แต่ user ยังเห็น behavior เก่า) ตรวจสอบด้วย `gcloud run services describe` ดูว่า traffic 100% ตรงกับ revision ล่าสุดไหม
36. **`shop_google_configs` ไม่มี column `id`** — PK ของตารางนี้คือ `shop_id` เท่านั้น ห้าม `.select('id, ...')` จะ error `column shop_google_configs.id does not exist` — ใช้ `.select('google_refresh_token, google_folder_id, google_sheet_id')` เท่านั้น
37. **isHandwritten condition ต้องเป็นทั้งสองเงื่อนไข** — `const isHandwritten = avgConfidence < 0.75 && rawText.length < 100` ถ้าใช้แค่ `avgConfidence < 0.75` อย่างเดียว สลิปดิจิทัล QR ที่ถ่ายด้วยมือถือ (confidence ต่ำจากแสงสะท้อน) จะถูก route ไป image-mode และ Gemini อ่าน "จ่ายบิลสำเร็จ" เป็น expense แทน income
38. **คีย์รายการเอง — ทุกคนในกลุ่มใช้ได้ (ไม่ใช่เฉพาะเจ้าของ)** — แก้ไข 2026-07-03 เหตุผล: พนักงานต้องส่งสลิปและบันทึกรายรับ-จ่ายได้ ระบบบันทึกชื่อผู้คีย์ใน column R ไว้ audit ส่วนการแก้ไขยังเป็นหน้าที่เจ้าของ/แอดมินเท่านั้น (ผ่าน dashboard)
39. **Google OAuth Consent Screen — redirect URIs ต้องครบทั้ง Cloud Run + custom domain** — ต้องมี 4 URIs: (1) `...run.app/api/auth/google/callback`, (2) `...run.app/api/admin/google/callback`, (3) `smileslippro.com/api/admin/google/callback`, (4) `smileslippro.com/api/auth/google/callback` — ถ้าขาด URI 4 ผู้ใช้ที่เข้าผ่าน smileslippro.com จะ error `redirect_uri_mismatch` ตอนเชื่อม Google Drive
40. **ห้ามใช้ gemini-2.5-flash** — deprecated ในโปรเจกต์นี้ ใช้ `process.env.GEMINI_MODEL` (default: `gemini-3.5-flash`) เสมอ ทั้งใน main OCR และ fallback
