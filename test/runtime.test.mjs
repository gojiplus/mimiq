import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { complete, createSimulator, runVisualAssertions } from "../dist/index.js";
import { createLocalRuntime } from "../dist/node/index.js";
import { MimiqTestHelper } from "../dist/adapters/playwright/index.js";

function scene(id, expectations = {}) {
  return {
    id,
    starting_prompt: "Hello",
    conversation_plan: "Test the runtime.",
    persona: "cooperative",
    max_turns: 1,
    expectations,
  };
}

function snapshot(overrides = {}) {
  return {
    url: "http://example.test/",
    transcript: [],
    availableActions: [],
    availableUserTools: [],
    ...overrides,
  };
}

test("the published simulators subpath imports", async () => {
  const simulators = await import("@gojiplus/mimiq/simulators");
  assert.equal(typeof simulators.BrowserUseSimulator, "function");
});

test("completion observes the terminal state after the final allowed action", async () => {
  let advances = 0;
  const runtime = {
    async startRun() {
      return { runId: "completion-run" };
    },
    async advanceRun() {
      advances++;
      return advances === 1
        ? { runId: "completion-run", turn: 1, action: { kind: "message", text: "Hello" } }
        : { runId: "completion-run", turn: 1, action: { kind: "done", reason: "Finished" } };
    },
    async recordActionResult() {},
  };
  const adapter = {
    async captureSnapshot() {
      return snapshot();
    },
    async executeAction() {},
    async awaitSettled() {},
  };
  const helper = new MimiqTestHelper({}, runtime, adapter);

  await helper.startRun({ sceneId: "completion" });
  await helper.runToCompletion({ maxTurns: 1 });

  assert.equal(advances, 2);
});

test("configured model gateways use the chat-completions transport", async (t) => {
  const originalFetch = globalThis.fetch;
  let requestedUrl;
  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer proxy-key");
    assert.equal(JSON.parse(String(init?.body)).reasoning_effort, "none");
    return new Response(
      JSON.stringify({
        id: "chatcmpl-local",
        object: "chat.completion",
        created: 0,
        model: "mimiq-policy",
        choices: [{
          index: 0,
          message: { role: "assistant", content: "Local response" },
          finish_reason: "stop",
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await complete("Say hello.", {
    model: "mimiq-policy",
    baseURL: "http://127.0.0.1:4000",
    apiKey: "proxy-key",
  });

  assert.equal(result, "Local response");
  assert.equal(requestedUrl, "http://127.0.0.1:4000/chat/completions");
});

test("LLM simulators include scene context in the generated prompt", async (t) => {
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (_input, init) => {
    requestBody = String(init?.body);
    return new Response(
      JSON.stringify({
        id: "chatcmpl-context",
        object: "chat.completion",
        created: 0,
        model: "qwen3:8b",
        choices: [{
          index: 0,
          message: { role: "assistant", content: "ORD-CONTEXT" },
          finish_reason: "stop",
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const simulator = createSimulator({
    ...scene("context"),
    context: { order_id: "ORD-CONTEXT" },
  }, {
    defaultSimulatorConfig: {
      model: "qwen3:8b",
      baseURL: "http://127.0.0.1:11434/v1",
    },
  });

  await simulator.nextTurn(snapshot());
  await simulator.nextTurn(snapshot({
    transcript: [{ role: "assistant", text: "What is your order ID?" }],
  }));

  assert.match(requestBody, /ORD-CONTEXT/);
});

test("local runtime preserves repeated messages and tool calls", async () => {
  const runtime = createLocalRuntime();
  const { runId } = await runtime.startRun({ scene: scene("trace") });

  await runtime.advanceRun({
    runId,
    snapshot: snapshot({
      transcript: [{ id: "1", role: "assistant", text: "Checking now." }],
      metadata: {
        toolCalls: [
          { name: "lookup_order", args: { id: "one" } },
          { name: "lookup_order", args: { id: "two" } },
        ],
      },
    }),
  });
  await runtime.advanceRun({
    runId,
    snapshot: snapshot({
      transcript: [
        { id: "1", role: "assistant", text: "Checking now." },
        { id: "2", role: "assistant", text: "Checking now." },
      ],
      metadata: {
        toolCalls: [
          { name: "lookup_order", args: { id: "one" } },
          { name: "lookup_order", args: { id: "two" } },
        ],
      },
    }),
  });

  const trace = await runtime.getTrace({ runId });
  assert.equal(trace.entries.filter((entry) => entry.actor === "assistant").length, 2);
  assert.equal(trace.entries.filter((entry) => entry.name === "lookup_order").length, 2);
});

test("local runtime preserves repeated instrumented events", async () => {
  const runtime = createLocalRuntime();
  const { runId } = await runtime.startRun({ scene: scene("repeated-events") });
  const repeatedTelemetry = { name: "order.lookup.started", data: { orderId: "ORD-1" } };

  await runtime.advanceRun({
    runId,
    snapshot: snapshot({
      transcript: [{ id: "1", role: "assistant", text: "Checking now." }],
      metadata: {
        toolCalls: [{
          id: "lookup-order-attempt-1",
          name: "lookup_order",
          args: { id: "ORD-1" },
          result: { found: true },
        }],
        applicationTelemetry: [repeatedTelemetry],
      },
    }),
  });
  await runtime.advanceRun({
    runId,
    snapshot: snapshot({
      transcript: [{ id: "1", role: "assistant", text: "Checking now." }],
      metadata: {
        toolCalls: [{
          id: "lookup-order-attempt-2",
          name: "lookup_order",
          args: { id: "ORD-1" },
          result: { found: true },
        }],
        applicationTelemetry: [repeatedTelemetry],
      },
    }),
  });

  const trace = await runtime.getTrace({ runId });
  assert.equal(trace.entries.filter((entry) => entry.name === "lookup_order").length, 2);
  assert.equal(trace.entries.filter((entry) => entry.name === "order.lookup.started").length, 2);
});

test("local runtime preserves tool calls observed before an assistant message", async () => {
  const runtime = createLocalRuntime();
  const { runId } = await runtime.startRun({
    scene: scene("startup-tool-call", { required_tools: ["lookup_order"] }),
  });

  await runtime.advanceRun({
    runId,
    snapshot: snapshot({
      metadata: {
        toolCalls: [{ name: "lookup_order", args: { id: "ORD-1" }, result: { found: true } }],
      },
    }),
  });

  const trace = await runtime.getTrace({ runId });
  assert.equal(trace.entries.filter((entry) => entry.name === "lookup_order").length, 1);
  assert.equal((await runtime.evaluateRun({ runId })).passed, true);
});

test("recordings preserve an append-only evidence bundle", async (t) => {
  const outputDir = mkdtempSync(join(tmpdir(), "mimiq-evidence-"));
  t.after(() => rmSync(outputDir, { recursive: true, force: true }));

  const runtime = createLocalRuntime({
    recording: {
      enabled: true,
      outputDir,
      screenshots: { enabled: true, timing: "both", format: "png" },
    },
  });
  const { runId } = await runtime.startRun({ scene: scene("evidence") });
  const advance = await runtime.advanceRun({ runId, snapshot: snapshot() });
  assert.equal(advance.action.kind, "message");

  await runtime.recordActionResult({
    runId,
    action: advance.action,
    succeeded: true,
    screenshotBuffer: Buffer.from("after-action"),
  });
  await runtime.advanceRun({
    runId,
    snapshot: snapshot({
      transcript: [{ id: "agent-1", role: "assistant", text: "TERMINAL_STATE: complete" }],
      metadata: { toolCalls: [{ name: "lookup_order", args: { id: "ORD-1" } }] },
    }),
  });
  await runtime.evaluateRun({ runId });

  const sceneDir = join(outputDir, "evidence");
  const runDir = join(sceneDir, readdirSync(sceneDir)[0]);
  const manifest = JSON.parse(readFileSync(join(runDir, "manifest.json"), "utf8"));
  const events = readFileSync(join(runDir, "events.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const transcript = JSON.parse(readFileSync(join(runDir, "transcript.json"), "utf8"));

  assert.deepEqual(events.map((event) => event.sequence), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(events.map((event) => event.type), [
    "run.started",
    "observation.captured",
    "simulator.action_chosen",
    "browser.action_executed",
    "observation.captured",
    "agent.message",
    "agent.tool_called",
    "run.finished",
  ]);
  assert.equal(events[3].payload.observationSequence, 2);
  assert.equal(events[3].payload.decisionSequence, 3);
  assert.match(events[3].payload.screenshot, /^screenshots\/action-4-after\.png$/);
  assert.deepEqual(
    readFileSync(join(runDir, events[3].payload.screenshot)),
    Buffer.from("after-action"),
  );
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.status, "completed");
  assert.deepEqual(transcript.turns.at(-1).toolCalls, [{ tool: "lookup_order", args: { id: "ORD-1" } }]);
});

test("failed browser actions finalize failed evidence bundles", async (t) => {
  const outputDir = mkdtempSync(join(tmpdir(), "mimiq-failed-evidence-"));
  t.after(() => rmSync(outputDir, { recursive: true, force: true }));

  const runtime = createLocalRuntime({
    recording: {
      enabled: true,
      outputDir,
      screenshots: { enabled: false, timing: "before", format: "png" },
    },
  });
  const { runId } = await runtime.startRun({ scene: scene("failed-evidence") });
  const advance = await runtime.advanceRun({ runId, snapshot: snapshot() });

  await runtime.recordActionResult({
    runId,
    action: advance.action,
    succeeded: false,
    error: "The control was not found.",
  });

  const sceneDir = join(outputDir, "failed-evidence");
  const runDir = join(sceneDir, readdirSync(sceneDir)[0]);
  const manifest = JSON.parse(readFileSync(join(runDir, "manifest.json"), "utf8"));
  const transcript = JSON.parse(readFileSync(join(runDir, "transcript.json"), "utf8"));
  const events = readFileSync(join(runDir, "events.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

  assert.equal(manifest.status, "failed");
  assert.equal(transcript.terminalState, "action_failed");
  assert.equal(events.at(-1).type, "run.finished");
  assert.equal(events.at(-1).payload.status, "failed");
  await assert.rejects(
    runtime.advanceRun({ runId, snapshot: snapshot() }),
    /ended after a browser action failed/,
  );
});

test("runtime preserves named application telemetry without treating it as a tool call", async (t) => {
  const outputDir = mkdtempSync(join(tmpdir(), "mimiq-telemetry-"));
  t.after(() => rmSync(outputDir, { recursive: true, force: true }));

  const runtime = createLocalRuntime({
    recording: {
      enabled: true,
      outputDir,
      screenshots: { enabled: false, timing: "before", format: "png" },
    },
  });
  const { runId } = await runtime.startRun({ scene: scene("telemetry") });
  await runtime.advanceRun({
    runId,
    snapshot: snapshot({
      metadata: {
        applicationTelemetry: [{
          name: "refund.previewed",
          data: { orderId: "ORD-1", amount: 17.5 },
          timestamp: "2026-08-30T00:00:00.000Z",
        }],
      },
    }),
  });

  const trace = await runtime.getTrace({ runId });
  const telemetryEntry = trace.entries.find((entry) => entry.name === "refund.previewed");
  assert.ok(telemetryEntry);
  assert.deepEqual({
    actor: "system",
    kind: "state",
    name: "refund.previewed",
    metadata: {
      data: { orderId: "ORD-1", amount: 17.5 },
      sourceTimestamp: "2026-08-30T00:00:00.000Z",
    },
    timestamp: "2026-08-30T00:00:00.000Z",
  }, {
    actor: telemetryEntry.actor,
    kind: telemetryEntry.kind,
    name: telemetryEntry.name,
    metadata: telemetryEntry.metadata,
    timestamp: telemetryEntry.timestamp,
  });

  await runtime.evaluateRun({ runId });
  const sceneDir = join(outputDir, "telemetry");
  const runDir = join(sceneDir, readdirSync(sceneDir)[0]);
  const events = readFileSync(join(runDir, "events.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(events.find((event) => event.type === "application.telemetry").payload, {
    name: "refund.previewed",
    data: { orderId: "ORD-1", amount: 17.5 },
    sourceTimestamp: "2026-08-30T00:00:00.000Z",
    observationSequence: 2,
  });
});

test("runtime rejects malformed tool-call metadata", async () => {
  const runtime = createLocalRuntime();
  const { runId } = await runtime.startRun({ scene: scene("invalid-tool-calls") });

  await assert.rejects(
    runtime.advanceRun({
      runId,
      snapshot: snapshot({
        metadata: { toolCalls: { name: "lookup_order", args: {} } },
      }),
    }),
    /toolCalls must be an array of tool calls with name and object args/,
  );
});

test("runtime rejects malformed application telemetry", async () => {
  const runtime = createLocalRuntime();
  const { runId } = await runtime.startRun({ scene: scene("invalid-telemetry") });

  await assert.rejects(
    runtime.advanceRun({
      runId,
      snapshot: snapshot({
        metadata: { applicationTelemetry: [{ data: { missing: "name" } }] },
      }),
    }),
    /applicationTelemetry must be an array of named events with JSON data/,
  );

  await assert.rejects(
    runtime.advanceRun({
      runId,
      snapshot: snapshot({
        metadata: { applicationTelemetry: [{ name: "invalid.number", data: Number.NaN }] },
      }),
    }),
    /applicationTelemetry must be an array of named events with JSON data/,
  );
});

test("reports are scoped to the requested run and runtime", async () => {
  const runtimeA = createLocalRuntime();
  const runtimeB = createLocalRuntime();
  const runA = await runtimeA.startRun({ scene: scene("report-a") });
  const runB = await runtimeB.startRun({ scene: scene("report-b") });

  await runtimeA.evaluateRun(runA);
  await runtimeB.evaluateRun(runB);

  const reportA = await runtimeA.getReport(runA);
  assert.match(reportA, /report-a/);
  assert.doesNotMatch(reportA, /report-b/);
});

test("visual and accessibility expectations run against the captured URL", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    JSON.stringify({ passed: true, answer: "YES", confidence: 1 }),
    { headers: { "Content-Type": "application/json" } },
  );
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const runtime = createLocalRuntime({
    layoutLensConfig: { httpEndpoint: "http://layoutlens.test" },
  });
  const run = await runtime.startRun({
    scene: scene("visual", {
      visual_assertions: [{ query: "The page is usable." }],
      accessibility_audit: { level: "AA" },
    }),
  });

  await runtime.advanceRun({ runId: run.runId, snapshot: snapshot() });
  const report = await runtime.evaluateRun(run);

  assert.equal(report.passed, true);
  assert.deepEqual(report.checks.map((check) => check.name), [
    "visual:The page is usable....",
    "accessibility:AA",
  ]);
});

test("configured visual checks fail clearly without LayoutLens", async () => {
  const runtime = createLocalRuntime();
  const run = await runtime.startRun({
    scene: scene("unconfigured-visual", {
      visual_assertions: [{ query: "The page is usable." }],
    }),
  });

  const report = await runtime.evaluateRun(run);
  assert.equal(report.passed, false);
  assert.deepEqual(report.checks, [{
    name: "visual",
    passed: false,
    details: "Visual assertions require layoutLensConfig.",
  }]);
});

test("visual assertions require an affirmative LayoutLens verdict", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    JSON.stringify({ answer: "NO", confidence: 1 }),
    { headers: { "Content-Type": "application/json" } },
  );
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await runVisualAssertions(
    "http://example.test/",
    [{ query: "The page is usable." }],
    { httpEndpoint: "http://layoutlens.test" },
  );

  assert.equal(result.passed, false);
  assert.equal(result.results[0].passed, false);
});

test("invalid personas and unsupported simulator types fail at setup", async () => {
  const runtime = createLocalRuntime();
  await assert.rejects(
    runtime.startRun({ scene: { ...scene("bad-persona"), persona: "curious" } }),
    /Unknown persona preset "curious"/,
  );

  assert.throws(
    () => createSimulator({ ...scene("bad-simulator"), simulator: { type: "unsupported-policy" } }),
    /simulator.type must be "llm" or "browser-use"/,
  );

  await assert.rejects(
    runtime.startRun({
      scene: scene("bad-accessibility", {
        accessibility_audit: { level: "AA", required_pass: "false" },
      }),
    }),
    /accessibility_audit.required_pass must be a boolean/,
  );
});

test("scene validation rejects invalid bounds and expectation shapes", async () => {
  const runtime = createLocalRuntime();
  await assert.rejects(
    runtime.startRun({
      scene: {
        ...scene("invalid-bounds"),
        max_turns: 0,
        expectations: {
          required_tools: "lookup_order",
          visual_assertions: [{ query: "The page is usable.", min_confidence: 2 }],
        },
      },
    }),
    /max_turns must be a positive integer[\s\S]*expectations.required_tools must be an array of strings[\s\S]*min_confidence must be between 0 and 1/,
  );
});

test("browser-use scenes select observed browser actions without an external bridge", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    JSON.stringify({
      choices: [{ index: 0, message: { role: "assistant", content: '{"kind":"click","targetId":"mimiq-button-1"}' }, finish_reason: "stop" }],
    }),
    { headers: { "Content-Type": "application/json" } },
  );
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const simulator = createSimulator({
    ...scene("browser-use"),
    max_turns: 2,
    simulator: { type: "browser-use", model: "qwen3:8b" },
  }, {
    defaultSimulatorConfig: { baseURL: "http://127.0.0.1:11434/v1" },
  });
  assert.equal(simulator.constructor.name, "BrowserUseSimulator");
  assert.deepEqual(await simulator.nextTurn(snapshot()), { kind: "message", text: "Hello" });
  assert.deepEqual(
    await simulator.nextTurn(snapshot({
      availableActions: [{ id: "mimiq-button-1", kind: "click", label: "Continue", enabled: true }],
    })),
    { kind: "click", targetId: "mimiq-button-1" },
  );
});
