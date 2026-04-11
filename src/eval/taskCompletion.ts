/**
 * Task completion evaluator: uses LLM to judge if the agent achieved the goal.
 */

import type { Evaluator, EvaluatorContext } from "./evaluator";
import { registerEvaluator } from "./registry";
import { complete } from "../core/llm";
import type { JsonObject } from "../types";

export interface TaskCompletionConfig {
  model?: string;
  rubric?: string;
}

function buildTaskCompletionPrompt(
  goal: string,
  transcript: string,
  terminalState?: string,
  customRubric?: string
): string {
  const rubric = customRubric || `
Evaluate whether the agent successfully accomplished the user's goal.
Consider:
1. Was the core objective achieved?
2. Was the outcome satisfactory from the user's perspective?
3. Were there any errors or incomplete actions?

Answer YES if the goal was achieved, NO if not. Provide a brief explanation.
`;

  return `You are evaluating a conversation between a user and an AI agent.

GOAL: ${goal}

CONVERSATION TRANSCRIPT:
${transcript}

${terminalState ? `TERMINAL STATE: ${terminalState}` : ""}

EVALUATION RUBRIC:
${rubric}

Respond in this exact format:
RESULT: YES or NO
EXPLANATION: <your reasoning>`;
}

function parseTaskCompletionResponse(response: string): {
  passed: boolean;
  explanation: string;
} {
  const resultMatch = response.match(/RESULT:\s*(YES|NO)/i);
  const explanationMatch = response.match(/EXPLANATION:\s*(.+)/is);

  return {
    passed: resultMatch?.[1]?.toUpperCase() === "YES",
    explanation: explanationMatch?.[1]?.trim() || response.trim(),
  };
}

function transcriptToText(ctx: EvaluatorContext): string {
  const lines: string[] = [];

  for (const turn of ctx.transcript.turns) {
    const role = turn.actor === "customer" ? "USER" : "AGENT";
    if (turn.content) {
      lines.push(`${role}: ${turn.content}`);
    }

    if (turn.toolCalls && turn.toolCalls.length > 0) {
      for (const tc of turn.toolCalls) {
        lines.push(`  [Tool: ${tc.tool}(${JSON.stringify(tc.args)})]`);
        if (tc.result !== undefined) {
          const resultStr = JSON.stringify(tc.result);
          lines.push(`  [Result: ${resultStr.slice(0, 200)}${resultStr.length > 200 ? "..." : ""}]`);
        }
      }
    }
  }

  return lines.join("\n");
}

function extractGoal(ctx: EvaluatorContext): string {
  const metadata = ctx.metadata as JsonObject | undefined;

  if (metadata?.goal) {
    return String(metadata.goal);
  }

  if (metadata?.scene && typeof metadata.scene === "object") {
    const scene = metadata.scene as JsonObject;
    if (scene.goal) {
      return String(scene.goal);
    }
    if (scene.conversation_plan) {
      return String(scene.conversation_plan);
    }
  }

  const firstTurn = ctx.transcript.turns.find((t) => t.actor === "customer");
  if (firstTurn?.content) {
    return `User's initial request: ${firstTurn.content}`;
  }

  return "Achieve a successful resolution for the customer";
}

export function createTaskCompletionEvaluator(config?: TaskCompletionConfig): Evaluator {
  return {
    name: "task-completion",
    description: "LLM-based evaluation of whether the agent achieved the goal",

    async evaluate(ctx: EvaluatorContext) {
      const goal = extractGoal(ctx);
      const transcript = transcriptToText(ctx);
      const terminalState = ctx.transcript.terminalState;

      const prompt = buildTaskCompletionPrompt(
        goal,
        transcript,
        terminalState,
        config?.rubric
      );

      try {
        const response = await complete(prompt, { model: config?.model });
        const { passed, explanation } = parseTaskCompletionResponse(response);

        return {
          name: "task-completion",
          passed,
          score: passed ? 1 : 0,
          details: explanation,
        };
      } catch (error) {
        return {
          name: "task-completion",
          passed: false,
          score: 0,
          details: `Evaluation error: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}

registerEvaluator("task-completion", (config) =>
  createTaskCompletionEvaluator(config as TaskCompletionConfig | undefined)
);
