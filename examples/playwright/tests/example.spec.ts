/**
 * Example Playwright test using mimiq.
 *
 * This test demonstrates how to use mimiq with Playwright to simulate
 * user interactions and evaluate AI agent responses.
 */

import { test, expect } from "../fixtures";

test.describe("Mimiq Playwright Integration", () => {
  test("runs a basic conversation flow", async ({ page, mimiq }) => {
    await page.goto("/");

    await mimiq.startRun({
      scene: {
        id: "test-greeting",
        starting_prompt: "Hello, I need help with my order",
        conversation_plan: `
          1. Greet the agent and mention needing help with an order
          2. When asked for details, provide order number #12345
          3. Thank the agent and end the conversation
        `,
        persona: "cooperative",
        max_turns: 10,
        expectations: {},
      },
    });

    await mimiq.runToCompletion({ maxTurns: 10 });

    const report = await mimiq.evaluate();
    console.log("Evaluation report:", report);
  });

  test("captures snapshots correctly", async ({ page, mimiq }) => {
    await page.goto("/");

    await mimiq.startRun({
      scene: {
        id: "snapshot-test",
        starting_prompt: "Hi there!",
        conversation_plan: "Say hello",
        persona: "cooperative",
        max_turns: 2,
        expectations: {},
      },
    });

    const snapshot = await mimiq.captureSnapshot();
    expect(snapshot).toHaveProperty("url");
    expect(snapshot).toHaveProperty("transcript");
    expect(snapshot).toHaveProperty("availableActions");
  });

  test("handles single turn execution", async ({ page, mimiq }) => {
    await page.goto("/");

    await mimiq.startRun({
      scene: {
        id: "single-turn",
        starting_prompt: "What are your hours?",
        conversation_plan: "Ask about business hours",
        persona: "cooperative",
        max_turns: 5,
        expectations: {},
      },
    });

    const response = await mimiq.runTurn();
    expect(response).toHaveProperty("action");
    expect(response).toHaveProperty("turn");
  });
});
