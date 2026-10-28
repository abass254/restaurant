import { chromium, type FullConfig } from "@playwright/test";
import { mkdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export default async function globalSetup(config: FullConfig) {
  const suppliedState = process.env.PLAYWRIGHT_AUTH_STATE;
  const email = process.env.PLAYWRIGHT_EMAIL;
  const password = process.env.PLAYWRIGHT_PASSWORD;

  if (suppliedState) {
    try {
      await stat(resolve(config.rootDir, suppliedState));
    } catch {
      throw new Error(`PLAYWRIGHT_AUTH_STATE does not exist: ${suppliedState}`);
    }
    return;
  }

  if (!email && !password) return;
  if (!email || !password) {
    throw new Error("Set both PLAYWRIGHT_EMAIL and PLAYWRIGHT_PASSWORD to enable automatic sign-in.");
  }

  const statePath = resolve(config.rootDir, ".auth/merchant.json");
  await mkdir(dirname(statePath), { recursive: true });

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(new URL("/sign-in", config.projects[0].use.baseURL as string).toString());
    await page.getByRole("button", { name: "Use password instead" }).click();
    await page.locator("#login-email").fill(email);
    await page.getByPlaceholder("Password", { exact: true }).fill(password);

    await Promise.all([
      page.waitForURL((url) => !/\/sign-in\/?$/.test(url.pathname), { timeout: 30_000 }),
      page.getByRole("button", { name: "Sign In", exact: true }).click(),
    ]);

    await page.context().storageState({ path: statePath });
  } catch {
    throw new Error("Playwright could not sign in. Check the QA URL, account credentials, and whether the account requires a password reset or one-time code.");
  } finally {
    await browser.close();
  }
}
