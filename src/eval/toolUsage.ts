/**
 * Tool usage evaluator: analyzes tool call patterns.
 */

import type { Evaluator, EvaluatorContext } from "./evaluator";
import { registerEvaluator } from "./registry";

export const toolUsageEvaluator: Evaluator = {
  name: "tool-usage",
  description: "Analyzes tool call patterns and counts",

  evaluate(ctx: EvaluatorContext) {
    const toolCalls: Array<{ tool: string; args: Record<string, unknown> }> = [];

    for (const turn of ctx.transcript.turns) {
      if (turn.toolCalls) {
        for (const tc of turn.toolCalls) {
          toolCalls.push({ tool: tc.tool, args: tc.args });
        }
      }
    }

    const toolCounts: Record<string, number> = {};
    for (const tc of toolCalls) {
      toolCounts[tc.tool] = (toolCounts[tc.tool] || 0) + 1;
    }

    const uniqueTools = Object.keys(toolCounts);
    const totalCalls = toolCalls.length;

    const details = [
      `Total tool calls: ${totalCalls}`,
      `Unique tools: ${uniqueTools.length}`,
      ...Object.entries(toolCounts).map(([tool, count]) => `  ${tool}: ${count}`),
    ].join("\n");

    return {
      name: "tool-usage",
      passed: true,
      score: 1,
      details,
      metadata: {
        totalCalls,
        uniqueTools: uniqueTools.length,
        toolCounts,
        tools: uniqueTools,
      },
    };
  },
};

registerEvaluator("tool-usage", () => toolUsageEvaluator);
