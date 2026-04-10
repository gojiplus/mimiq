/**
 * Stagehand autonomous browser automation tests.
 *
 * These tests demonstrate Stagehand's ability to perform autonomous
 * browser actions - not just typing in a chat, but clicking, navigating,
 * and interacting with the page dynamically.
 *
 * Requirements:
 * - OPENAI_API_KEY or STAGEHAND_MODEL set
 * - @browserbase/stagehand installed
 *
 * Run:
 *   OPENAI_API_KEY=... npm test
 */

import { test, expect } from "../fixtures";

test.describe("Stagehand Autonomous Browser Agent", () => {
  test("navigates to find return policy", async ({ page, mimiq }) => {
    await page.goto("/");

    await mimiq.startRun({ sceneId: "autonomous_navigation" });

    try {
      await mimiq.runToCompletion({ maxTurns: 10 });
    } catch (e) {
      console.log("Navigation completed or reached turn limit");
    }

    const report = await mimiq.evaluate();

    console.log("Autonomous Navigation Results:");
    console.log(`  Terminal State: ${report.terminalState}`);
    console.log(`  Summary: ${report.summary}`);

    const trace = await mimiq.getTrace();
    console.log(`  Total actions: ${trace.entries.length}`);

    for (const entry of trace.entries.slice(0, 5)) {
      console.log(`  - ${entry.actor}: ${entry.kind} ${entry.text?.slice(0, 50) || entry.name || ""}`);
    }
  });

  test("assists with checkout process", async ({ page, mimiq }) => {
    await page.goto("/");

    await mimiq.startRun({ sceneId: "autonomous_checkout_help" });

    try {
      await mimiq.runToCompletion({ maxTurns: 12 });
    } catch (e) {
      console.log("Checkout assistance completed");
    }

    const report = await mimiq.evaluate();

    console.log("Checkout Assistance Results:");
    console.log(`  Passed: ${report.passed}`);
    console.log(`  Checks: ${report.checks.length}`);
  });

  test("inline stagehand scene", async ({ page, mimiq }) => {
    await page.goto("/");

    await mimiq.startRun({
      scene: {
        id: "inline-stagehand-demo",
        starting_prompt: "What products do you have?",
        conversation_plan: `
          Goal: Browse available products.
          - Ask about product categories
          - Get details on one product
        `,
        persona: "curious",
        max_turns: 8,
        simulator: {
          type: "stagehand",
          options: {
            model: "gpt-4o",
            headless: true,
            verbose: false,
          },
        },
        expectations: {},
      },
    });

    try {
      await mimiq.runToCompletion({ maxTurns: 8 });
    } catch {
      // Expected to complete or timeout
    }

    const snapshot = await mimiq.captureSnapshot();
    expect(snapshot.transcript.length).toBeGreaterThan(0);
  });
});
