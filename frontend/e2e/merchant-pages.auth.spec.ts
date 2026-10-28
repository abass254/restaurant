import { expect, test } from "@playwright/test";

test.skip(
  !process.env.PLAYWRIGHT_AUTH_STATE &&
    !(process.env.PLAYWRIGHT_EMAIL && process.env.PLAYWRIGHT_PASSWORD),
  "Set PLAYWRIGHT_AUTH_STATE or PLAYWRIGHT_EMAIL and PLAYWRIGHT_PASSWORD for authenticated checks.",
);

const merchantPages = [
  ["Home", "/trans-chap"],
  ["Menu", "/trans-chap/menus"],
  ["Inventory", "/trans-chap/stocks"],
  ["Kitchen", "/trans-chap/kitchen"],
  ["Orders or Sales", "/trans-chap/sales"],
  ["POS", "/trans-chap/pos"],
  ["Customers", "/trans-chap/customers"],
  ["Suppliers", "/trans-chap/suppliers"],
  ["Supplies or Purchases", "/trans-chap/purchases"],
  ["M-PESA", "/trans-chap/mpesa"],
  ["Reports", "/trans-chap/reports"],
  ["Settings", "/trans-chap/settings"],
] as const;

for (const [name, path] of merchantPages) {
  test(`merchant ${name} page opens`, async ({ page }) => {
    const response = await page.goto(path);

    expect(response?.status(), `${path} should return a successful page response`).toBeLessThan(400);
    await expect(page).not.toHaveURL(/\/sign-in(?:\?|$)/);
    await expect(page.locator("body")).not.toContainText("Application error");
  });
}
