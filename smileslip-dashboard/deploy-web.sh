#!/bin/bash
# ============================================================
# Smile Slip Dashboard — Canonical Deploy Script
# อ่าน secret จาก .env (ซึ่งอยู่ใน .gitignore) — ไม่มี secret hardcode ในไฟล์นี้
# ใช้สคริปต์นี้ตัวเดียวในการ deploy dashboard เสมอ เพื่อกัน code/config drift
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

SERVICE="smileslip-dashboard"
REGION="asia-southeast1"

if [ ! -f .env ]; then
  echo "❌ ไม่พบไฟล์ .env (ต้องมี secret ทั้งหมดอยู่ในนั้น) — ยกเลิกการ deploy"
  exit 1
fi

# แปลง .env → env yaml (สำหรับ --env-vars-file) และ build-env-vars (NEXT_PUBLIC_*)
ENV_YAML="$(mktemp)"
BUILD_ENV_FILE="$(mktemp)"
trap 'rm -f "$ENV_YAML" "$BUILD_ENV_FILE"' EXIT

node - "$ENV_YAML" "$BUILD_ENV_FILE" <<'JS'
const fs = require('fs');
const [,, envYaml, buildEnvFile] = process.argv;

const envVars = {};
const lines = fs.readFileSync('.env', 'utf-8').split('\n');
for (const line of lines) {
  const s = line.trim();
  if (!s || s.startsWith('#') || !s.includes('=')) continue;
  const idx = s.indexOf('=');
  let k = s.slice(0, idx).trim();
  let v = s.slice(idx + 1).trim();
  if (v.length >= 2 && v[0] === v[v.length - 1] && (v[0] === '"' || v[0] === "'")) {
    v = v.slice(1, -1);
  }
  envVars[k] = v;
}

// runtime env yaml (ครอบคลุมทุก key)
fs.writeFileSync(envYaml, Object.entries(envVars).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n') + '\n', 'utf-8');
console.log(`[deploy] เตรียม env จาก .env จำนวน ${Object.keys(envVars).length} ตัวแปร`);

// build-time env สำหรับ NEXT_PUBLIC_* (ต้องฝังตอน build)
const pub = Object.entries(envVars).filter(([k]) => k.startsWith('NEXT_PUBLIC_'));
fs.writeFileSync(buildEnvFile, pub.map(([k, v]) => `${k}=${v}`).join(','), 'utf-8');
console.log(`[deploy] NEXT_PUBLIC_ vars สำหรับ build: ${pub.map(([k]) => k)}`);
JS

BUILD_ENV_VARS="$(cat "$BUILD_ENV_FILE")"

echo "[deploy] 🚀 กำลัง deploy $SERVICE ที่ $REGION ..."
gcloud run deploy "$SERVICE" \
  --source . \
  --region "$REGION" \
  --env-vars-file "$ENV_YAML" \
  --set-build-env-vars "$BUILD_ENV_VARS" \
  --allow-unauthenticated

echo "[deploy] ✅ เสร็จสิ้น"
