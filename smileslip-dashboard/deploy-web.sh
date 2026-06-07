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

python3 - "$ENV_YAML" "$BUILD_ENV_FILE" <<'PY'
import sys, json

env_vars = {}
for line in open('.env', encoding='utf-8'):
    s = line.strip()
    if not s or s.startswith('#') or '=' not in s:
        continue
    k, v = s.split('=', 1)
    k = k.strip()
    v = v.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in ('"', "'"):
        v = v[1:-1]
    env_vars[k] = v

# runtime env yaml (ครอบคลุมทุก key)
open(sys.argv[1], 'w', encoding='utf-8').write(
    '\n'.join(f'{k}: {json.dumps(v)}' for k, v in env_vars.items()) + '\n'
)
print(f'[deploy] เตรียม env จาก .env จำนวน {len(env_vars)} ตัวแปร')

# build-time env สำหรับ NEXT_PUBLIC_* (ต้องฝังตอน build)
pub = {k: v for k, v in env_vars.items() if k.startswith('NEXT_PUBLIC_')}
open(sys.argv[2], 'w', encoding='utf-8').write(','.join(f'{k}={v}' for k, v in pub.items()))
print(f'[deploy] NEXT_PUBLIC_ vars สำหรับ build: {list(pub.keys())}')
PY

BUILD_ENV_VARS="$(cat "$BUILD_ENV_FILE")"

echo "[deploy] 🚀 กำลัง deploy $SERVICE ที่ $REGION ..."
gcloud run deploy "$SERVICE" \
  --source . \
  --region "$REGION" \
  --env-vars-file "$ENV_YAML" \
  --set-build-env-vars "$BUILD_ENV_VARS" \
  --allow-unauthenticated

echo "[deploy] ✅ เสร็จสิ้น"
