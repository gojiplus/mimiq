/**
 * Completion rate evaluator: checks if the run reached an allowed terminal state.
 */

import type { Evaluator, EvaluatorContext } from "./evaluator";
import { registerEvaluator } from "./registry";

export const completionRateEvaluator: Evaluator = {
  name: "completion-rate",
  description: "Checks if the run reached an allowed terminal state",

  evaluate(ctx: EvaluatorContext) {
    const terminalState = ctx.transcript.terminalState;
    const allowedStates = ctx.expectations?.allowed_terminal_states || [];

    if (allowedStates.length === 0) {
      const hasTerminalState = !!terminalState;
      return {
        name: "completion-rate",
        passed: hasTerminalState,
        score: hasTerminalState ? 1 : 0,
        details: hasTerminalState
          ? `Completed with state: ${terminalState}`
          : "No terminal state reached",
      };
    }

    const passed = allowedStates.includes(terminalState || "");
    return {
      name: "completion-rate",
      passed,
      score: passed ? 1 : 0,
      details: passed
        ? `Reached allowed state: ${terminalState}`
        : `State "${terminalState || "none"}" not in allowed: [${allowedStates.join(", ")}]`,
    };
  },
};

registerEvaluator("completion-rate", () => completionRateEvaluator);
