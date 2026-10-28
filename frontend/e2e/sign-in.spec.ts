import { expect, test } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });

test("merchant sign-in page loads", async ({ page }) => {
  const response = await page.goto("/sign-in");

  expect(response?.ok()).toBeTruthy();
  await expect(page.getByRole("heading", { name: "Sign in to your dashboard" })).toBeVisible();
  await expect(page.getByPlaceholder("Email/Phone Number")).toBeVisible();
});
