import { defineConfig } from "cypress";
import { config as dotenvConfig } from "dotenv";
import { setupMimiqTasks, createLocalRuntime } from "./src/node/index";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

dotenvConfig();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const runtime = createLocalRuntime({
  scenesDir: "./test/scenes",
});

export default defineConfig({
  e2e: {
    baseUrl: "http://localhost:5173",
    supportFile: "test/support/e2e.ts",
    specPattern: "test/e2e/**/*.cy.ts",
    screenshotsFolder: "test/screenshots",
    downloadsFolder: "test/downloads",
    video: false,
    setupNodeEvents(on, config) {
      setupMimiqTasks(on, { runtime });

      on("after:run", async () => {
        const { indexHtml, runReports } = await runtime.generateAllReports();
        const reportDir = path.join(__dirname, "test/reports");
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
