/**
 * LayoutLens visual assertion tests.
 *
 * These tests demonstrate visual AI-powered assertions:
 * - Element presence verification
 * - Accessibility audits
 * - Layout validation
 *
 * Prerequisites:
 * - Python with layoutlens installed: pip install layoutlens
 * - Or LayoutLens server running: npm run layoutlens:server
 *
 * Run:
 *   npm test
 */

import { test, expect } from "../fixtures";
import {
  visualAssert,
  accessibilityAudit,
  runVisualAssertions,
  createLayoutLensClient,
} from "@gojiplus/mimiq";

test.describe("LayoutLens Visual Assertions", () => {
  test("validates chat UI accessibility", async ({ page, mimiq }) => {
    await page.goto("/");

    await mimiq.startRun({ sceneId: "accessibility_evaluation" });

    try {
      await mimiq.runToCompletion({ maxTurns: 3 });
    } catch {
      // Expected
    }

    const report = await mimiq.evaluate();

    console.log("Accessibility Evaluation:");
    console.log(`  Passed: ${report.passed}`);
    console.log(`  Checks:`);

    for (const check of report.checks) {
      const icon = check.passed ? "[PASS]" : "[FAIL]";
      console.log(`    ${icon} ${check.name}: ${check.details || ""}`);
    }

    const visualChecks = report.checks.filter((c) => c.name.startsWith("visual:"));
    console.log(`  Visual assertions: ${visualChecks.length}`);

    const accessibilityChecks = report.checks.filter((c) =>
      c.name.startsWith("accessibility:")
    );
    console.log(`  Accessibility checks: ${accessibilityChecks.length}`);
  });

  test("checks form validation UI", async ({ page, mimiq }) => {
    await page.goto("/");

    await mimiq.startRun({ sceneId: "form_visual_validation" });

    try {
      await mimiq.runToCompletion({ maxTurns: 5 });
    } catch {
      // Expected
    }

    const report = await mimiq.evaluate();

    console.log("Form Visual Validation:");
    console.log(`  Summary: ${report.summary}`);
  });

  test("standalone visual assertion", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const url = page.url();
    const result = await visualAssert(
      url,
      "Is there a chat input field visible on the page?"
    );

    console.log("Standalone Visual Assertion:");
    console.log(`  Query: Is there a chat input field?`);
    console.log(`  Passed: ${result.passed}`);
    console.log(`  Confidence: ${(result.confidence * 100).toFixed(0)}%`);
    console.log(`  Answer: ${result.answer}`);

    if (result.error) {
      console.log(`  Note: ${result.error}`);
    }
  });

  test("standalone accessibility audit", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const url = page.url();
    const result = await accessibilityAudit(url, { level: "AA" });

    console.log("Standalone Accessibility Audit:");
    console.log(`  Level: AA`);
    console.log(`  Passed: ${result.passed}`);
    console.log(`  Answer: ${result.answer}`);

    if (result.error) {
      console.log(`  Note: ${result.error}`);
    }
  });

  test("batch visual assertions", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const url = page.url();
    const assertions = [
      { query: "Is there a text input field?", minConfidence: 0.7 },
      { query: "Is there a submit or send button?", minConfidence: 0.7 },
      { query: "Is the page layout clean and organized?", minConfidence: 0.6 },
    ];

    const results = await runVisualAssertions(url, assertions);

    console.log("Batch Visual Assertions:");
    console.log(`  All passed: ${results.passed}`);

    for (const r of results.results) {
      const icon = r.passed ? "[PASS]" : "[FAIL]";
      console.log(`  ${icon} ${r.query}`);
      console.log(`       Confidence: ${(r.result.confidence * 100).toFixed(0)}%`);
    }
  });

  test("layoutlens client usage", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const lens = createLayoutLensClient({
      timeout: 30000,
    });

    const url = page.url();
    const result = await lens.visualAssert(url, "Is the chat interface visible?");

    console.log("LayoutLens Client:");
    console.log(`  Confidence: ${(result.confidence * 100).toFixed(0)}%`);
    console.log(`  Answer: ${result.answer.slice(0, 100)}`);
  });
});
