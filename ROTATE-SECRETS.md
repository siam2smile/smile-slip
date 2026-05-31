# 🚨 ด่วน: Rotate Secrets ที่หลุดบน GitHub (public repo)

repo `github.com/siam2smile/smile-slip` เป็น **public** และ secret เหล่านี้เคยถูก commit
(อยู่ใน git history แม้จะลบออกจากไฟล์ปัจจุบันแล้ว) → ถือว่า **หลุดสู่สาธารณะ** ต้องเปลี่ยนทั้งหมด

> การลบ secret ออกจากไฟล์ "ไม่พอ" เพราะยังอยู่ใน git history และอาจถูก index/clone ไปแล้ว
> ทางแก้เดียวที่ปลอดภัยจริงคือ **rotate (ออกค่าใหม่ + ยกเลิกค่าเก่า)**

---

## รายการที่ต้อง rotate

| Secret | หลุดที่ | ไป rotate ที่ |
|--------|--------|--------------|
| **Supabase secret key** (`sb_secret_...`) | git history | Supabase → Project Settings → API → Roll service_role/secret key |
| **LINE Channel Access Token** | git history | LINE Developers Console → Channel → Messaging API → Reissue token |
| **Google API key / Gemini / Vision** (`AIzaSy...`) | git history | Google Cloud Console → APIs & Services → Credentials → Regenerate key (หรือออก key ใหม่แล้วลบเก่า) |
| **Google OAuth client secret** (`GOCSPX-...`) | git history | Google Cloud Console → Credentials → OAuth 2.0 Client → Reset secret |

## หลัง rotate แล้วทำ 3 อย่างนี้

1. อัปเดตค่าใหม่ในไฟล์ `.env` (ทั้ง `smileslip-pro/.env` และ `smileslip-dashboard/.env`)
2. อัปเดต env บน Cloud Run:
   ```bash
   cd ~/smileslip-pro && bash deploy-bot.sh    # อ่านค่าใหม่จาก .env ไป deploy ให้เอง
   ```
3. (ถ้า rotate OAuth client secret) ตรวจว่าฝั่ง dashboard ที่ใช้ refresh token flow ยังทำงาน

## ป้องกันไม่ให้หลุดอีก
- ✅ secret ย้ายไป `.env` (gitignore แล้ว) — สคริปต์ deploy อ่านจากตรงนั้น ไม่ hardcode แล้ว
- ⬜ พิจารณาเปลี่ยน repo เป็น **private** (Settings → Danger Zone → Change visibility) ถ้าไม่จำเป็นต้อง public
- ⬜ (ออปชัน) ล้าง secret ออกจาก history ด้วย `git filter-repo` แล้ว force-push — แต่ rotate สำคัญกว่าและพอแล้ว
