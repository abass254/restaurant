#!/usr/bin/env bash
# Live M-Pesa / Daraja transaction log catcher.
#
# Follows backend output and prints only payment traffic: STK push, Daraja HTTP,
# callbacks, B2B payouts, balance queries. Dashboard polling is hidden by default.
#
# Usage:
#   ./scripts/mpesa-logs.sh                 # follow live API logs (starts API if needed)
#   ./scripts/mpesa-logs.sh --stdin         # filter piped output
#   ./scripts/mpesa-logs.sh --file PATH     # follow a specific log file
#   ./scripts/mpesa-logs.sh --verbose       # include /mpesa/transactions poll noise
#   ./scripts/mpesa-logs.sh --full          # also keep an unfiltered companion log
#   ./scripts/mpesa-logs.sh --help
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="${MPESA_LOG_DIR:-$ROOT/logs}"
LIVE_LOG="$LOG_DIR/backend-live.log"
MODE="auto" # auto | stdin | file | run
FOLLOW_FILE=""
SAVE_FULL=0
VERBOSE=0

usage() {
  sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
}

port_in_use() {
  local port="${1:-7101}"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stdin|-s)
      MODE="stdin"
      shift
      ;;
    --file|-f)
      MODE="file"
      FOLLOW_FILE="${2:-}"
      if [[ -z "$FOLLOW_FILE" ]]; then
        echo "error: --file requires a path" >&2
        exit 1
      fi
      shift 2
      ;;
    --run)
      MODE="run"
      shift
      ;;
    --full)
      SAVE_FULL=1
      shift
      ;;
    --verbose|-v)
      VERBOSE=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

mkdir -p "$LOG_DIR"
touch "$LIVE_LOG"
STAMP="$(date +%Y%m%d-%H%M%S)"
FILTERED_LOG="$LOG_DIR/mpesa-$STAMP.log"
FULL_LOG="$LOG_DIR/mpesa-full-$STAMP.log"

# Match Daraja HTTP, app M-Pesa loggers, mutating API routes, and webhook payloads.
MPESA_PATTERN='mpesa|m-pesa|safaricom|stkpush|stk-push|stk_push|b2b|checkoutrequest|merchantrequest|originatorconversation|mpesareceipt|lipa na|/oauth/v1/generate'
# Hide chatty dashboard GETs unless --verbose.
POLL_PATTERN='GET /api/v1/mpesa/(transactions|business-config|config)( |\?|"|$)'

filter_stream() {
  if [[ "$VERBOSE" -eq 1 ]]; then
    grep -iE --line-buffered "$MPESA_PATTERN" || true
  else
    grep -iE --line-buffered "$MPESA_PATTERN" \
      | grep -iEv --line-buffered "$POLL_PATTERN" || true
  fi
}

tee_filtered() {
  filter_stream | tee -a "$FILTERED_LOG"
}

pipe_live() {
  if [[ "$SAVE_FULL" -eq 1 ]]; then
    tee -a "$FULL_LOG" | tee_filtered
  else
    tee_filtered
  fi
}

follow_file() {
  local path="$1"
  # -n 80 shows recent context, then streams new lines.
  tail -n 80 -F "$path" | pipe_live
}

start_backend_teed() {
  if [[ ! -d "$ROOT/backend/.venv" ]]; then
    echo "error: missing backend/.venv — create it before running." >&2
    exit 1
  fi
  (
    cd "$ROOT/backend"
    # shellcheck disable=SC1091
    source .venv/bin/activate
    set -a
    # shellcheck disable=SC1091
    [[ -f "$ROOT/.env" ]] && . "$ROOT/.env"
    set +a
    PORT="${APP_PORT:-7101}"
    exec uvicorn app.main:app --host 127.0.0.1 --port "$PORT" --reload
  ) 2>&1 | tee -a "$LIVE_LOG"
}

resolve_port() {
  if [[ -f "$ROOT/.env" ]]; then
    # shellcheck disable=SC1091
    set -a
    # shellcheck disable=SC1091
    . "$ROOT/.env"
    set +a
  fi
  echo "${APP_PORT:-7101}"
}

echo "M-Pesa live log catcher"
echo "  filtered → $FILTERED_LOG"
echo "  backend  → $LIVE_LOG"
if [[ "$SAVE_FULL" -eq 1 ]]; then
  echo "  full     → $FULL_LOG"
fi
if [[ "$VERBOSE" -eq 0 ]]; then
  echo "  note     → hiding GET /mpesa/transactions polls (use --verbose to show)"
fi
echo "  Ctrl-C to stop"
echo ""

case "$MODE" in
  stdin)
    pipe_live
    ;;
  file)
    if [[ ! -f "$FOLLOW_FILE" ]]; then
      echo "error: log file not found: $FOLLOW_FILE" >&2
      exit 1
    fi
    follow_file "$FOLLOW_FILE"
    ;;
  run)
    start_backend_teed | pipe_live
    ;;
  auto)
    PORT="$(resolve_port)"
    if port_in_use "$PORT"; then
      echo "API already listening on :$PORT — following $LIVE_LOG"
      echo "(If this stays quiet, restart the API with ./backend/run.sh so it tees here.)"
      echo ""
      follow_file "$LIVE_LOG"
    else
      echo "Starting API on :$PORT and streaming M-Pesa lines…"
      echo ""
      start_backend_teed | pipe_live
    fi
    ;;
esac
