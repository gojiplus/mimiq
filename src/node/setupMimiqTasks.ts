import type { SetupMimiqTasksOptions } from "../types";
import {
  visualAssert,
  accessibilityAudit,
  visualCompare,
  type LayoutLensConfig,
} from "../eval/layoutlens";
import {
  complete,
  completeWithImage,
  completeWithHtmlAndImage,
  type LLMConfig,
} from "../core/llm";
import * as path from "path";

export interface SetupMimiqTasksOptionsExtended extends SetupMimiqTasksOptions {
  layoutLensConfig?: LayoutLensConfig;
  baselinesDir?: string;
}

export function setupMimiqTasks(
  on: Cypress.PluginEvents,
  options: SetupMimiqTasksOptionsExtended,
): void {
  const { runtime, layoutLensConfig = {}, baselinesDir = "./test/baselines" } = options;

  on("task", {
    async "mimiq:startRun"(input) {
      return runtime.startRun(input);
    },

    async "mimiq:advanceRun"(input) {
      return runtime.advanceRun(input);
    },

    async "mimiq:evaluateRun"(input) {
      return runtime.evaluateRun(input);
    },

    async "mimiq:getTrace"(input) {
      return runtime.getTrace(input);
    },

    async "mimiq:cleanupRun"(input) {
      await runtime.cleanupRun(input);
      return null;
    },

    async "mimiq:getReport"(input) {
      return runtime.getReport(input);
    },

    async "mimiq:getAggregateReport"() {
      return runtime.getAggregateReport({});
    },

    async "mimiq:visualAssert"(input: { url: string; query: string }) {
      return visualAssert(input.url, input.query, layoutLensConfig);
    },

    async "mimiq:accessibilityAudit"(input: {
      url: string;
      options?: { level?: "A" | "AA" | "AAA" };
    }) {
      return accessibilityAudit(input.url, input.options, layoutLensConfig);
    },

    async "mimiq:visualCompare"(input: {
      url: string;
      baselineName: string;
      options?: { threshold?: number };
    }) {
      const baselinePath = path.resolve(baselinesDir, `${input.baselineName}.png`);
      return visualCompare(
        input.url,
        baselinePath,
        { baselineName: input.baselineName, ...input.options },
        layoutLensConfig
      );
    },

    async "mimiq:llm:complete"(input: { prompt: string; config?: LLMConfig }) {
      return complete(input.prompt, input.config);
    },

    async "mimiq:llm:completeWithImage"(input: {
      prompt: string;
      imageBase64: string;
      config?: LLMConfig;
    }) {
      return completeWithImage(input.prompt, input.imageBase64, input.config);
    },

    async "mimiq:llm:completeWithHtmlAndImage"(input: {
      prompt: string;
      html: string;
      imageBase64: string;
      config?: LLMConfig;
    }) {
      return completeWithHtmlAndImage(
        input.prompt,
        input.html,
        input.imageBase64,
        input.config
      );
    },
  });
}
