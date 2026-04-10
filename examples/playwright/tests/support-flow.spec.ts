/**
 * Basic Playwright test demonstrating mimiq agent evaluation.
 *
 * These tests simulate customer interactions and evaluate the AI agent's
 * ability to handle common support scenarios.
 *
 * Run tests:
 *   npm test
 *
 * Run with recording (for demo GIFs):
 *   npm run test:record
 */

import { test, expect } from "../fixtures";

test.describe("Customer Support Flows", () => {
  test("customer asks about order status", async ({ page, mimiq }) => {
    await page.goto("/");

    await mimiq.startRun({ sceneId: "customer_support_basic" });
    await mimiq.runToCompletion();

    const report = await mimiq.evaluate();

    console.log("Evaluation Report:");
    console.log(`  Passed: ${report.passed}`);
    console.log(`  Terminal State: ${report.terminalState}`);
    console.log(`  Summary: ${report.summary}`);

    for (const check of report.checks) {
      const icon = check.passed ? "[PASS]" : "[FAIL]";
      console.log(`  ${icon} ${check.name}`);
    }

    expect(report.terminalState).toMatch(/order_info_provided|conversation_ended/);
  });

  test("customer initiates return request", async ({ page, mimiq }) => {
    test.setTimeout(60000);
    await page.goto("/");

    await mimiq.startRun({ sceneId: "return_request" });

    try {
      await mimiq.runToCompletion({ maxTurns: 15 });
    } catch (e) {
      console.log("Reached turn limit, evaluating...");
    }

    const report = await mimiq.evaluate();

    console.log("Return Request Evaluation:");
    console.log(`  Passed: ${report.passed}`);
    console.log(`  Checks: ${report.summary}`);

    const trace = await mimiq.getTrace();
    console.log(`  Conversation turns: ${trace.entries.length}`);
  });

  test("inline scene definition", async ({ page, mimiq }) => {
    await page.goto("/");

    await mimiq.startRun({
      scene: {
        id: "inline-greeting",
        starting_prompt: "Hello! Can you help me?",
        conversation_plan: `
          Simple greeting exchange.
          - Ask about business hours
          - Thank the agent
        `,
        persona: "cooperative",
        max_turns: 5,
        expectations: {
          allowed_terminal_states: ["greeting_complete", "conversation_ended"],
        },
      },
    });

    await mimiq.runToCompletion({ maxTurns: 5 });

    const report = await mimiq.evaluate();
    expect(report.checks).toBeDefined();
  });

  test("step-by-step turn execution", async ({ page, mimiq }) => {
    await page.goto("/");

    await mimiq.startRun({ sceneId: "customer_support_basic" });

    const turn1 = await mimiq.runTurn();
    expect(turn1.turn).toBe(1);
    expect(turn1.action.kind).toBe("message");

    if (turn1.action.kind !== "done") {
      const turn2 = await mimiq.runTurn();
      expect(turn2.turn).toBeGreaterThanOrEqual(1);
    }

    const snapshot = await mimiq.captureSnapshot();
    expect(snapshot.transcript.length).toBeGreaterThan(0);
  });
});
