/**
 * Local runtime for browser tasks.
 * No external server required - simulation and evaluation happen in Node.js.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { parse as parseYaml } from "yaml";
import nunjucks from "nunjucks";

import {
  check,
  Judge,
  resolvePersona,
  validateScene,
  createSimulator,
  type CheckResult,
  type Scene,
  type Trace,
  type Turn,
  type SimulatorInterface,
} from "../core";
import type { SimulatorConfig as LlmSimulatorConfig } from "../core/simulator";
import {
  runVisualAssertions,
  accessibilityAudit,
  type LayoutLensConfig,
} from "../eval/layoutlens";
import type {
  AgentToolCall,
  ApplicationTelemetryEvent,
  ActionExecutionResult,
  AdvanceRunRequest,
  AdvanceRunResponse,
  CleanupRunRequest,
  DoneAction,
  EvaluateRunRequest,
  EvaluationReport,
  GenerateReportsResult,
  GetAggregateReportRequest,
  GetReportRequest,
  GetTraceRequest,
  RunTrace,
  StartRunRequest,
  StartRunResponse,
  TraceEntry,
  MimiqRuntimeClient,
  RecordingConfig,
  JsonObject,
  BrowserSimAction,
} from "../types";
import {
  RecordingCollector,
  DEFAULT_RECORDING_CONFIG,
} from "./recordingCollector";

interface ActiveRun {
  runId: string;
  scene: Scene;
  simulator: SimulatorInterface;
  trace: Trace;
  turnCount: number;
  recorder?: RecordingCollector;
  recordedAssistantTurnKeys: Set<string>;
  recordedToolCallKeys: Set<string>;
  applicationTelemetry: ApplicationTelemetryEvent[];
  pendingAction?: {
    action: BrowserSimAction;
    observationSequence?: number;
    decisionSequence?: number;
  };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function findTemplatesDir(): string {
  const candidates = [
    join(__dirname, "templates"),
    join(__dirname, "..", "templates"),
    join(__dirname, "..", "..", "templates"),
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, "index.html"))) {
      return dir;
    }
  }
  return candidates[0];
}

const templatesDir = findTemplatesDir();
const nunjucksEnv = nunjucks.configure(templatesDir, { autoescape: true });

function generateRunId(): string {
  return Math.random().toString(36).substring(2, 15);
}

function loadSceneFromFile(path: string): Scene {
  const content = readFileSync(path, "utf-8");
  const data = parseYaml(content);
  validateScene(data);
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

function isToolCallList(value: unknown): value is AgentToolCall[] {
  return Array.isArray(value) && value.every((toolCall) => (
    typeof toolCall === "object" &&
    toolCall !== null &&
    (toolCall.id === undefined || typeof toolCall.id === "string") &&
    typeof toolCall.name === "string" &&
    typeof toolCall.args === "object" &&
    toolCall.args !== null &&
    !Array.isArray(toolCall.args)
  ));
}

function isJsonValue(value: unknown): boolean {
  if (value === null || ["string", "boolean"].includes(typeof value)) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value === "object") return Object.values(value).every(isJsonValue);
  return false;
}

function isApplicationTelemetryList(value: unknown): value is ApplicationTelemetryEvent[] {
  return Array.isArray(value) && value.every((event) => (
    typeof event === "object"
    && event !== null
    && !Array.isArray(event)
    && typeof event.name === "string"
    && event.name.length > 0
    && (event.data === undefined || isJsonValue(event.data))
    && (event.timestamp === undefined || typeof event.timestamp === "string")
  ));
}

export interface LocalRuntimeOptions {
  simulatorConfig?: LlmSimulatorConfig;
  scenesDir?: string;
  tracesDir?: string;
  layoutLensConfig?: LayoutLensConfig;
  recording?: Partial<RecordingConfig>;
}

export function createLocalRuntime(options: LocalRuntimeOptions = {}): MimiqRuntimeClient {
  const tracesDir = options.tracesDir || join(tmpdir(), "mimiq-traces");
  const activeRuns = new Map<string, ActiveRun>();
  const completedRuns = new Map<string, {
    scene: Scene;
    trace: Trace;
    applicationTelemetry: ApplicationTelemetryEvent[];
    evaluation?: EvaluationReport;
  }>();

  if (!existsSync(tracesDir)) {
    mkdirSync(tracesDir, { recursive: true });
  }

  return {
    async startRun(input: StartRunRequest): Promise<StartRunResponse> {
      let scene: Scene;

      if (input.scene) {
        scene = structuredClone(input.scene) as unknown as Scene;
        validateScene(scene);
        scene.persona = resolvePersona(scene.persona);
      } else if (input.scenePath) {
        scene = loadSceneFromFile(input.scenePath);
      } else if (input.sceneId) {
        scene = loadSceneById(input.sceneId, options.scenesDir);
      } else {
        throw new Error("Must provide scene, scenePath, or sceneId");
      }

      const runId = generateRunId();
      const simulator = createSimulator(scene, {
        defaultSimulatorConfig: options.simulatorConfig,
      });

      const trace: Trace = {
        scene_id: scene.id,
        turns: [],
        started_at: new Date().toISOString(),
      };

      const recordingConfig = {
        ...DEFAULT_RECORDING_CONFIG,
        ...options.recording,
      };

      let recorder: RecordingCollector | undefined;
      if (recordingConfig.enabled) {
        recorder = new RecordingCollector(scene.id, runId, recordingConfig);
      }

      activeRuns.set(runId, {
        runId,
        scene,
        simulator,
        trace,
        turnCount: 0,
        recorder,
        recordedAssistantTurnKeys: new Set(),
        recordedToolCallKeys: new Set(),
        applicationTelemetry: [],
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
      let screenshotPath: string | undefined;

      if (snapshot.url) {
        run.trace.metadata = { ...run.trace.metadata, url: snapshot.url };
      }

      if (input.screenshotBuffer && run.recorder) {
        const buffer = typeof input.screenshotBuffer === "string"
          ? Buffer.from(input.screenshotBuffer, "base64")
          : input.screenshotBuffer;
        screenshotPath = await run.recorder.saveScreenshot(
          buffer,
          "before",
          `observation-${run.recorder.getNextEventSequence()}`,
        );
      }

      const observation = run.recorder?.recordEvent("observation.captured", {
        snapshot: snapshot as unknown as JsonObject,
        ...(screenshotPath ? { screenshot: screenshotPath } : {}),
      });

      for (const [index, assistantTurn] of snapshot.transcript.entries()) {
        if (assistantTurn.role !== "assistant") continue;

        const turnKey = `${index}:${assistantTurn.id ?? ""}`;
        if (!run.recordedAssistantTurnKeys.has(turnKey)) {
          run.recordedAssistantTurnKeys.add(turnKey);
          const turn: Turn = {
            role: "agent",
            content: assistantTurn.text,
            tool_calls: [],
            timestamp: new Date().toISOString(),
          };
          run.trace.turns.push(turn);

          const entry: TraceEntry = {
            id: Math.random().toString(36).substring(2, 10),
            actor: "assistant",
            kind: "message",
            text: assistantTurn.text,
            timestamp: new Date().toISOString(),
          };
          traceDelta.push(entry);

          run.recorder?.recordEvent("agent.message", {
            text: assistantTurn.text,
            ...(assistantTurn.id ? { messageId: assistantTurn.id } : {}),
          });

          run.recorder?.recordTurn("agent", "message", {
            content: assistantTurn.text,
            uiState: {
              url: snapshot.url,
              agentStatus: snapshot.stateMarkers?.includes("working") ? "working" : "idle",
              visibleMessages: snapshot.transcript.length,
            },
          });

          const terminalState = detectTerminalState(assistantTurn.text);
          if (terminalState) {
            run.trace.terminal_state = terminalState;
            run.recorder?.setTerminalState(terminalState);
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

      if (snapshot.metadata?.toolCalls !== undefined) {
        const toolCalls = snapshot.metadata.toolCalls;
        if (!isToolCallList(toolCalls)) {
          throw new Error("snapshot.metadata.toolCalls must be an array of tool calls with name and object args.");
        }
        const lastAgentTurn = run.trace.turns.findLast((t: Turn) => t.role === "agent");
        for (const [index, tc] of toolCalls.entries()) {
          const toolCallKey = tc.id
            ? `id:${tc.id}`
            : `${index}:${tc.name}:${JSON.stringify(tc.args)}:${JSON.stringify(tc.result)}`;
          if (!run.recordedToolCallKeys.has(toolCallKey) && lastAgentTurn) {
            run.recordedToolCallKeys.add(toolCallKey);
            lastAgentTurn.tool_calls.push({
              tool_name: tc.name,
              arguments: tc.args,
              result: tc.result,
            });
            traceDelta.push({
              id: Math.random().toString(36).substring(2, 10),
              actor: "assistant_tool",
              kind: "tool",
              name: tc.name,
              args: tc.args,
              result: tc.result,
              timestamp: new Date().toISOString(),
            });
            run.recorder?.appendToolCalls([{
              tool: tc.name,
              args: tc.args,
              ...(tc.result === undefined ? {} : { result: tc.result }),
            }]);
            run.recorder?.recordEvent("agent.tool_called", {
              name: tc.name,
              args: tc.args,
              ...(tc.result === undefined ? {} : { result: tc.result }),
            });
          }
        }
      }

      if (snapshot.metadata?.applicationTelemetry !== undefined) {
        const applicationTelemetry = snapshot.metadata.applicationTelemetry;
        if (!isApplicationTelemetryList(applicationTelemetry)) {
          throw new Error(
            "snapshot.metadata.applicationTelemetry must be an array of named events with JSON data.",
          );
        }
        for (const event of applicationTelemetry) {
          run.applicationTelemetry.push(event);
          traceDelta.push({
            id: Math.random().toString(36).substring(2, 10),
            actor: "system",
            kind: "state",
            name: event.name,
            metadata: {
              ...(event.data === undefined ? {} : { data: event.data }),
              ...(event.timestamp === undefined ? {} : { sourceTimestamp: event.timestamp }),
            },
            timestamp: new Date().toISOString(),
          });
          run.recorder?.recordEvent("application.telemetry", {
            name: event.name,
            ...(event.data === undefined ? {} : { data: event.data }),
            ...(event.timestamp === undefined ? {} : { sourceTimestamp: event.timestamp }),
            ...(observation ? { observationSequence: observation.sequence } : {}),
          });
        }
      }

      if (run.trace.terminal_state) {
        const action: DoneAction = { kind: "done", reason: `Terminal state: ${run.trace.terminal_state}` };
        return { runId: input.runId, action, turn: run.turnCount, traceDelta };
      }

      if (run.turnCount >= run.simulator.getMaxTurns()) {
        const action: DoneAction = { kind: "done", reason: "Max turns reached" };
        return { runId: input.runId, action, turn: run.turnCount, traceDelta };
      }

      const result = await run.simulator.nextTurn(snapshot);

      if (result === null || result.kind === "done") {
        const reason = result?.kind === "done" ? result.reason : "Simulator finished";
        const action: DoneAction = { kind: "done", reason };
        return { runId: input.runId, action, turn: run.turnCount, traceDelta };
      }

      run.turnCount++;

      if (result.kind === "message") {
        run.trace.turns.push({
          role: "user",
          content: result.text,
          tool_calls: [],
          timestamp: new Date().toISOString(),
        });

        traceDelta.push({
          id: Math.random().toString(36).substring(2, 10),
          actor: "user",
          kind: "message",
          text: result.text,
          timestamp: new Date().toISOString(),
        });

        run.recorder?.recordTurn("customer", "message", {
          content: result.text,
          uiState: {
            url: snapshot.url,
            agentStatus: snapshot.stateMarkers?.includes("working") ? "working" : "idle",
            visibleMessages: snapshot.transcript.length,
          },
        });
      } else {
        traceDelta.push({
          id: Math.random().toString(36).substring(2, 10),
          actor: "user",
          kind: "action",
          name: result.kind,
          args: result as unknown as TraceEntry["args"],
          timestamp: new Date().toISOString(),
        });

        const actionType = result.kind as "click" | "type" | "select" | "navigate";
        run.recorder?.recordTurn("customer", actionType, {
          target: "targetId" in result ? result.targetId : undefined,
          content: "text" in result ? result.text : undefined,
          uiState: {
            url: snapshot.url,
            agentStatus: snapshot.stateMarkers?.includes("working") ? "working" : "idle",
            visibleMessages: snapshot.transcript.length,
          },
        });
      }

      const decision = run.recorder?.recordEvent("simulator.action_chosen", {
        action: result as unknown as JsonObject,
        ...(observation ? { observationSequence: observation.sequence } : {}),
      });
      run.pendingAction = {
        action: result,
        observationSequence: observation?.sequence,
        decisionSequence: decision?.sequence,
      };

      return { runId: input.runId, action: result, turn: run.turnCount, traceDelta };
    },

    async recordActionResult(input: ActionExecutionResult): Promise<void> {
      const run = activeRuns.get(input.runId);
      if (!run) {
        throw new Error(`Run not found: ${input.runId}`);
      }
      if (!run.pendingAction) {
        throw new Error(`No pending browser action for run: ${input.runId}`);
      }
      if (JSON.stringify(run.pendingAction.action) !== JSON.stringify(input.action)) {
        throw new Error(`Action result does not match the pending action for run: ${input.runId}`);
      }

      let screenshotPath: string | undefined;
      if (input.screenshotBuffer && run.recorder) {
        const buffer = typeof input.screenshotBuffer === "string"
          ? Buffer.from(input.screenshotBuffer, "base64")
          : input.screenshotBuffer;
        screenshotPath = await run.recorder.saveScreenshot(
          buffer,
          "after",
          `action-${run.recorder.getNextEventSequence()}`,
        );
      }

      run.recorder?.recordEvent("browser.action_executed", {
        action: input.action as unknown as JsonObject,
        succeeded: input.succeeded,
        ...(input.error ? { error: input.error } : {}),
        ...(input.metadata ? { metadata: input.metadata } : {}),
        ...(screenshotPath ? { screenshot: screenshotPath } : {}),
        ...(run.pendingAction.observationSequence
          ? { observationSequence: run.pendingAction.observationSequence }
          : {}),
        ...(run.pendingAction.decisionSequence
          ? { decisionSequence: run.pendingAction.decisionSequence }
          : {}),
      });
      run.pendingAction = undefined;
    },

    async evaluateRun(input: EvaluateRunRequest): Promise<EvaluationReport> {
      const run = activeRuns.get(input.runId);
      if (!run) {
        throw new Error(`Run not found: ${input.runId}`);
      }

      run.trace.finished_at = new Date().toISOString();

      const expectations = run.scene.expectations ?? {};
      const checkResult: CheckResult = check(run.trace, expectations);

      const checks: EvaluationReport["checks"] = checkResult.checks.map((c) => ({
        name: c.label,
        passed: c.passed,
        details: c.detail,
      }));

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

      if (expectations.visual_assertions?.length && !options.layoutLensConfig) {
        checks.push({
          name: "visual",
          passed: false,
          details: "Visual assertions require layoutLensConfig.",
        });
      } else if (expectations.visual_assertions?.length && options.layoutLensConfig) {
        const url = run.trace.metadata?.url as string | undefined;
        if (url) {
          const assertions = expectations.visual_assertions.map((a) => ({
            query: a.query,
            minConfidence: a.min_confidence,
          }));
          const visualResult = await runVisualAssertions(
            url,
            assertions,
            options.layoutLensConfig
          );
          for (const result of visualResult.results) {
            checks.push({
              name: `visual:${result.query.slice(0, 30)}...`,
              passed: result.passed,
              details: result.result.error
                ? `Error: ${result.result.error}`
                : `Confidence: ${(result.result.confidence * 100).toFixed(0)}%`,
            });
          }
        } else {
          checks.push({
            name: "visual",
            passed: false,
            details: "Visual assertions require a snapshot URL.",
          });
        }
      }

      if (expectations.accessibility_audit && !options.layoutLensConfig) {
        checks.push({
          name: "accessibility",
          passed: false,
          details: "Accessibility audits require layoutLensConfig.",
        });
      } else if (expectations.accessibility_audit && options.layoutLensConfig) {
        const url = run.trace.metadata?.url as string | undefined;
        if (url) {
          const auditResult = await accessibilityAudit(
            url,
            { level: expectations.accessibility_audit.level },
            options.layoutLensConfig
          );
          const requiredPass = expectations.accessibility_audit.required_pass ?? true;
          checks.push({
            name: `accessibility:${expectations.accessibility_audit.level || "AA"}`,
            passed: requiredPass ? auditResult.passed : true,
            details: auditResult.error || auditResult.answer,
          });
        } else {
          checks.push({
            name: "accessibility",
            passed: false,
            details: "Accessibility audits require a snapshot URL.",
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

      completedRuns.set(run.runId, {
        scene: run.scene,
        trace: run.trace,
        applicationTelemetry: run.applicationTelemetry,
        evaluation,
      });

      if (run.recorder) {
        if (passed) {
          run.recorder.finalize();
        } else {
          run.recorder.markFailed();
        }
      }

      if (run.simulator.cleanup) {
        await run.simulator.cleanup();
      }

      return evaluation;
    },

    async getTrace(input: GetTraceRequest): Promise<RunTrace> {
      const run = activeRuns.get(input.runId) ?? completedRuns.get(input.runId);
      if (!run) {
        throw new Error(`Run not found: ${input.runId}`);
      }

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
      for (const event of run.applicationTelemetry) {
        entries.push({
          id: Math.random().toString(36).substring(2, 10),
          actor: "system",
          kind: "state",
          name: event.name,
          metadata: {
            ...(event.data === undefined ? {} : { data: event.data }),
            ...(event.timestamp === undefined ? {} : { sourceTimestamp: event.timestamp }),
          },
          timestamp: event.timestamp ?? run.trace.started_at,
        });
      }

      return {
        runId: input.runId,
        terminalState: run.trace.terminal_state,
        entries,
      };
    },

    async cleanupRun(input: CleanupRunRequest): Promise<void> {
      const run = activeRuns.get(input.runId);
      if (run?.simulator.cleanup) {
        await run.simulator.cleanup();
      }
      activeRuns.delete(input.runId);
    },

    async getReport(input: GetReportRequest): Promise<string> {
      const run = completedRuns.get(input.runId);
      if (!run) {
        throw new Error(`Completed run not found: ${input.runId}`);
      }
      return generateHtmlReport(run.scene, run.trace, run.evaluation);
    },

    async getAggregateReport(_input: GetAggregateReportRequest): Promise<string> {
      const runs = Array.from(completedRuns.values());
      return generateAggregateReport(runs);
    },

    async generateAllReports(): Promise<GenerateReportsResult> {
      const runs = Array.from(completedRuns.values());
      const indexHtml = generateAggregateReport(runs);
      const runReports = runs.map((run) => ({
        sceneId: run.scene.id,
        html: generateHtmlReport(run.scene, run.trace, run.evaluation),
      }));
      return { indexHtml, runReports };
    },
  };
}

function generateHtmlReport(
  scene: Scene,
  trace: Trace,
  evaluation?: EvaluationReport,
): string {
  return nunjucksEnv.render("run_detail.html", {
    scene,
    trace,
    evaluation: evaluation ?? { passed: false, checks: [], summary: "No evaluation" },
  });
}

function generateAggregateReport(
  runs: Array<{ scene: Scene; trace: Trace; evaluation?: EvaluationReport }>,
): string {
  const total = runs.length;
  const passed = runs.filter((r) => r.evaluation?.passed).length;
  const failed = total - passed;
  const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;

  return nunjucksEnv.render("index.html", {
    runs,
    total,
    passed,
    failed,
    pass_rate: passRate,
  });
}
