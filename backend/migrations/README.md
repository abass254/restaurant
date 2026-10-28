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
before deploying Kitchen equivalence-measure configuration. Run
`2026_10_22_090000_account_receipt_descriptions.py` before deploying the
account receipt-description model. Run
`2026_10_22_110000_recipe_line_serving_units.py` before deploying per-supply
recipe equivalences.
Run `2026_10_22_120000_recipe_batch_amounts.py` before deploying recipe batch
amounts and yields in the menu editor.
Batch amounts preserve the supply quantity and menu yield as entered; sales
deduct the derived per-serving amount without changing the displayed recipe.
Run `2026_10_22_130000_prepared_menu_stock.py` before deploying recipe batch
preparation and prepared-portion tracking. A saved recipe does not deduct stock:
the explicit prepare-batch action consumes its defined supplies and adds its
yield to prepared portions; menu sales consume those portions.
Run `2026_10_22_140000_modifier_extras.py` before deploying the separate
modifier and meal-extra setup. Existing option groups remain modifiers; extras
are marked separately when they are explicitly created for a meal.
Run `2026_10_22_150000_extra_portion_unit.py` before deploying extra portion
names such as 1 stick.
Run `2026_10_22_160000_extra_recipes_per_meal.py` before deploying per-meal
extra recipes; it copies existing single-supply extra recipes to each meal the
extra is attached to.
Run `2026_10_22_170000_modifier_sources.py` before deploying modifier options
that use a store item, a menu item or a Kitchen extra for stock.
Run `2026_10_22_180000_prepared_menu_equivalences.py` before deploying
equivalence-specific prepared portions and serving-unit-aware stock movements.
Run `2026_10_28_090000_recipe_line_ingredient_units.py` before deploying
recipe lines that retain the selected inventory unit for display.

## Why not Alembic?

We may switch to Alembic once we have ≥5 migrations. For now, plain scripts
keep the diff easy to review and avoid pulling in another tool.
