#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

# Prefer workspace-root .env (/home/ubuntu/agents/.env), then sibling TransChap_merchants/.env
ENV_FILE=""
if [[ -f "${ROOT_DIR}/../../../.env" ]]; then
  ENV_FILE="$(cd "${ROOT_DIR}/../../.." && pwd)/.env"
elif [[ -f "${ROOT_DIR}/../.env" ]]; then
  ENV_FILE="${ROOT_DIR}/../.env"
fi
# Pull OPENWA_* without sourcing the whole file
# (values like MAIL_FROM_NAME=TRANSCHAP PLATFORM are not valid shell).
load_env_key() {
  local key="$1"
  local line value
  [[ -n "$ENV_FILE" && -f "$ENV_FILE" ]] || return 0
  line="$(grep -E "^${key}=" "$ENV_FILE" | tail -n1 || true)"
  [[ -n "$line" ]] || return 0
  value="${line#*=}"
  value="${value%$'\r'}"
  if [[ "$value" == \"*\" && "$value" == *\" ]]; then
    value="${value:1:${#value}-2}"
  elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
    value="${value:1:${#value}-2}"
  fi
  if [[ -z "${!key+x}" ]]; then
    export "$key=$value"
  fi
}

load_env_key OPENWA_AGENT_PORT
load_env_key OPENWA_AGENT_TOKEN
load_env_key OPENWA_SESSION_ID
load_env_key OPENWA_LICENSE_KEY
load_env_key OPENWA_HEADLESS
load_env_key OPENWA_USER_AGENT
load_env_key OPENWA_BIND_HOST
load_env_key OPENWA_CHROME_PATH

# Strip inline comments accidentally left on values (KEY=value  # note)
strip_inline_comment() {
  local v="$1"
  if [[ "$v" == *" #"* ]]; then
    v="${v%% #*}"
    v="${v%"${v##*[![:space:]]}"}"
  fi
  printf '%s' "$v"
}

OPENWA_AGENT_TOKEN="$(strip_inline_comment "${OPENWA_AGENT_TOKEN:-}")"
OPENWA_AGENT_PORT="$(strip_inline_comment "${OPENWA_AGENT_PORT:-}")"
OPENWA_BIND_HOST="$(strip_inline_comment "${OPENWA_BIND_HOST:-}")"
OPENWA_HEADLESS="$(strip_inline_comment "${OPENWA_HEADLESS:-}")"
OPENWA_CHROME_PATH="$(strip_inline_comment "${OPENWA_CHROME_PATH:-}")"

export PORT="${OPENWA_AGENT_PORT:-7010}"
export AGENT_TOKEN="${OPENWA_AGENT_TOKEN:-}"
export SESSION_ID="${OPENWA_SESSION_ID:-TransChap}"
export OPENWA_LICENSE_KEY="${OPENWA_LICENSE_KEY:-}"
# Default false so the Chrome window shows the QR for first linking.
export HEADLESS="${OPENWA_HEADLESS:-false}"
export OPENWA_USER_AGENT="${OPENWA_USER_AGENT:-}"
export OPENWA_BIND_HOST="${OPENWA_BIND_HOST:-127.0.0.1}"
export OPENWA_CHROME_PATH="${OPENWA_CHROME_PATH:-}"
export CHROME_PATH="${OPENWA_CHROME_PATH:-}"

if [[ ! -d node_modules/@open-wa/wa-automate ]]; then
  npm install
fi

exec npm start
