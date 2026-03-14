import { defineConfig } from "cypress";
import { setupMimiqTasks, createLocalRuntime } from "./src/node/index";

export default defineConfig({
  e2e: {
    baseUrl: "http://localhost:5173",
    supportFile: "cypress/support/e2e.ts",
    specPattern: "cypress/e2e/**/*.cy.ts",
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
