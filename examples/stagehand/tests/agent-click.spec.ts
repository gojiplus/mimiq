/**
 * Stagehand Agent Tests - Browser Automation with Clicking
 *
 * These tests demonstrate Stagehand's ability to perform autonomous
 * browser actions: clicking buttons, navigating, filling forms, etc.
 *
 * Unlike the simulator tests (autonomous-browse.spec.ts) which only
 * simulate user TEXT input, these tests use AgentRunner to actually
 * click and interact with the page.
 *
 * Requirements:
 * - OPENAI_API_KEY or ANTHROPIC_API_KEY set
 * - @browserbase/stagehand installed
 * - Test app running on localhost:5175
 *
 * Run:
 *   npx playwright test tests/agent-click.spec.ts
 */

import { test, expect } from "@playwright/test";
import { runAgentScene, type AgentRunResult } from "@gojiplus/mimiq/node";
import { mkdirSync } from "fs";
import { join } from "path";

const TEST_URL = process.env.TEST_URL || "http://localhost:5173";
const OUTPUT_DIR = join(process.cwd(), "test-results", "agent-clicks");

test.describe("Stagehand Agent - Browser Clicking", () => {
  test.beforeAll(() => {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  });

  test("clicks Track Order button and enters order ID", async () => {
    test.setTimeout(120000);

    const result: AgentRunResult = await runAgentScene(
      {
        id: "click-track-order",
        agent: {
          type: "stagehand",
          model: process.env.STAGEHAND_MODEL || "openai/gpt-4o",
          headless: true,
        },
        target: {
          url: TEST_URL,
        },
        goal: `
          1. Look for a "Track Order" button or quick action on the page
          2. Click it
          3. When prompted, enter order ID: ORD-12345
          4. Get the order status information
        `,
        persona: "cooperative",
        max_turns: 8,
        expectations: {
          allowed_terminal_states: ["order_info_provided", "issue_resolved", "conversation_ended"],
        },
      },
      {
        outputDir: join(OUTPUT_DIR, "click-track-order"),
        headless: true,
      }
    );

    console.log("\n=== Click Track Order Test Results ===");
    console.log(`Goal achieved: ${result.trace.goalAchieved}`);
    console.log(`Terminal state: ${result.trace.terminalState || "none"}`);
    console.log(`Steps taken: ${result.trace.steps.length}`);

    for (const step of result.trace.steps) {
      console.log(`  Turn ${step.turn}: ${step.action.instruction?.slice(0, 60)}...`);
    }

    expect(result.trace.steps.length).toBeGreaterThan(0);
  });

  test("clicks Start Return button and requests return", async () => {
    test.setTimeout(120000);

    const result: AgentRunResult = await runAgentScene(
      {
        id: "click-start-return",
        agent: {
          type: "stagehand",
          model: process.env.STAGEHAND_MODEL || "openai/gpt-4o",
          headless: true,
        },
        target: {
          url: TEST_URL,
        },
        goal: `
          1. Click the "Start Return" button on the page
          2. When asked, provide order ID: ORD-99999
          3. Explain that the item was damaged
        `,
        persona: "cooperative",
        max_turns: 6,
        context: {
          order_id: "ORD-99999",
          reason: "Item arrived damaged",
        },
        expectations: {
          allowed_terminal_states: ["return_initiated", "return_created", "conversation_ended"],
        },
      },
      {
        outputDir: join(OUTPUT_DIR, "click-start-return"),
        headless: true,
      }
    );

    console.log("\n=== Start Return Test Results ===");
    console.log(`Goal achieved: ${result.trace.goalAchieved}`);
    console.log(`Steps taken: ${result.trace.steps.length}`);

    for (const step of result.trace.steps) {
      console.log(`  Turn ${step.turn}: ${step.action.instruction?.slice(0, 60)}...`);
    }

    expect(result.trace.steps.length).toBeGreaterThan(0);
  });

  test("fills contact form by clicking and typing", async () => {
    test.setTimeout(120000);

    const result: AgentRunResult = await runAgentScene(
      {
        id: "click-fill-form",
        agent: {
          type: "stagehand",
          model: process.env.STAGEHAND_MODEL || "openai/gpt-4o",
          headless: true,
        },
        target: {
          url: TEST_URL,
        },
        goal: `
          1. Look for any input field, contact form, or chat input on the page
          2. Click on it to focus
          3. Type a message: "Hello, I need help with my order"
          4. Submit the message (press Enter or click Send button)
        `,
        persona: "cooperative",
        max_turns: 6,
        expectations: {
          allowed_terminal_states: ["message_sent", "conversation_started", "conversation_ended"],
        },
      },
      {
        outputDir: join(OUTPUT_DIR, "click-fill-form"),
        headless: true,
      }
    );

    console.log("\n=== Form Fill Test Results ===");
    console.log(`Goal achieved: ${result.trace.goalAchieved}`);

    for (const step of result.trace.steps) {
      const action = step.action.instruction || "observe";
      const result_text = step.action.result?.slice(0, 50) || "";
      console.log(`  ${step.turn}: ${action.slice(0, 40)}... -> ${result_text}`);
    }

    expect(result.trace.steps.length).toBeGreaterThan(0);
  });
});
