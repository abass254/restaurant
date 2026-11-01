#!/usr/bin/env bash
# Run all FastAPI backend migrations in deterministic order.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/backend"

if [[ ! -d ".venv" ]]; then
  echo "Missing backend/.venv. Create it first and install requirements." >&2
  exit 1
fi

source .venv/bin/activate

BASELINE_MIGRATION="migrations/2026_05_26_130000_uuid_primary_keys.py"
CATALOGUE_MIGRATION="migrations/2026_09_20_200000_rename_products_to_catalogue_and_meal_addons.py"
schema_state="$(python -c 'from sqlalchemy import inspect; from app.database import engine; i=inspect(engine); tables=set(i.get_table_names()); views=set(i.get_view_names()); print("empty" if not tables else "catalogue" if "catalogue" in tables and "products" not in tables and "products" not in views else "modern" if "catalogue" in tables and "products" in views else "legacy")')"

if [[ "$schema_state" == "empty" ]]; then
  echo "Empty database detected; creating the current SQLAlchemy schema."
  python "$BASELINE_MIGRATION"
  SKIP_THROUGH="$BASELINE_MIGRATION"
elif [[ "$schema_state" == "catalogue" ]]; then
  echo "Current catalogue schema detected; skipping legacy product migrations."
  SKIP_THROUGH="$BASELINE_MIGRATION"
elif [[ "$schema_state" == "modern" ]]; then
  echo "Current catalogue schema detected; skipping legacy migrations."
  SKIP_THROUGH="$CATALOGUE_MIGRATION"
else
  SKIP_THROUGH=""
fi

for f in migrations/*.py; do
  if [[ -n "$SKIP_THROUGH" && ( "$f" < "$SKIP_THROUGH" || "$f" == "$SKIP_THROUGH" ) ]]; then
    echo "==> Skipping $f (already covered by the current schema)"
    continue
  fi
  echo "==> Running $f"
  python "$f"
done

echo "FastAPI migrations complete."
