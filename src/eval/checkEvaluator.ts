/**
 * Check evaluator: validates required/forbidden tools and terminal states.
 * Wraps the existing check() function from core.
 */

import type { Evaluator, EvaluatorContext } from "./evaluator";
import { check, type CheckResult } from "../core/check";
import { registerEvaluator } from "./registry";

function transcriptToTrace(ctx: EvaluatorContext) {
  if (ctx.trace) return ctx.trace;

  return {
    scene_id: ctx.transcript.sceneId,
    turns: ctx.transcript.turns.map((t) => ({
      role: t.actor === "customer" ? "user" as const : "agent" as const,
      content: t.content || "",
      tool_calls: (t.toolCalls || []).map((tc) => ({
        tool_name: tc.tool,
        arguments: tc.args,
        result: tc.result,
      })),
      timestamp: t.timestamp,
    })),
    terminal_state: ctx.transcript.terminalState,
    started_at: ctx.transcript.startedAt,
    finished_at: ctx.transcript.finishedAt,
  };
}

export const checkEvaluator: Evaluator = {
  name: "check",
  description: "Validates required/forbidden tools and terminal states",

  evaluate(ctx: EvaluatorContext) {
    const trace = transcriptToTrace(ctx);
    const expectations = ctx.expectations || {};

    const result: CheckResult = check(trace, expectations);

    const details = result.checks
      .map((c) => `${c.passed ? "✓" : "✗"} ${c.label}: ${c.detail}`)
      .join("\n");

    return {
      name: "check",
      passed: result.passed,
      score: result.passed ? 1 : 0,
      details,
      metadata: {
        checksCount: result.checks.length,
        failedCount: result.failedChecks.length,
        checks: result.checks.map((c) => ({
          label: c.label,
          passed: c.passed,
          detail: c.detail,
        })),
      },
    };
  },
};

registerEvaluator("check", () => checkEvaluator);
