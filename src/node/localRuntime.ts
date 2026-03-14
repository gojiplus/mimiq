/**
 * Local runtime for Cypress tasks.
 * No external server required - simulation and evaluation happen in Node.js.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { parse as parseYaml } from "yaml";

import {
  check,
  checkResultSummary,
  Judge,
  resolvePersona,
  Simulator,
  type CheckResult,
  type JudgeConfig as JudgeExpectation,
  type Scene,
  type Trace,
  type Turn,
} from "../core";
import type {
  AdvanceRunRequest,
  AdvanceRunResponse,
  BrowserSimAction,
  CleanupRunRequest,
  DoneAction,
  EvaluateRunRequest,
  EvaluationReport,
  GetAggregateReportRequest,
  GetReportRequest,
  GetTraceRequest,
  RunTrace,
  StartRunRequest,
  StartRunResponse,
  TraceEntry,
  MimiqRuntimeClient,
} from "../types";

interface ActiveRun {
  runId: string;
  scene: Scene;
  simulator: Simulator;
  trace: Trace;
  turnCount: number;
}

const activeRuns = new Map<string, ActiveRun>();
const completedRuns = new Map<string, { scene: Scene; trace: Trace; evaluation?: EvaluationReport }>();

function generateRunId(): string {
  return Math.random().toString(36).substring(2, 15);
}

function loadSceneFromFile(path: string): Scene {
  const content = readFileSync(path, "utf-8");
  const data = parseYaml(content) as Scene;
  // Resolve persona preset to full persona object
  data.persona = resolvePersona(data.persona);
  return data;
}

function loadSceneById(sceneId: string, scenesDir?: string): Scene {
  const dirs = [
    scenesDir,
    process.env.UNDERSTUDY_SCENES_DIR,
    join(process.cwd(), "scenes"),
    join(process.cwd(), "examples", "scenes"),
  ].filter(Boolean) as string[];

  for (const dir of dirs) {
    const path = join(dir, `${sceneId}.yaml`);
    if (existsSync(path)) {
      return loadSceneFromFile(path);
    }
  }

  throw new Error(`Scene not found: ${sceneId}. Searched in: ${dirs.join(", ")}`);
}

function detectTerminalState(text: string): string | undefined {
  const match = text.match(/TERMINAL_STATE:\s*(\S+)/);
  return match?.[1];
}

function traceEntryToTurn(entry: TraceEntry): Turn | null {
  if (entry.kind !== "message") return null;
  return {
    role: entry.actor === "user" ? "user" : "agent",
    content: entry.text ?? "",
    tool_calls: [],
  };
}

export interface LocalRuntimeOptions {
  simulatorConfig?: {
    apiKey?: string;
    model?: string;
    baseUrl?: string;
  };
  scenesDir?: string;
  tracesDir?: string;
}

export function createLocalRuntime(options: LocalRuntimeOptions = {}): MimiqRuntimeClient {
  const tracesDir = options.tracesDir || join(tmpdir(), "mimiq-traces");

  if (!existsSync(tracesDir)) {
    mkdirSync(tracesDir, { recursive: true });
  }

  return {
    async startRun(input: StartRunRequest): Promise<StartRunResponse> {
      let scene: Scene;

      if (input.scene) {
        scene = input.scene as unknown as Scene;
        scene.persona = resolvePersona(scene.persona);
      } else if (input.scenePath) {
        scene = loadSceneFromFile(input.scenePath);
      } else if (input.sceneId) {
        scene = loadSceneById(input.sceneId, options.scenesDir);
      } else {
        throw new Error("Must provide scene, scenePath, or sceneId");
      }

      const runId = generateRunId();
      const simulator = new Simulator(scene, options.simulatorConfig);

      const trace: Trace = {
        scene_id: scene.id,
        turns: [],
        started_at: new Date().toISOString(),
      };

      activeRuns.set(runId, {
        runId,
        scene,
        simulator,
        trace,
        turnCount: 0,
      });

      return { runId };
    },

    async advanceRun(input: AdvanceRunRequest): Promise<AdvanceRunResponse> {
      const run = activeRuns.get(input.runId);
      if (!run) {
        throw new Error(`Run not found: ${input.runId}`);
      }

      const snapshot = input.snapshot;
      const traceDelta: TraceEntry[] = [];

      // Record assistant messages from transcript
      const lastAssistantTurn = [...snapshot.transcript]
        .reverse()
        .find((t) => t.role === "assistant");

      if (lastAssistantTurn) {
        const alreadyRecorded = run.trace.turns.some(
          (t) => t.role === "agent" && t.content === lastAssistantTurn.text,
        );

        if (!alreadyRecorded) {
          const turn: Turn = {
            role: "agent",
            content: lastAssistantTurn.text,
            tool_calls: [],
            timestamp: new Date().toISOString(),
          };
          run.trace.turns.push(turn);

          const entry: TraceEntry = {
            id: Math.random().toString(36).substring(2, 10),
            actor: "assistant",
            kind: "message",
            text: lastAssistantTurn.text,
            timestamp: new Date().toISOString(),
          };
          traceDelta.push(entry);

          const terminalState = detectTerminalState(lastAssistantTurn.text);
          if (terminalState) {
            run.trace.terminal_state = terminalState;
            traceDelta.push({
              id: Math.random().toString(36).substring(2, 10),
              actor: "assistant",
              kind: "terminal_state",
              name: terminalState,
              timestamp: new Date().toISOString(),
            });
          }
        }
      }

      // Record tool calls from metadata
      if (snapshot.metadata?.toolCalls) {
        const toolCalls = snapshot.metadata.toolCalls as Array<{
          name: string;
          args?: Record<string, unknown>;
          result?: unknown;
        }>;
        const lastAgentTurn = run.trace.turns.findLast((t: Turn) => t.role === "agent");
        for (const tc of toolCalls) {
          const alreadyRecorded = run.trace.turns.some((t) =>
            t.tool_calls.some((c) => c.tool_name === tc.name),
          );
          if (!alreadyRecorded && lastAgentTurn) {
            lastAgentTurn.tool_calls.push({
              tool_name: tc.name,
              arguments: tc.args ?? {},
              result: tc.result,
            });
            traceDelta.push({
              id: Math.random().toString(36).substring(2, 10),
              actor: "assistant_tool",
              kind: "tool",
              name: tc.name,
              args: tc.args as TraceEntry["args"],
              result: tc.result as TraceEntry["result"],
              timestamp: new Date().toISOString(),
            });
          }
        }
      }

      // Check termination conditions
      if (run.trace.terminal_state) {
        const action: DoneAction = { kind: "done", reason: `Terminal state: ${run.trace.terminal_state}` };
        return { runId: input.runId, action, turn: run.turnCount, traceDelta };
      }

      if (run.turnCount >= run.simulator.getMaxTurns()) {
        const action: DoneAction = { kind: "done", reason: "Max turns reached" };
        return { runId: input.runId, action, turn: run.turnCount, traceDelta };
      }

      // Build conversation history for simulator
      const history = snapshot.transcript.map((t) => ({
        role: t.role as "user" | "assistant",
        content: t.text,
      }));

      // Get next user turn from simulator
      const userText = await run.simulator.nextTurn(history);

      if (userText === null) {
        const action: DoneAction = { kind: "done", reason: "Simulator finished" };
        return { runId: input.runId, action, turn: run.turnCount, traceDelta };
      }

      run.turnCount++;
      run.trace.turns.push({
        role: "user",
        content: userText,
        tool_calls: [],
        timestamp: new Date().toISOString(),
      });

      traceDelta.push({
        id: Math.random().toString(36).substring(2, 10),
        actor: "user",
        kind: "message",
        text: userText,
        timestamp: new Date().toISOString(),
      });

      const action: BrowserSimAction = { kind: "message", text: userText };
      return { runId: input.runId, action, turn: run.turnCount, traceDelta };
    },

    async evaluateRun(input: EvaluateRunRequest): Promise<EvaluationReport> {
      const run = activeRuns.get(input.runId);
      if (!run) {
        throw new Error(`Run not found: ${input.runId}`);
      }

      run.trace.finished_at = new Date().toISOString();

      // Run deterministic checks
      const expectations = run.scene.expectations ?? {};
      const checkResult: CheckResult = check(run.trace, expectations);

      const checks: EvaluationReport["checks"] = checkResult.checks.map((c) => ({
        name: c.label,
        passed: c.passed,
        details: c.detail,
      }));

      // Run LLM judges if configured
      if (expectations.judges?.length) {
        for (const judgeConfig of expectations.judges) {
          const judge = new Judge(judgeConfig.rubric, {
            samples: judgeConfig.samples,
            model: judgeConfig.model,
          });
          const result = await judge.evaluate(run.trace);
          checks.push({
            name: `judge:${judgeConfig.name}`,
            passed: result.score === 1,
            details: `${result.score === 1 ? "YES" : "NO"} (agreement: ${(result.agreementRate * 100).toFixed(0)}%)`,
          });
        }
      }

      const passed = checks.every((c) => c.passed);
      const passedCount = checks.filter((c) => c.passed).length;

      const evaluation: EvaluationReport = {
        runId: run.runId,
        passed,
        terminalState: run.trace.terminal_state,
        checks,
        summary: `${passedCount}/${checks.length} checks passed`,
      };

      // Save trace
      const traceFile = join(tracesDir, `${run.runId}.json`);
      writeFileSync(
        traceFile,
        JSON.stringify(
          {
            scene: run.scene,
            trace: run.trace,
            evaluation,
          },
          null,
          2,
        ),
      );

      completedRuns.set(run.runId, { scene: run.scene, trace: run.trace, evaluation });

      return evaluation;
    },

    async getTrace(input: GetTraceRequest): Promise<RunTrace> {
      const run = activeRuns.get(input.runId);
      if (!run) {
        throw new Error(`Run not found: ${input.runId}`);
      }

      // Convert internal Trace to RunTrace format
      const entries: TraceEntry[] = [];
      for (const turn of run.trace.turns) {
        entries.push({
          id: Math.random().toString(36).substring(2, 10),
          actor: turn.role === "user" ? "user" : "assistant",
          kind: "message",
          text: turn.content,
          timestamp: turn.timestamp,
        });
        for (const call of turn.tool_calls) {
          entries.push({
            id: Math.random().toString(36).substring(2, 10),
            actor: "assistant_tool",
            kind: "tool",
            name: call.tool_name,
            args: call.arguments as TraceEntry["args"],
            result: call.result as TraceEntry["result"],
          });
        }
      }

      return {
        runId: run.runId,
        terminalState: run.trace.terminal_state,
        entries,
      };
    },

    async cleanupRun(input: CleanupRunRequest): Promise<void> {
      activeRuns.delete(input.runId);
    },

    async getReport(_input: GetReportRequest): Promise<string> {
      // Simple HTML report
      const runs = Array.from(completedRuns.values());
      if (runs.length === 0) {
        return "<html><body><p>No completed runs</p></body></html>";
      }

      const run = runs[runs.length - 1];
      return generateHtmlReport(run.scene, run.trace, run.evaluation);
    },

    async getAggregateReport(_input: GetAggregateReportRequest): Promise<string> {
      const runs = Array.from(completedRuns.values());
      return generateAggregateReport(runs);
    },
  };
}

function generateHtmlReport(
  scene: Scene,
  trace: Trace,
  evaluation?: EvaluationReport,
): string {
  const turnHtml = trace.turns
    .map((t) => {
      const roleClass = t.role === "user" ? "user" : "agent";
      const toolsHtml = t.tool_calls
        .map((c) => `<div class="tool">🔧 ${c.tool_name}(${JSON.stringify(c.arguments)})</div>`)
        .join("");
      return `<div class="turn ${roleClass}"><strong>${t.role}:</strong> ${t.content}${toolsHtml}</div>`;
    })
    .join("\n");

  const checksHtml = evaluation?.checks
    .map((c) => `<div class="check ${c.passed ? "pass" : "fail"}">${c.passed ? "✓" : "✗"} ${c.name}: ${c.details}</div>`)
    .join("\n") ?? "";

  return `<!DOCTYPE html>
<html>
<head>
  <title>Mimiq Report - ${scene.id}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
    .turn { padding: 10px; margin: 5px 0; border-radius: 8px; }
    .user { background: #e3f2fd; }
    .agent { background: #f5f5f5; }
    .tool { font-size: 0.9em; color: #666; margin-left: 20px; }
    .check { padding: 5px; }
    .pass { color: green; }
    .fail { color: red; }
    h1 { color: #333; }
    .summary { padding: 10px; background: ${evaluation?.passed ? "#c8e6c9" : "#ffcdd2"}; border-radius: 8px; }
  </style>
</head>
<body>
  <h1>Scene: ${scene.id}</h1>
  <p>${scene.description ?? ""}</p>

  <h2>Conversation</h2>
  ${turnHtml}

  <h2>Evaluation</h2>
  <div class="summary">${evaluation?.passed ? "PASSED" : "FAILED"} - ${evaluation?.summary}</div>
  ${checksHtml}
</body>
</html>`;
}

function generateAggregateReport(
  runs: Array<{ scene: Scene; trace: Trace; evaluation?: EvaluationReport }>,
): string {
  const total = runs.length;
  const passed = runs.filter((r) => r.evaluation?.passed).length;

  const rowsHtml = runs
    .map((r) => {
      const status = r.evaluation?.passed ? "✓ PASS" : "✗ FAIL";
      const statusClass = r.evaluation?.passed ? "pass" : "fail";
      return `<tr><td>${r.scene.id}</td><td class="${statusClass}">${status}</td><td>${r.evaluation?.summary ?? ""}</td></tr>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html>
<head>
  <title>Understudy Aggregate Report</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
    .pass { color: green; }
    .fail { color: red; }
    .summary { padding: 15px; background: #f5f5f5; border-radius: 8px; margin-bottom: 20px; }
  </style>
</head>
<body>
  <h1>Mimiq Report</h1>
  <div class="summary">
    <strong>Total:</strong> ${total} |
    <strong>Passed:</strong> ${passed} |
    <strong>Failed:</strong> ${total - passed} |
    <strong>Pass Rate:</strong> ${total > 0 ? ((passed / total) * 100).toFixed(0) : 0}%
  </div>

  <table>
    <thead><tr><th>Scene</th><th>Status</th><th>Summary</th></tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>
</body>
</html>`;
}
