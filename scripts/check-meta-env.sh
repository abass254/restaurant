#!/usr/bin/env bash
# Print which Meta app + URLs the shared `.env` is configured to use.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FILE="$ROOT/.env"

echo ""
echo "=== Environment ($FILE) ==="
if [[ ! -f "$FILE" ]]; then
  echo "  (missing — cp .env.example .env)"
  exit 1
fi
grep -E '^(APP_ENV|APP_URL|FRONTEND_URL|META_APP_ID|INSTAGRAM_APP_ID|INSTAGRAM_REDIRECT_URI|META_WEBHOOK_VERIFY_TOKEN)=' "$FILE" 2>/dev/null \
  | sed 's/SECRET=.*/SECRET=***/; s/TOKEN=.*/TOKEN=***/; s/^/  /' || true

echo ""
echo "Meta console checklist:"
echo "  UAT  webhook → https://uat.dukai.app/webhooks/instagram"
echo "  Prod webhook → https://dukai.app/webhooks/instagram"
