# Restaurant pilot runbook

This runbook prepares a dedicated restaurant tenant for UAT, rehearses the
full stock flow, and promotes only the verified release. Do not use a live
merchant account for the rehearsal.

## UAT deployment

1. Create a separate UAT host, MySQL database, uploads volume, and merchant
   account. Copy `.env.example` to a host-only `.env` and set strong database
   passwords and `SESSION_SECRET`.
2. Set `APP_ENV=production`, `APP_DEBUG=false`, UAT `APP_URL` / `FRONTEND_URL`,
   and a UAT-only `CORS_ALLOWED_ORIGINS`. Keep `INSTAGRAM_FAKE_MESSAGING=true`,
   `OPENWA_ENABLED=false`, `MPESA_MODE=sandbox`, and `MPESA_B2B_AUTO_PAYOUT=false`
   for this pilot.
3. Start the stack with `docker compose up -d --build`, wait for all health
   checks, then run `docker compose exec backend sh -c 'for f in migrations/*.py; do python "$f"; done'`.
   Re-run the command once: all migrations must be idempotent.
4. Before every rehearsal and promotion, take a database backup and record the
   deployed image revision. Never use `docker compose down -v` against UAT or
   production data.

## Tenant and payment setup

Create one UAT restaurant account and four users: owner, cashier, storekeeper,
and chef. Give each only the sections they need; verify that the cashier cannot
alter settings and the chef cannot receive purchases.

Configure the account as **Restaurant / F&B**. In Settings, select manual
M-PESA confirmation (`force_mpesa_prompt=false`) and use only cash or a
cashier-entered M-PESA receipt code. Do not enable live STK, B2B payouts,
Instagram/WhatsApp ordering, riders, or AI automation for this pilot.

Load a small, independently checked dataset:

- two suppliers and raw materials with base and purchase units;
- opening store and kitchen counts;
- two menu items with recipe batch amounts/yields and selling prices;
- one modifier and one extra, each with an inventory source;
- two test customers and a known opening cash balance.

## UAT acceptance rehearsal

Perform the following with named staff and record every expected quantity and
KES amount before starting:

1. Create and receive a purchase order. Confirm the store ledger and stock
   increase by the received base-unit quantity and cost.
2. Issue ingredients from store to kitchen. Confirm equal opposing movements,
   unchanged total stock, and correct store/kitchen balances.
3. Prepare a recipe batch. Confirm kitchen ingredients decrease by the recipe
   batch amount and prepared portions increase by the yield.
4. Sell prepared menu portions in POS: one cash sale and one manual-M-PESA
   receipt-code sale, including a configured modifier/extra. Confirm prepared
   balances, source stock, sale status, payment method, and receipt values.
5. Cancel or return one controlled sale, then confirm all applicable inventory
   and prepared-portion reversals appear exactly once.
6. Run kitchen close-out counts and confirm variance, kitchen-day, usage, and
   profit reports reconcile to the pre-recorded expected totals.
7. Sign in as each role, reload Kitchen and Sales, and verify denied access as
   well as successful role-specific actions.

The customer must sign off the menu, recipes/yields, prices, supplier list,
opening counts, staff roster, payment procedure, and reconciled UAT report.

## Production promotion and rollback

Promote the same image and environment shape that passed UAT. Back up the
production database first, deploy, run migrations once, and verify `/up`, sign
in, read-only reports, and a staff permission smoke test. Keep live customer
transactions disabled until the owner completes opening-count verification.

Rollback means redeploying the previous application image. Restore a database
backup only when the release owner explicitly approves it; do not roll back
migrations by deleting data or volumes.
