# Playwright QA

Playwright drives a real Chromium browser against the local merchant app. Keep end-to-end runs on a development or dedicated QA database; they can create purchases, inventory, kitchen issues and sales.

## First setup

From the repository root, start the backend in one terminal:

```bash
cd backend
./run.sh
```

In another terminal, install and run the frontend:

```bash
cd frontend
npm install
npx playwright install chromium
npm run dev
```

The app uses `http://127.0.0.1:7100` by default. Playwright can start the frontend itself if it is not already running. Leave the backend running either way.

## Run the starter check

```bash
cd frontend
npm run test:e2e
```

This opens `/sign-in` and checks that the page and login field render. To step through tests with Playwright’s visual runner:

```bash
npm run test:e2e:ui
```

To see the browser while tests run:

```bash
npm run test:e2e:headed
```

After a run, open its HTML report with:

```bash
npm run test:e2e:report
```

## Sign in for authenticated checks

Automatic sign-in reads `PLAYWRIGHT_EMAIL` and `PLAYWRIGHT_PASSWORD` from the shell environment. Set them in your local terminal or CI secret settings; do not put credentials in this file, source code, or a committed `.env` file. With both values set, Playwright signs in before the suite and saves the session in the git-ignored `.auth/merchant.json` file. The saved session is sensitive and should not be shared or committed.

```bash
export PLAYWRIGHT_EMAIL='your-qa-account@example.com'
read -s PLAYWRIGHT_PASSWORD
export PLAYWRIGHT_PASSWORD
npm run test:e2e
unset PLAYWRIGHT_EMAIL PLAYWRIGHT_PASSWORD
```

The `read -s` command prompts for the password without displaying it. Once signed in, Playwright checks the main merchant pages (Home, Menu, Inventory, Kitchen, Orders/Sales, POS, Customers, Suppliers, Supplies/Purchases, M-PESA, Reports, and Settings) and the Kitchen tabs. These checks only navigate and inspect pages; they do not create or change business records. The public sign-in smoke test always starts without a saved session. If you prefer, you can still provide an existing session file with `PLAYWRIGHT_AUTH_STATE=.auth/merchant.json`.

`PLAYWRIGHT_BASE_URL` can point the tests at an already running QA deployment. For example:

```bash
PLAYWRIGHT_BASE_URL=http://127.0.0.1:7100 PLAYWRIGHT_EMAIL='your-qa-account@example.com' npm run test:e2e
```

Supply `PLAYWRIGHT_PASSWORD` in the environment as shown above. Use a dedicated QA shop and QA database for authenticated runs. The purchasing-to-sale scenario creates real records, so do not run that write flow against a live merchant account.

## QA the purchasing-to-sale flow

Before testing, use a dedicated QA shop with a supplier, a raw-material item, a menu item with a saved recipe, and enough stock for the scenario. Then walk through:

1. Create a purchase order for the raw material and receive it. Check that store stock increases by the received amount and the receipt appears on the purchase order.
2. Add a new supply in Inventory if the scenario needs one. Confirm its base unit, role, and any configured conversion units.
3. In Kitchen, request or issue a quantity using one of the configured units. Confirm the UI quantity converts correctly and the store decreases while kitchen stock increases by the equivalent base quantity.
4. Save a recipe batch and prepare it. Confirm the kitchen ingredient quantity decreases by the batch amount and prepared portions increase by the recipe yield.
5. Create a walk-in order for the prepared menu item and complete the sale. Confirm the order is in Sales, prepared portions decrease by the sold quantity, and raw-material stock is not deducted again at sale time.
6. Refresh Kitchen and Sales. Confirm the order status and stock balances remain consistent after reload.

## Record the full UI flow

With the backend and frontend running and automatic sign-in configured, record a dedicated flow into a new test file:

```bash
npx playwright codegen \
  --load-storage=.auth/merchant.json \
  --target=playwright-test \
  --output=e2e/supplies-to-sale.spec.ts \
  http://127.0.0.1:7100/trans-chap
```

Codegen opens its own Chromium window. In that window, record the steps below. The recorder produces clicks and fills; add stock and Sales assertions after recording so the test checks outcomes, not just navigation.

1. Open **Inventory** and create a uniquely named QA ingredient with role **Raw material**, base unit **kg**, and zero starting stock.
2. Open **Supplies** and create a purchase order for that ingredient. Receive it and confirm Inventory quantity increases by the received kg.
3. Open **Kitchen** and issue part of that stock. Confirm Store decreases and Kitchen increases by the same base-unit amount.
4. In Kitchen, create a meal, save a recipe such as `1 kg → 10 plates`, then set its selling price in **Menu**.
5. Prepare one batch. Confirm the kitchen loses 1 kg and the prepared balance increases by 10 plates.
6. Return to **Home**, choose **Take Order**, sell 2 plates for cash, and complete the sale.
7. Open **Sales** and confirm the new walk-in sale appears. Confirm prepared portions are now 8 and kitchen kg remains unchanged by the sale.

Close the codegen browser when finished, review the generated file, and add assertions with `expect`. Then replay just this flow:

```bash
PLAYWRIGHT_AUTH_STATE=.auth/merchant.json npm run test:e2e -- e2e/supplies-to-sale.spec.ts
```

Use a new QA ingredient name each run, or add cleanup for the item and order. Sales defaults to walk-in orders for today; online/channel orders appear in Kitchen but are not included in the Sales list query. Prefer role and label locators such as `getByRole("button", { name: "Receive" })` and `getByLabel("Quantity")` over CSS selectors. Use screenshots at checkpoints when visual layout is part of QA.

## Run the guarded restaurant-pilot flow

`e2e/restaurant-pilot.auth.spec.ts` is a write test for a dedicated UAT tenant.
It creates a purchase receipt, kitchen issue, batch preparation, cash sale, and
kitchen close count, then verifies the kitchen-day report and merchant screens.
It never runs unless all of the following are provided:

```bash
export PLAYWRIGHT_AUTH_STATE=.auth/merchant.json
export PLAYWRIGHT_RESTAURANT_PILOT_ENABLED=true
export PLAYWRIGHT_RESTAURANT_PILOT_CONFIG='{
  "ingredientInventoryItemId":"<qa-ingredient-id>",
  "menuInventoryItemId":"<qa-menu-item-id>",
  "supplierId":"<qa-supplier-id>",
  "purchaseQuantity":10,
  "issueQuantity":5,
  "unitCost":100,
  "batchCount":1,
  "servingUnit":"plates"
}'
npm run test:e2e -- e2e/restaurant-pilot.auth.spec.ts
unset PLAYWRIGHT_RESTAURANT_PILOT_ENABLED PLAYWRIGHT_RESTAURANT_PILOT_CONFIG
```

The menu fixture must already have a saved recipe using the configured
ingredient, a selling price, and kitchen issuing enabled. Do not run this test
against production or a customer account.

## Troubleshooting

- If Playwright says a browser is missing, run `npx playwright install chromium`.
- If sign-in works but a page shows a server error, check that the backend is running, migrations are applied, and the QA database is selected.
- If a selector times out, inspect the page in `npm run test:e2e:ui` and prefer an accessible role, label, or placeholder.
- Failed test traces and screenshots are saved under `test-results/`; the HTML report is under `playwright-report/`.
