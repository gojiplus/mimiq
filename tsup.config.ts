import { defineConfig } from "tsup";
import { cpSync } from "fs";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "node/index": "src/node/index.ts",
    "adapters/cypress/index": "src/adapters/cypress/index.ts",
    "adapters/playwright/index": "src/adapters/playwright/index.ts",
    "simulators/index": "src/simulators/index.ts",
  },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  external: [
    "cypress",
    "@playwright/test",
    "@browserbase/stagehand",
    "yaml",
    "nunjucks",
    "fs",
    "path",
    "os",
    "url",
  ],
  onSuccess: async () => {
    cpSync("src/templates", "dist/templates", { recursive: true });
  },
});
