# CI/CD Setup — Smile Slip Bot

เป้าหมาย: push โค้ดขึ้น GitHub branch `main` → Cloud Build deploy `smileslip-service` ให้อัตโนมัติ
ไม่ต้อง deploy ด้วยมืออีก และกันปัญหา code drift ถาวร

ไฟล์ `cloudbuild.yaml` (ที่ root ของ repo) เตรียมไว้ให้แล้ว เหลือแค่ "ต่อสาย" trigger ครั้งเดียว

---

## ขั้นตอน (ทำครั้งเดียว)

### 1. เชื่อม GitHub repo กับ Cloud Build (ต้องทำในคอนโซล — เป็น OAuth)
1. เปิด https://console.cloud.google.com/cloud-build/triggers?project=smileslip-accounting-pro
2. กด **Connect Repository** → เลือก **GitHub (Cloud Build GitHub App)**
3. อนุญาตเข้าถึง repo `siam2smile/smile-slip` แล้วกด Connect

### 2. สร้าง Trigger
หลังเชื่อม repo แล้ว รันคำสั่งนี้ได้เลยจาก Cloud Shell:

```bash
gcloud builds triggers create github \
  --name="deploy-bot-on-main" \
  --repo-name="smile-slip" \
  --repo-owner="siam2smile" \
  --branch-pattern="^main$" \
  --build-config="cloudbuild.yaml" \
  --region=asia-southeast1
```

### 3. ให้สิทธิ์ Cloud Build deploy ไป Cloud Run
Service account ของ Cloud Build ต้องมีสิทธิ์ Cloud Run Admin + Service Account User:

```bash
PROJECT_NUMBER=$(gcloud projects describe smileslip-accounting-pro --format='value(projectNumber)')
CB_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

gcloud projects add-iam-policy-binding smileslip-accounting-pro \
  --member="serviceAccount:${CB_SA}" --role="roles/run.admin"
gcloud projects add-iam-policy-binding smileslip-accounting-pro \
  --member="serviceAccount:${CB_SA}" --role="roles/iam.serviceAccountUser"
```

### 4. ทดสอบ
```bash
git add -A && git commit -m "test: trigger ci" && git push origin main
```
แล้วดูสถานะ build ที่ https://console.cloud.google.com/cloud-build/builds?project=smileslip-accounting-pro

---

## หลักการที่ต้องจำ
- **env / secret อยู่ที่ Cloud Run service เท่านั้น** ไม่อยู่ใน repo — CI/CD deploy แค่โค้ด env เดิมคงอยู่
- อยากแก้ env: ทำผ่านคอนโซล Cloud Run หรือรัน `smileslip-pro/deploy-bot.sh` จากเครื่อง (อ่านจาก `.env`)
- repo เป็น **public** → ห้าม commit `.env` หรือ hardcode secret ในไฟล์ใดๆ เด็ดขาด
