#!/bin/bash
# ============================================================
# DEPRECATED wrapper — เก็บไว้เพื่อความเข้ากันได้เท่านั้น
# สคริปต์ deploy bot ตัวจริงคือ smileslip-pro/deploy-bot.sh (อ่าน secret จาก .env)
# ห้าม hardcode secret ในไฟล์นี้อีก (repo เป็น public)
# ============================================================
set -euo pipefail
exec "$(dirname "$0")/smileslip-pro/deploy-bot.sh" "$@"
