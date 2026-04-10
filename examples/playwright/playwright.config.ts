import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ["list"],
    ["html", { outputFolder: "../outputs/reports/playwright" }],
  ],
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
    video: process.env.MIMIQ_RECORDING ? "on" : "off",
    screenshot: process.env.MIMIQ_RECORDING ? "on" : "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev --prefix ../../test/app",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    cwd: "../..",
  },
});
