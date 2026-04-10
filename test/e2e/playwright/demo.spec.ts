/**
 * Demo test for mimiq running against TechShop agent.
 *
 * This demonstrates the full simulation and recording pipeline:
 * 1. Simulates a customer returning a backpack
 * 2. Records the conversation transcript
 * 3. Evaluates the agent's performance
 *
 * Run with recording:
 *   MIMIQ_RECORDING=1 npx playwright test demo.spec.ts
 *
 * Outputs to test/recordings/{sceneId}/run-{N}/
 */

import { test, expect } from "./fixtures";

test.describe("TechShop Agent Demo", () => {
  test("return eligible backpack - full simulation", async ({ page, mimiq }) => {
    await page.goto("/");

    await mimiq.startRun({
      sceneId: "return_eligible_backpack",
    });

    try {
      await mimiq.runToCompletion({ maxTurns: 20 });
    } catch (e) {
      console.log("Note: Conversation did not reach terminal state, evaluating current state...");
    }

    const report = await mimiq.evaluate();

    console.log("\n=== Evaluation Report ===");
    console.log(`Run ID: ${report.runId}`);
    console.log(`Passed: ${report.passed}`);
    console.log(`Terminal State: ${report.terminalState}`);
    console.log(`Summary: ${report.summary}`);
    console.log("\nChecks:");
    for (const check of report.checks) {
      const icon = check.passed ? "✓" : "✗";
      console.log(`  ${icon} ${check.name}: ${check.details ?? ""}`);
    }
    console.log("");

    const trace = await mimiq.getTrace();
    console.log("\n=== Conversation Trace ===");
    for (const entry of trace.entries.slice(0, 10)) {
      if (entry.kind === "message") {
        const label = entry.actor === "user" ? "Customer" : "Agent";
        console.log(`[${label}]: ${entry.text?.slice(0, 80)}...`);
      }
    }
  });

  test("track order via button - quick flow", async ({ page, mimiq }) => {
    await page.goto("/");

    await mimiq.startRun({
      sceneId: "track_order_via_button",
    });

    try {
      await mimiq.runToCompletion({ maxTurns: 12 });
    } catch (e) {
      console.log("Note: Conversation did not reach terminal state...");
    }

    const report = await mimiq.evaluate();

    console.log("\n=== Track Order Evaluation ===");
    console.log(`Passed: ${report.passed}`);
    console.log(`Terminal State: ${report.terminalState}`);
    console.log(`Summary: ${report.summary}`);
  });

  test("captures conversation trace", async ({ page, mimiq }) => {
    await page.goto("/");

    await mimiq.startRun({
      scene: {
        id: "simple-greeting",
        starting_prompt: "Hello, I need help with my order",
        conversation_plan: "Greet the agent, provide order number ORD-10031 when asked, then say thank you.",
        persona: "cooperative",
        max_turns: 8,
        expectations: {},
      },
    });

    await mimiq.runToCompletion({ maxTurns: 8 });

    const trace = await mimiq.getTrace();

    console.log("\n=== Conversation Trace ===");
    console.log(`Run ID: ${trace.runId}`);
    console.log(`Terminal State: ${trace.terminalState ?? "none"}`);
    console.log(`Entries: ${trace.entries.length}`);

    for (const entry of trace.entries) {
      if (entry.kind === "message") {
        const label = entry.actor === "user" ? "Customer" : "Agent";
        console.log(`\n[${label}]: ${entry.text?.slice(0, 100)}...`);
      } else if (entry.kind === "tool") {
        console.log(`  -> Tool: ${entry.name}(${JSON.stringify(entry.args)})`);
      }
    }

    expect(trace.entries.length).toBeGreaterThan(0);
  });

  test("single turn step-through", async ({ page, mimiq }) => {
    await page.goto("/");

    await mimiq.startRun({
      sceneId: "return_eligible_backpack",
    });

    const turn1 = await mimiq.runTurn();
    console.log(`Turn 1: ${turn1.action.kind}`);
    expect(turn1.turn).toBe(1);

    if (turn1.action.kind !== "done") {
      const turn2 = await mimiq.runTurn();
      console.log(`Turn 2: ${turn2.action.kind}`);
      expect(turn2.turn).toBeGreaterThanOrEqual(1);
    }

    const snapshot = await mimiq.captureSnapshot();
    console.log(`Messages visible: ${snapshot.transcript.length}`);
    console.log(`Available actions: ${snapshot.availableActions.map(a => a.id).join(", ")}`);

    expect(snapshot.transcript.length).toBeGreaterThan(0);
  });

  test.skip("multiple runs aggregation", async ({ page, mimiq }) => {
    const result = await mimiq.runMultiple({
      sceneId: "track_order_via_button",
      count: 3,
      onRunComplete: (runId, report) => {
        console.log(`Run ${runId}: ${report.passed ? "PASS" : "FAIL"}`);
      },
    });

    console.log("\n=== Aggregate Summary ===");
    console.log(`Scene: ${result.summary.sceneId}`);
    console.log(`Total Runs: ${result.summary.totalRuns}`);
    console.log(`Passed: ${result.summary.passedRuns}`);
    console.log(`Failed: ${result.summary.failedRuns}`);
    console.log(`Pass Rate: ${result.summary.passRate.toFixed(1)}%`);

    expect(result.summary.totalRuns).toBe(3);
  });
});
