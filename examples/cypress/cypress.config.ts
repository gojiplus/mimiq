import { defineConfig } from "cypress";
import { config as dotenvConfig } from "dotenv";
import { setupMimiqTasks, createLocalRuntime } from "@gojiplus/mimiq/node";
import * as fs from "fs";
import * as path from "path";

dotenvConfig();

const recordingEnabled = process.env.MIMIQ_RECORDING === "1";

const runtime = createLocalRuntime({
  scenesDir: "./scenes",
  recording: {
    enabled: recordingEnabled,
    outputDir: "../outputs/recordings",
    framework: "cypress",
    screenshots: {
      enabled: true,
      timing: "before",
      format: "png",
    },
    transcript: {
      format: "json",
      includeUiState: true,
    },
    actionLog: {
      enabled: true,
      format: "markdown",
    },
    runNaming: "sequential",
    defaultRunCount: 3,
  },
});

export default defineConfig({
  e2e: {
    baseUrl: "http://localhost:5173",
    supportFile: "support/e2e.ts",
    specPattern: "tests/**/*.cy.ts",
    screenshotsFolder: "../outputs/screenshots/cypress",
    downloadsFolder: "../outputs/downloads",
    video: false,
    setupNodeEvents(on, config) {
      setupMimiqTasks(on, { runtime });

      on("after:run", async () => {
        const { indexHtml, runReports } = await runtime.generateAllReports();
        const reportDir = path.join(__dirname, "../outputs/reports/cypress");
        fs.mkdirSync(reportDir, { recursive: true });
        fs.writeFileSync(path.join(reportDir, "index.html"), indexHtml);
        for (const report of runReports) {
          fs.writeFileSync(path.join(reportDir, `${report.sceneId}.html`), report.html);
        }
      });

      return config;
    },
  },
});
