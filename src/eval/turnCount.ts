/**
 * Turn count evaluator: measures conversation length.
 */

import type { Evaluator, EvaluatorContext } from "./evaluator";
import type { JsonObject } from "../types";
import { registerEvaluator } from "./registry";

interface TurnCountConfig {
  maxTurns?: number;
}

export function createTurnCountEvaluator(config?: JsonObject): Evaluator {
  const maxTurns = (config as TurnCountConfig)?.maxTurns;

  return {
    name: "turn-count",
    description: "Measures conversation length and optionally checks against max",

    evaluate(ctx: EvaluatorContext) {
      const turns = ctx.transcript.turns.length;
      const customerTurns = ctx.transcript.turns.filter((t) => t.actor === "customer").length;
      const agentTurns = ctx.transcript.turns.filter((t) => t.actor === "agent").length;

      let passed = true;
      let details = `Total turns: ${turns} (customer: ${customerTurns}, agent: ${agentTurns})`;

      if (maxTurns !== undefined) {
        passed = turns <= maxTurns;
        details += `\nMax allowed: ${maxTurns} - ${passed ? "OK" : "EXCEEDED"}`;
      }

      return {
        name: "turn-count",
        passed,
        score: maxTurns ? Math.min(1, maxTurns / Math.max(turns, 1)) : 1,
        details,
        metadata: {
          totalTurns: turns,
          customerTurns,
          agentTurns,
          maxTurns: maxTurns ?? null,
        },
      };
    },
  };
}

registerEvaluator("turn-count", createTurnCountEvaluator);
