#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

# Pull OPENWA_* from repo-root .env without sourcing the whole file
# (values like MAIL_FROM_NAME=DUKAI PLATFORM are not valid shell).
ENV_FILE="${ROOT_DIR}/../.env"
load_env_key() {
  local key="$1"
  local line value
  [[ -f "$ENV_FILE" ]] || return 0
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

export PORT="${OPENWA_AGENT_PORT:-7010}"
export AGENT_TOKEN="${OPENWA_AGENT_TOKEN:-}"
export SESSION_ID="${OPENWA_SESSION_ID:-dukai}"
export OPENWA_LICENSE_KEY="${OPENWA_LICENSE_KEY:-}"
# Default false so the Chrome window shows the QR for first linking.
export HEADLESS="${OPENWA_HEADLESS:-false}"
export OPENWA_USER_AGENT="${OPENWA_USER_AGENT:-}"

if [[ ! -d node_modules/@open-wa/wa-automate ]]; then
  npm install
fi

exec npm start
