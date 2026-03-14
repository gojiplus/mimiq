import { defineConfig } from "cypress";
import { setupMimiqTasks, createLocalRuntime } from "./src/node/index";

export default defineConfig({
  e2e: {
    baseUrl: "http://localhost:5173",
    supportFile: "test/support/e2e.ts",
    specPattern: "test/e2e/**/*.cy.ts",
    screenshotsFolder: "test/screenshots",
    downloadsFolder: "test/downloads",
    video: false,
    setupNodeEvents(on, config) {
      const runtime = createLocalRuntime({
        scenesDir: "./test/scenes",
      });

      setupMimiqTasks(on, { runtime });

      return config;
    },
  },
});
