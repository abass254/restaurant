# Backend migrations

Hand-rolled schema migrations for the FastAPI app. Each file is an idempotent
Python script that:

1. Inspects the current schema and skips work that's already been applied.
2. Applies its changes inside a transaction where possible.
3. Logs a clear summary.

## Conventions

- Filenames: `YYYY_MM_DD_HHMMSS_short_description.py`
- Run with the project virtualenv: `python backend/migrations/<file>.py`
- Migrations should always be safe to re-run.

Deploy note: the `2026_08_29_*` deliveries / QA / login-code scripts must run
before shipping the current `Delivery` / `QaIssue` models. `scripts/backend-migrate.sh`
runs every file in filename order. Run `2026_10_21_160000_kitchen_shift_sessions.py`
before deploying kitchen clock-in and stock-confirmed clock-out. Run
`2026_10_22_043000_recipe_serving_units.py` before deploying menu serving-unit
recipe configuration. Run `2026_10_22_100000_kitchen_equivalence_units.py`
before deploying Kitchen equivalence-measure configuration.

## Why not Alembic?

We may switch to Alembic once we have ≥5 migrations. For now, plain scripts
keep the diff easy to review and avoid pulling in another tool.
