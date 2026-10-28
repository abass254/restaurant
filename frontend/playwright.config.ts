import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:7100";
const usesExistingServer = Boolean(process.env.PLAYWRIGHT_BASE_URL);
const authStatePath = process.env.PLAYWRIGHT_AUTH_STATE ||
  (process.env.PLAYWRIGHT_EMAIL && process.env.PLAYWRIGHT_PASSWORD
    ? ".auth/merchant.json"
    : undefined);

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global.setup.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    storageState: authStatePath,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: usesExistingServer
    ? undefined
    : {
        command: "npm run dev -- --hostname 127.0.0.1",
        url: `${baseURL}/sign-in`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
