#!/usr/bin/env bash
# Create a portable archive on THIS SERVER for download to your desktop (no git).
#
# Run on the server:
#
#   ./scripts/export-for-transfer.sh
#   ./scripts/export-for-transfer.sh --include-env
#   ./scripts/export-for-transfer.sh --output ~/TransChap-transfer.tar.gz
#
# Then on your desktop:
#   scp ubuntu@YOUR_SERVER:~/TransChap-transfer.tar.gz .
#   tar -xzf TransChap-transfer.tar.gz -C ~/projects/new_ig
#   cd ~/projects/new_ig && bash scripts/local-setup.sh
#
# Or use the import helper:
#   ./scripts/import-from-transfer.sh TransChap-transfer.tar.gz ~/projects/new_ig

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

INCLUDE_ENV=0
OUTPUT=""

usage() {
  cat <<'EOF'
Usage: scripts/export-for-transfer.sh [options]

Creates a .tar.gz of the project (no git, no node_modules, no .venv).

Options:
  --include-env     Bundle .env (contains secrets)
  --no-data         Skip SQLite database and backend/uploads
  --output PATH     Output file (default: ~/TransChap-transfer-YYYYMMDD-HHMMSS.tar.gz)
  -h, --help        Show this help

Download to desktop:
  scp ubuntu@SERVER:~/TransChap-transfer-*.tar.gz .
EOF
}

INCLUDE_DATA=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --include-env) INCLUDE_ENV=1 ;;
    --no-data) INCLUDE_DATA=0 ;;
    --output) OUTPUT="${2:?--output requires a path}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
  shift
done

if [[ -z "${OUTPUT}" ]]; then
  OUTPUT="${HOME}/TransChap-transfer-$(date +%Y%m%d-%H%M%S).tar.gz"
fi

EXCLUDES_FILE="${ROOT}/scripts/rsync-excludes.txt"
if [[ ! -f "${EXCLUDES_FILE}" ]]; then
  echo "Missing ${EXCLUDES_FILE}" >&2
  exit 1
fi

STAGING="$(mktemp -d)"
trap 'rm -rf "${STAGING}"' EXIT

echo "Staging project in ${STAGING}..."

RSYNC_OPTS=(-a --exclude-from="${EXCLUDES_FILE}")
if [[ "${INCLUDE_ENV}" != "1" ]]; then
  RSYNC_OPTS+=(--exclude '.env' --exclude '.env.*')
fi
if [[ "${INCLUDE_DATA}" != "1" ]]; then
  RSYNC_OPTS+=(--exclude 'database/database.sqlite*' --exclude 'backend/uploads/')
fi

rsync "${RSYNC_OPTS[@]}" ./ "${STAGING}/new_ig/"

# Small manifest so the desktop knows what was bundled.
cat > "${STAGING}/new_ig/TRANSFER_MANIFEST.txt" <<EOF
created_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
source_host=$(hostname)
include_env=${INCLUDE_ENV}
include_data=${INCLUDE_DATA}
next_steps=cd new_ig && bash scripts/local-setup.sh
EOF

echo "Creating archive: ${OUTPUT}"
tar -czf "${OUTPUT}" -C "${STAGING}" new_ig

SIZE="$(du -h "${OUTPUT}" | cut -f1)"
echo ""
echo "Done: ${OUTPUT} (${SIZE})"
echo ""
echo "Download to your desktop:"
echo "  scp $(whoami)@$(hostname -I 2>/dev/null | awk '{print $1}' || hostname):${OUTPUT} ."
echo ""
echo "Extract and set up:"
echo "  mkdir -p ~/projects/new_ig"
echo "  tar -xzf $(basename "${OUTPUT}") -C ~/projects --strip-components=0"
echo "  cd ~/projects/new_ig && bash scripts/local-setup.sh"
if [[ "${INCLUDE_ENV}" != "1" ]]; then
  echo ""
  echo "This archive does NOT include .env. Copy it separately:"
  echo "  scp $(whoami)@$(hostname):${ROOT}/.env ~/projects/new_ig/.env"
fi
