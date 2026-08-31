/**
 * Playwright test fixtures for mimiq.
 * Provides the mimiq test helper as a Playwright fixture.
 */

import { test as base, expect, type Page } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";
import type {
  AdvanceRunResponse,
  AffordanceSnapshot,
  EvaluationReport,
  MimiqRuntimeClient,
  RunTrace,
  StartRunRequest,
  RunMultipleOptions,
  RunMultipleResult,
  AggregateSummary,
  BrowserSimAction,
  EvidenceEvent,
  EvidenceReplayResult,
  JsonObject,
  UIActionTarget,
} from "../../types";
import type { PlaywrightBrowserAdapter } from "../types";

export interface MimiqTestHelperOptions {
  maxTurns?: number;
  settleTimeoutMs?: number;
  failOnHealthCheck?: boolean;
}

export class MimiqTestHelper {
  private page: Page;
  private runtime: MimiqRuntimeClient;
  private adapter: PlaywrightBrowserAdapter;
  private options: MimiqTestHelperOptions;
  private runId: string | null = null;
  private turnCount = 0;

  constructor(
    page: Page,
    runtime: MimiqRuntimeClient,
    adapter: PlaywrightBrowserAdapter,
    options: MimiqTestHelperOptions = {},
  ) {
    this.page = page;
    this.runtime = runtime;
    this.adapter = adapter;
    this.options = options;
  }

  async startRun(input: StartRunRequest): Promise<{ runId: string }> {
    const result = await this.runtime.startRun(input);
    this.runId = result.runId;
    this.turnCount = 0;
    return result;
  }

  async captureSnapshot(): Promise<AffordanceSnapshot> {
    return this.adapter.captureSnapshot();
  }

  async runTurn(): Promise<AdvanceRunResponse> {
    if (!this.runId) {
      throw new Error("No active mimiq run. Call startRun() first.");
    }

    if (this.options.failOnHealthCheck && this.adapter.assertHealthy) {
      await this.adapter.assertHealthy();
    }

    const snapshot = await this.adapter.captureSnapshot();
    const screenshotBuffer = this.adapter.captureScreenshot
      ? await this.adapter.captureScreenshot()
      : undefined;
    const advance = await this.runtime.advanceRun({
      runId: this.runId,
      snapshot,
      screenshotBuffer,
    });
    this.turnCount = advance.turn;

    if (advance.action.kind === "done") {
      return advance;
    }

    try {
      await this.adapter.executeAction(advance.action);
      await this.adapter.awaitSettled({ timeoutMs: this.options.settleTimeoutMs });
      const screenshotBuffer = this.adapter.captureScreenshot
        ? await this.adapter.captureScreenshot()
        : undefined;
      await this.runtime.recordActionResult?.({
        runId: this.runId,
        action: advance.action,
        succeeded: true,
        screenshotBuffer,
      });
    } catch (error) {
      await this.runtime.recordActionResult?.({
        runId: this.runId,
        action: advance.action,
        succeeded: false,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    return advance;
  }

  async runToCompletion(options?: { maxTurns?: number }): Promise<void> {
    const maxTurns = options?.maxTurns ?? this.options.maxTurns ?? 12;

    while (this.turnCount <= maxTurns) {
      const advance = await this.runTurn();
      if (advance.action.kind === "done") {
        return;
      }
    }

    throw new Error(`Turn budget exceeded before completion. maxTurns=${maxTurns}`);
  }

  async evaluate(): Promise<EvaluationReport> {
    if (!this.runId) {
      throw new Error("No active mimiq run. Call startRun() first.");
    }
    return this.runtime.evaluateRun({ runId: this.runId });
  }

  async getTrace(): Promise<RunTrace> {
    if (!this.runId) {
      throw new Error("No active mimiq run. Call startRun() first.");
    }
    return this.runtime.getTrace({ runId: this.runId });
  }

  async replayEvidenceBundle(runDir: string): Promise<EvidenceReplayResult> {
    const eventsPath = join(runDir, "events.jsonl");
    const events = readFileSync(eventsPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as EvidenceEvent);
    const observations = new Map<number, AffordanceSnapshot>();
    const replayedActions: BrowserSimAction[] = [];
    const skippedActions: EvidenceReplayResult["skippedActions"] = [];

    for (const event of events) {
      if (event.type === "observation.captured") {
        const snapshot = event.payload.snapshot;
        if (isAffordanceSnapshot(snapshot)) {
          observations.set(event.sequence, snapshot);
        }
        continue;
      }
      if (event.type !== "browser.action_executed") continue;

      const action = parseBrowserAction(event.payload.action);
      if (event.payload.succeeded !== true) {
        skippedActions.push({ action, reason: "The recorded action did not succeed." });
        continue;
      }

      const observationSequence = event.payload.observationSequence;
      const recordedSnapshot = typeof observationSequence === "number"
        ? observations.get(observationSequence)
        : undefined;
      const resolvedAction = await this.resolveReplayAction(action, recordedSnapshot);
      await this.adapter.executeAction(resolvedAction);
      await this.adapter.awaitSettled({ timeoutMs: this.options.settleTimeoutMs });
      replayedActions.push(resolvedAction);
    }

    return { replayedActions, skippedActions };
  }

  private async resolveReplayAction(
    action: BrowserSimAction,
    recordedSnapshot?: AffordanceSnapshot,
  ): Promise<BrowserSimAction> {
    if (!("targetId" in action) || !action.targetId) return action;

    const recordedTarget = recordedSnapshot?.availableActions.find(
      (target) => target.id === action.targetId,
    );
    if (!recordedTarget) {
      throw new Error(`Replay bundle has no recorded target for "${action.targetId}".`);
    }

    const currentSnapshot = await this.adapter.captureSnapshot();
    const currentTarget = findReplayTarget(recordedTarget, currentSnapshot.availableActions);
    if (!currentTarget) {
      throw new Error(`Replay could not resolve recorded target "${action.targetId}" on the current page.`);
    }

    return { ...action, targetId: currentTarget.id } as BrowserSimAction;
  }

  async cleanup(): Promise<void> {
    if (this.runId) {
      await this.runtime.cleanupRun({ runId: this.runId });
      this.runId = null;
      this.turnCount = 0;
    }
  }

  async getReport(): Promise<string> {
    if (!this.runId) {
      throw new Error("No active mimiq run. Call startRun() first.");
    }
    return this.runtime.getReport({ runId: this.runId });
  }

  async getAggregateReport(): Promise<string> {
    return this.runtime.getAggregateReport({});
  }

  getRunId(): string | null {
    return this.runId;
  }

  getTurnCount(): number {
    return this.turnCount;
  }

  async captureScreenshot(): Promise<Buffer | null> {
    if (this.adapter.captureScreenshot) {
      return this.adapter.captureScreenshot();
    }
    return null;
  }

  async runMultiple(options: RunMultipleOptions): Promise<RunMultipleResult> {
    const { count, onRunComplete } = options;
    const runs: EvaluationReport[] = [];
    let sceneId = "";

    for (let i = 0; i < count; i++) {
      const startInput: StartRunRequest = {};
      if (options.sceneId) {
        startInput.sceneId = options.sceneId;
        sceneId = options.sceneId;
      } else if (options.scenePath) {
        startInput.scenePath = options.scenePath;
        sceneId = options.scenePath;
      } else if (options.scene) {
        startInput.scene = options.scene;
        sceneId = (options.scene as { id?: string }).id ?? "inline";
      }

      await this.startRun(startInput);
      await this.page.goto("/");
      await this.runToCompletion({ maxTurns: this.options.maxTurns });
      const report = await this.evaluate();
      runs.push(report);

      if (onRunComplete) {
        onRunComplete(report.runId, report);
      }
    }

    const passedRuns = runs.filter((r) => r.passed).length;
    const summary: AggregateSummary = {
      sceneId,
      totalRuns: count,
      passedRuns,
      failedRuns: count - passedRuns,
      passRate: count > 0 ? (passedRuns / count) * 100 : 0,
    };

    return { runs, summary };
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAffordanceSnapshot(value: unknown): value is AffordanceSnapshot {
  return isJsonObject(value)
    && Array.isArray(value.transcript)
    && Array.isArray(value.availableActions)
    && Array.isArray(value.availableUserTools);
}

function parseBrowserAction(value: unknown): BrowserSimAction {
  if (!isJsonObject(value) || typeof value.kind !== "string") {
    throw new Error("Replay bundle contains an invalid browser action.");
  }
  if (value.kind === "message" && typeof value.text === "string") {
    return { kind: "message", text: value.text };
  }
  if (value.kind === "click" && typeof value.targetId === "string") {
    return { kind: "click", targetId: value.targetId };
  }
  if (value.kind === "type" && typeof value.targetId === "string" && typeof value.text === "string") {
    return {
      kind: "type",
      targetId: value.targetId,
      text: value.text,
      ...(typeof value.clearFirst === "boolean" ? { clearFirst: value.clearFirst } : {}),
    };
  }
  if (value.kind === "select" && typeof value.targetId === "string" && typeof value.value === "string") {
    return { kind: "select", targetId: value.targetId, value: value.value };
  }
  if (value.kind === "upload" && typeof value.targetId === "string" && typeof value.fileRef === "string") {
    return { kind: "upload", targetId: value.targetId, fileRef: value.fileRef };
  }
  if (value.kind === "navigate" && (typeof value.targetId === "string" || typeof value.url === "string")) {
    return {
      kind: "navigate",
      ...(typeof value.targetId === "string" ? { targetId: value.targetId } : {}),
      ...(typeof value.url === "string" ? { url: value.url } : {}),
    };
  }
  throw new Error(`Replay bundle contains an unsupported ${value.kind} action.`);
}

function findReplayTarget(
  recorded: UIActionTarget,
  current: UIActionTarget[],
): UIActionTarget | undefined {
  const selector = recorded.metadata?.selector;
  if (typeof selector === "string") {
    const selectorMatch = current.find((target) => target.metadata?.selector === selector);
    if (selectorMatch) return selectorMatch;
  }
  return current.find((target) => (
    target.id === recorded.id
    || (target.kind === recorded.kind && target.label === recorded.label)
  ));
}

export interface MimiqFixtures {
  mimiqRuntime: MimiqRuntimeClient;
  mimiqAdapter: PlaywrightBrowserAdapter;
  mimiqOptions: MimiqTestHelperOptions;
  mimiq: MimiqTestHelper;
}

export interface MimiqWorkerFixtures {
  mimiqRuntimeFactory: () => MimiqRuntimeClient;
  mimiqAdapterFactory: (page: Page) => PlaywrightBrowserAdapter | Promise<PlaywrightBrowserAdapter>;
}

export const test = base.extend<MimiqFixtures, MimiqWorkerFixtures>({
  mimiqRuntimeFactory: [
    async ({}, use) => { // eslint-disable-line no-empty-pattern
      await use(() => {
        throw new Error(
          "mimiqRuntimeFactory must be provided. Override this fixture in your test config.",
        );
      });
    },
    { scope: "worker" },
  ],

  mimiqAdapterFactory: [
    async ({}, use) => { // eslint-disable-line no-empty-pattern
      await use(() => {
        throw new Error(
          "mimiqAdapterFactory must be provided. Override this fixture in your test config.",
        );
      });
    },
    { scope: "worker" },
  ],

  mimiqRuntime: async ({ mimiqRuntimeFactory }, use) => {
    const runtime = mimiqRuntimeFactory();
    await use(runtime);
  },

  mimiqAdapter: async ({ page, mimiqAdapterFactory }, use) => {
    const adapter = await mimiqAdapterFactory(page);
    await use(adapter);
  },

  mimiqOptions: async ({}, use) => { // eslint-disable-line no-empty-pattern
    await use({});
  },

  mimiq: async ({ page, mimiqRuntime, mimiqAdapter, mimiqOptions }, use) => {
    const helper = new MimiqTestHelper(page, mimiqRuntime, mimiqAdapter, mimiqOptions);
    await use(helper);
    await helper.cleanup();
  },
});

export { expect };
