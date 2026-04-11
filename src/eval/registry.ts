/**
 * Evaluator registry for managing and discovering evaluators.
 */

import type { Evaluator, EvaluatorFactory } from "./evaluator";
import type { JsonObject } from "../types";

const evaluators = new Map<string, EvaluatorFactory>();

export function registerEvaluator(name: string, factory: EvaluatorFactory): void {
  evaluators.set(name, factory);
}

export function getEvaluator(name: string, config?: JsonObject): Evaluator | null {
  const factory = evaluators.get(name);
  if (!factory) return null;
  return factory(config);
}

export function listEvaluators(): string[] {
  return Array.from(evaluators.keys());
}

export function getEvaluatorsByNames(names: string[], config?: JsonObject): Evaluator[] {
  const result: Evaluator[] = [];
  for (const name of names) {
    const evaluator = getEvaluator(name, config);
    if (evaluator) {
      result.push(evaluator);
    }
  }
  return result;
}

export function getAllEvaluators(config?: JsonObject): Evaluator[] {
  return listEvaluators().map((name) => getEvaluator(name, config)!);
}
