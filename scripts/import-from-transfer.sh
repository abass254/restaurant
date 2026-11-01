#!/usr/bin/env bash
# Extract a server export archive on your desktop and run first-time setup.
#
# Run ON YOUR DESKTOP:
#
#   ./scripts/import-from-transfer.sh TransChap-transfer.tar.gz ~/projects/new_ig
#
# If you do not have this script yet, extract manually instead:
#   mkdir -p ~/projects && tar -xzf TransChap-transfer.tar.gz -C ~/projects
#   cd ~/projects/new_ig && bash scripts/local-setup.sh

set -euo pipefail

ARCHIVE="${1:-}"
DEST="${2:-}"

if [[ -z "${ARCHIVE}" || -z "${DEST}" ]]; then
  echo "Usage: $0 /path/to/TransChap-transfer.tar.gz /local/project/path" >&2
  echo "Example: $0 ~/Downloads/TransChap-transfer.tar.gz ~/projects/new_ig" >&2
  exit 1
fi

if [[ ! -f "${ARCHIVE}" ]]; then
  echo "Archive not found: ${ARCHIVE}" >&2
  exit 1
fi

PARENT="$(cd "$(dirname "${DEST}")" && pwd)"
BASENAME="$(basename "${DEST}")"
mkdir -p "${PARENT}"

TOP="$(tar -tzf "${ARCHIVE}" | head -1 | cut -d/ -f1)"
tar -xzf "${ARCHIVE}" -C "${PARENT}"

EXTRACTED="${PARENT}/${TOP}"
if [[ "${EXTRACTED}" != "${PARENT}/${BASENAME}" ]]; then
  if [[ -e "${PARENT}/${BASENAME}" ]]; then
    echo "Destination already exists: ${PARENT}/${BASENAME}" >&2
    exit 1
  fi
  mv "${EXTRACTED}" "${PARENT}/${BASENAME}"
fi

DEST="${PARENT}/${BASENAME}"
echo "Extracted to ${DEST}"

if [[ -f "${DEST}/TRANSFER_MANIFEST.txt" ]]; then
  echo ""
  cat "${DEST}/TRANSFER_MANIFEST.txt"
fi

echo ""
echo "Running local setup..."
bash "${DEST}/scripts/local-setup.sh"
