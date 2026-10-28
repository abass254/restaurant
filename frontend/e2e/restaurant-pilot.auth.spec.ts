import { expect, test, type Page } from "@playwright/test";

type PilotConfig = {
  ingredientInventoryItemId: string;
  menuInventoryItemId: string;
  supplierId?: string;
  purchaseQuantity: number;
  issueQuantity: number;
  unitCost: number;
  batchCount?: number;
  servingUnit?: string;
};

const enabled = process.env.PLAYWRIGHT_RESTAURANT_PILOT_ENABLED === "true";
const rawConfig = process.env.PLAYWRIGHT_RESTAURANT_PILOT_CONFIG;
let config: PilotConfig | null = null;

if (enabled && rawConfig) {
  try {
    config = JSON.parse(rawConfig) as PilotConfig;
  } catch {
    throw new Error("PLAYWRIGHT_RESTAURANT_PILOT_CONFIG must be valid JSON.");
  }
}

test.skip(
  !enabled || !config || !process.env.PLAYWRIGHT_AUTH_STATE,
  "This write test requires PLAYWRIGHT_RESTAURANT_PILOT_ENABLED=true, an authenticated QA storage state, and pilot fixture IDs.",
);

async function api(page: Page, path: string, body?: unknown) {
  return page.evaluate(async ({ requestPath, requestBody }) => {
    const xsrf = document.cookie
      .split("; ")
      .find((entry) => entry.startsWith("XSRF-TOKEN="))
      ?.split("=", 2)[1];
    const response = await fetch(requestPath, {
      method: requestBody === undefined ? "GET" : "POST",
      credentials: "same-origin",
      headers: requestBody === undefined
        ? undefined
        : {
            "Content-Type": "application/json",
            ...(xsrf ? { "X-XSRF-TOKEN": decodeURIComponent(xsrf) } : {}),
          },
      body: requestBody === undefined ? undefined : JSON.stringify(requestBody),
    });
    const payload = await response.json().catch(() => ({}));
    return { status: response.status, payload };
  }, { requestPath: path, requestBody: body });
}

function expectOk(result: { status: number; payload: unknown }, label: string) {
  expect(result.status, `${label}: ${JSON.stringify(result.payload)}`).toBeLessThan(300);
}

test("restaurant pilot: purchase, issue, prepare, sell, close count and report", async ({ page }) => {
  const pilot = config!;
  await page.goto("/trans-chap/kitchen");
  await expect(page).not.toHaveURL(/\/sign-in(?:\?|$)/);
  await api(page, "/sanctum/csrf-cookie");

  const purchase = await api(page, "/api/v1/purchase-orders", {
    supplier_id: pilot.supplierId ?? null,
    status: "ordered",
    receive_now: true,
    notes: "Playwright restaurant pilot rehearsal",
    lines: [{
      inventory_item_id: pilot.ingredientInventoryItemId,
      quantity: pilot.purchaseQuantity,
      unit_cost: pilot.unitCost,
      purchase_unit: null,
    }],
  });
  expectOk(purchase, "receive purchase order");

  const issue = await api(page, "/api/v1/kitchen-issues", {
    issue_now: true,
    notes: "Playwright restaurant pilot rehearsal",
    lines: [{ inventory_item_id: pilot.ingredientInventoryItemId, quantity: pilot.issueQuantity }],
  });
  expectOk(issue, "issue stock to kitchen");

  const prepared = await api(
    page,
    `/api/v1/restaurant-stock/menu/${encodeURIComponent(pilot.menuInventoryItemId)}/prepare`,
    { batch_count: pilot.batchCount ?? 1, serving_unit: pilot.servingUnit ?? null },
  );
  expectOk(prepared, "prepare menu batch");
  expect(Number((prepared.payload as { data?: { portions_added?: number } }).data?.portions_added ?? 0)).toBeGreaterThan(0);

  const sale = await api(page, "/api/v1/orders", {
    source: "walkin",
    fulfillment_type: "dine_in",
    payment_method: "cash",
    notes: "Playwright restaurant pilot rehearsal",
    items: [{
      inventory_item_id: pilot.menuInventoryItemId,
      quantity: 1,
      serving_unit: pilot.servingUnit ?? null,
    }],
  });
  expectOk(sale, "create cash sale");
  expect((sale.payload as { data?: { payment_method?: string } }).data?.payment_method).toBe("cash");

  const stockTake = await api(page, "/api/v1/restaurant-stock/stock-takes", { location: "kitchen" });
  expectOk(stockTake, "start kitchen close count");
  const take = (stockTake.payload as { data?: { id?: string; lines?: Array<{ id: string; expected_qty: number | null }> } }).data;
  expect(take?.id).toBeTruthy();
  const counted = (take?.lines ?? []).map((line) => ({ line_id: line.id, counted_qty: line.expected_qty ?? 0 }));
  expect(counted.length).toBeGreaterThan(0);

  const saved = await api(page, `/api/v1/restaurant-stock/stock-takes/${take!.id}/counts`, { counts: counted });
  expectOk(saved, "save kitchen close count");
  const completed = await api(page, `/api/v1/restaurant-stock/stock-takes/${take!.id}/complete`, {});
  expectOk(completed, "complete kitchen close count");

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi" }).format(new Date());
  const report = await api(page, `/api/v1/restaurant-stock/reports/kitchen-day?date=${today}`);
  expectOk(report, "load kitchen-day report");

  await page.goto("/trans-chap/sales");
  await expect(page.locator("body")).not.toContainText("Application error");
  await page.goto("/trans-chap/kitchen");
  await expect(page.getByRole("tab", { name: /Orders/ })).toBeVisible();
});
