import { defineConfig, devices } from "@playwright/test";

const usesLocalModel = process.env.LLM_MODEL?.startsWith("local/") ?? false;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI || usesLocalModel ? 1 : undefined,
  timeout: usesLocalModel ? 90000 : 30000,
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
  webServer: [
    {
      command: "uv run uvicorn agent_server:app --app-dir src --port 8001",
      url: "http://localhost:8001/health",
      reuseExistingServer: !process.env.CI,
      cwd: "../../test/agent-server",
    },
    {
      command: "npm run dev --prefix test/app",
      url: "http://localhost:5173",
      reuseExistingServer: !process.env.CI,
      cwd: "../..",
    },
  ],
});
