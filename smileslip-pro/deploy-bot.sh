#!/bin/bash
# ============================================================
# Smile Slip Bot — Canonical Deploy Script
# อ่าน secret จาก .env (ซึ่งอยู่ใน .gitignore) — ไม่มี secret hardcode ในไฟล์นี้
# ใช้สคริปต์นี้ตัวเดียวในการ deploy bot เสมอ เพื่อกัน code/config drift
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

SERVICE="smileslip-service"
REGION="asia-southeast1"

if [ ! -f .env ]; then
  echo "❌ ไม่พบไฟล์ .env (ต้องมี secret ทั้งหมดอยู่ในนั้น) — ยกเลิกการ deploy"
  exit 1
fi

# แปลง .env -> ไฟล์ env yaml ชั่วคราว
# (ใช้ --env-vars-file เพื่อกันปัญหาอักขระพิเศษ เช่น / + = ในค่า token)
ENV_YAML="$(mktemp)"
trap 'rm -f "$ENV_YAML"' EXIT

node - "$ENV_YAML" <<'JS'
const fs = require('fs');
const [,, envYaml] = process.argv;
const out = [];
for (const line of fs.readFileSync('.env', 'utf-8').split('\n')) {
  const s = line.trim();
  if (!s || s.startsWith('#') || !s.includes('=')) continue;
  const idx = s.indexOf('=');
  let k = s.slice(0, idx).trim();
  let v = s.slice(idx + 1).trim();
  if (v.length >= 2 && v[0] === v[v.length - 1] && (v[0] === '"' || v[0] === "'")) {
    v = v.slice(1, -1);
  }
  out.push(`${k}: ${JSON.stringify(v)}`);
}
fs.writeFileSync(envYaml, out.join('\n') + '\n', 'utf-8');
console.log(`[deploy] เตรียม env จาก .env จำนวน ${out.length} ตัวแปร`);
JS

echo "[deploy] 🚀 กำลัง deploy $SERVICE ที่ $REGION ..."
gcloud run deploy "$SERVICE" \
  --source . \
  --region "$REGION" \
  --env-vars-file "$ENV_YAML" \
  --allow-unauthenticated

echo "[deploy] ✅ เสร็จสิ้น"
