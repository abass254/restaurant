#!/usr/bin/env bash
# Generate MPESA_B2B_SECURITY_CREDENTIAL from the Safaricom production .cer
# and your B2B initiator password.
#
# Usage:
#   ./scripts/mpesa-b2b-security-credential.sh
#   ./scripts/mpesa-b2b-security-credential.sh ~/Downloads/ProductionCertificate.cer
#
# Then paste the printed value into .env as MPESA_B2B_SECURITY_CREDENTIAL
# and restart the backend.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CERT="${1:-$HOME/Downloads/ProductionCertificate.cer}"

if [[ ! -f "$CERT" ]]; then
  echo "error: certificate not found: $CERT" >&2
  echo "Download ProductionCertificate.cer from Daraja and pass its path." >&2
  exit 1
fi

if [[ ! -d "$ROOT/backend/.venv" ]]; then
  echo "error: missing backend/.venv" >&2
  exit 1
fi

# shellcheck disable=SC1091
source "$ROOT/backend/.venv/bin/activate"

echo "Certificate: $CERT"
openssl x509 -in "$CERT" -noout -subject -dates 2>/dev/null || true
echo ""
echo "Enter the B2B initiator PASSWORD for MPESA_B2B_INITIATOR"
echo "(not the STK passkey — the API operator password from the M-PESA org portal)."
echo -n "Initiator password: "
IFS= read -r -s INITIATOR_PASSWORD
echo ""
if [[ -z "${INITIATOR_PASSWORD}" ]]; then
  echo "error: password cannot be empty" >&2
  exit 1
fi

export MPESA_CERT_PATH="$CERT"
export MPESA_INITIATOR_PASSWORD="$INITIATOR_PASSWORD"

python3 <<'PY'
import base64
import os
import sys
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives.asymmetric import padding

cert_path = Path(os.environ["MPESA_CERT_PATH"])
password = os.environ["MPESA_INITIATOR_PASSWORD"].encode("utf-8")
raw = cert_path.read_bytes()

try:
    cert = x509.load_pem_x509_certificate(raw)
except ValueError:
    cert = x509.load_der_x509_certificate(raw)

encrypted = cert.public_key().encrypt(password, padding.PKCS1v15())
credential = base64.b64encode(encrypted).decode("ascii")

print("")
print("MPESA_B2B_SECURITY_CREDENTIAL=")
print(credential)
print("")
print("Copy that single line into .env (no quotes), then:")
print("  1. Confirm MPESA_B2B_INITIATOR matches the portal username exactly")
print("  2. Restart: cd backend && ./run.sh")
print("  3. Retry STK / merchant payout")
PY

unset MPESA_INITIATOR_PASSWORD INITIATOR_PASSWORD
