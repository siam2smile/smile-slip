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

python3 - "$ENV_YAML" <<'PY'
import sys, json
out = []
for line in open('.env', encoding='utf-8'):
    s = line.strip()
    if not s or s.startswith('#') or '=' not in s:
        continue
    k, v = s.split('=', 1)
    k = k.strip()
    v = v.strip()
    # ตัด quote คร่อมค่า (ถ้ามี)
    if len(v) >= 2 and v[0] == v[-1] and v[0] in ('"', "'"):
        v = v[1:-1]
    # json.dumps ให้ YAML double-quoted scalar ที่ปลอดภัย (JSON ⊂ YAML)
    out.append(f'{k}: {json.dumps(v)}')
open(sys.argv[1], 'w', encoding='utf-8').write('\n'.join(out) + '\n')
print(f'[deploy] เตรียม env จาก .env จำนวน {len(out)} ตัวแปร')
PY

echo "[deploy] 🚀 กำลัง deploy $SERVICE ที่ $REGION ..."
gcloud run deploy "$SERVICE" \
  --source . \
  --region "$REGION" \
  --env-vars-file "$ENV_YAML" \
  --allow-unauthenticated

echo "[deploy] ✅ เสร็จสิ้น"
