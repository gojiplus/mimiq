/**
 * Playwright test fixtures for mimiq.
 * Provides the mimiq test helper as a Playwright fixture.
 */

import { test as base, expect, type Page } from "@playwright/test";
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

    await this.adapter.executeAction(advance.action);
    await this.adapter.awaitSettled({ timeoutMs: this.options.settleTimeoutMs });

    return advance;
  }

  async runToCompletion(options?: { maxTurns?: number }): Promise<void> {
    const maxTurns = options?.maxTurns ?? this.options.maxTurns ?? 12;

    while (this.turnCount < maxTurns) {
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

export interface MimiqFixtures {
  mimiqRuntime: MimiqRuntimeClient;
  mimiqAdapter: PlaywrightBrowserAdapter;
  mimiqOptions: MimiqTestHelperOptions;
  mimiq: MimiqTestHelper;
}

export interface MimiqWorkerFixtures {
  mimiqRuntimeFactory: () => MimiqRuntimeClient;
  mimiqAdapterFactory: (page: Page) => PlaywrightBrowserAdapter;
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
    const adapter = mimiqAdapterFactory(page);
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
