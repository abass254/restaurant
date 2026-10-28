import { expect, test } from "@playwright/test";

test.skip(
  !process.env.PLAYWRIGHT_AUTH_STATE &&
    !(process.env.PLAYWRIGHT_EMAIL && process.env.PLAYWRIGHT_PASSWORD),
  "Set PLAYWRIGHT_AUTH_STATE or PLAYWRIGHT_EMAIL and PLAYWRIGHT_PASSWORD for authenticated checks.",
);

test("signed-in merchant can open the Kitchen workspace", async ({ page }) => {
  await page.goto("/trans-chap/kitchen");
  await expect(page.getByRole("tab", { name: /Orders/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Menu/ })).toBeVisible();
});
