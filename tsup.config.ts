import { defineConfig } from "tsup";
import { cpSync } from "fs";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "node/index": "src/node/index.ts",
  },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  external: ["cypress"],
  onSuccess: async () => {
    cpSync("src/templates", "dist/templates", { recursive: true });
  },
});
