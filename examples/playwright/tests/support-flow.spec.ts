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
import { mkdirSync, writeFileSync } from "fs";
import { createBrowserAdapter } from "@gojiplus/mimiq/playwright";

test.describe("Customer Support Flows", () => {
  test("generic browser adapter captures arbitrary controls and app telemetry", async ({ page }) => {
    await page.goto("/");
    const adapter = createBrowserAdapter(page);

    const initialSnapshot = await adapter.captureSnapshot();
    expect(initialSnapshot.transcript).toEqual([]);
    expect(initialSnapshot.availableActions).toContainEqual(expect.objectContaining({
      kind: "click",
      label: "Track Order",
    }));

    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent("mimiq:telemetry", {
        detail: {
          name: "order.lookup.started",
          data: { source: "support-widget" },
        },
      }));
    });
    const telemetrySnapshot = await adapter.captureSnapshot();
    expect(telemetrySnapshot.metadata?.applicationTelemetry).toEqual([{
      name: "order.lookup.started",
      data: { source: "support-widget" },
    }]);
  });

  test("records agent tool calls emitted by application instrumentation", async ({ page, mimiq }) => {
    await page.goto("/");
    await mimiq.startRun({
      scene: {
        id: "instrumented-tool-call",
        starting_prompt: "Hello",
        conversation_plan: "Ask for help.",
        persona: "cooperative",
        max_turns: 1,
        expectations: { required_tools: ["lookup_order"] },
      },
    });

    await mimiq.runTurn();
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent("mimiq:agent-tool-call", {
        detail: { name: "lookup_order", args: { order_id: "ORD-10031" }, result: { found: true } },
      }));
    });
    await mimiq.runTurn();

    const trace = await mimiq.getTrace();
    expect(trace.entries).toContainEqual(expect.objectContaining({
      actor: "assistant_tool",
      name: "lookup_order",
      args: { order_id: "ORD-10031" },
    }));
    expect((await mimiq.evaluate()).passed).toBe(true);
  });

  test("replays recorded browser actions against a fresh page", async ({ page, mimiq }, testInfo) => {
    await page.goto("/");

    const runDir = testInfo.outputPath("evidence");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      `${runDir}/events.jsonl`,
      [
        {
          sequence: 1,
          timestamp: new Date().toISOString(),
          type: "observation.captured",
          payload: {
            snapshot: {
              transcript: [],
              availableActions: [{
                id: "recorded-track-order",
                kind: "click",
                label: "Track Order",
                enabled: true,
                metadata: {
                  selector: "body:nth-of-type(1) > div:nth-of-type(1) > div:nth-of-type(1) > div:nth-of-type(2) > button:nth-of-type(1)",
                },
              }],
              availableUserTools: [],
            },
          },
        },
        {
          sequence: 2,
          timestamp: new Date().toISOString(),
          type: "browser.action_executed",
          payload: { action: { kind: "message", text: "Hello" }, succeeded: true },
        },
        {
          sequence: 3,
          timestamp: new Date().toISOString(),
          type: "browser.action_executed",
          payload: {
            action: { kind: "click", targetId: "recorded-track-order" },
            succeeded: true,
            observationSequence: 1,
          },
        },
      ].map((event) => JSON.stringify(event)).join("\n"),
    );

    const replay = await mimiq.replayEvidenceBundle(runDir);
    expect(replay.replayedActions).toEqual([
      { kind: "message", text: "Hello" },
      { kind: "click", targetId: "mimiq-button-1" },
    ]);
    expect(replay.skippedActions).toEqual([]);
    await expect(page.locator("[data-test=transcript]")).toContainText("I'd like to track my order.");
  });

  test("browser policy can execute a dynamically observed control", async ({ page, mimiq }) => {
    await page.goto("/");

    const snapshot = await mimiq.captureSnapshot();
    const trackOrder = snapshot.availableActions.find(
      (action) => action.id.startsWith("mimiq-button-") && action.label === "Track Order",
    );
    expect(trackOrder).toBeDefined();
    expect(trackOrder?.metadata?.selector).toContain("button");

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(
      JSON.stringify({
        choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify({ kind: "click", targetId: trackOrder!.id }) }, finish_reason: "stop" }],
      }),
      { headers: { "Content-Type": "application/json" } },
    );

    try {
      await mimiq.startRun({
        scene: {
          id: "observed-control",
          starting_prompt: "Hello",
          conversation_plan: "Track the customer's order using the visible control.",
          persona: "cooperative",
          max_turns: 2,
          simulator: {
            type: "browser-use",
            model: "qwen3:8b",
            options: { baseURL: "http://127.0.0.1:11434/v1" },
          },
        },
      });

      await mimiq.runTurn();
      const advance = await mimiq.runTurn();
      expect(advance.action).toEqual({ kind: "click", targetId: trackOrder!.id });
      await expect(page.locator("[data-test=transcript]")).toContainText("I'd like to track my order.");
      expect((await mimiq.evaluate()).passed).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

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
    expect(report.passed).toBe(true);

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
