#!/usr/bin/env node
/**
 * Programmatic Agent Test Example
 *
 * Demonstrates how to run agent evaluation from Node.js code.
 *
 * Usage:
 *   node --experimental-modules examples/agent-test.mjs
 */

import { runAgentScene } from "@gojiplus/mimiq/node";
import { existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const scenePath = join(__dirname, "agent-scenes", "customer_support_basic.yaml");
const outputDir = join(__dirname, "outputs", "agent-test");

if (!existsSync(outputDir)) {
  mkdirSync(outputDir, { recursive: true });
}

console.log("Running agent scene:", scenePath);
console.log("Output directory:", outputDir);
console.log("");

try {
  const result = await runAgentScene(scenePath, {
    headless: true,
    outputDir,
  });

  console.log("=== RESULTS ===");
  console.log("Goal achieved:", result.trace.goalAchieved);
  console.log("Terminal state:", result.trace.terminalState || "none");
  console.log("Steps taken:", result.trace.steps.length);
  console.log("");

  console.log("=== EVALUATION ===");
  console.log("Passed:", result.evaluation.passed);
  for (const r of result.evaluation.results) {
    const status = r.passed ? "PASS" : "FAIL";
    console.log(`  [${status}] ${r.name}: ${r.details}`);
  }

  process.exit(result.evaluation.passed ? 0 : 1);
} catch (error) {
  console.error("Agent execution failed:", error.message);
  process.exit(1);
}
