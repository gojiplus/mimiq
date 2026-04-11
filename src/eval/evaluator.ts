/**
 * Evaluator interface for the mimiq evaluation pipeline.
 */

import type { EvaluatorResult, JsonObject, RecordingTranscript } from "../types";
import type { Trace, Expectations } from "../core/models";

export interface EvaluatorContext {
  transcript: RecordingTranscript;
  trace?: Trace;
  expectations?: Expectations;
  metadata?: JsonObject;
}

export interface Evaluator {
  name: string;
  description: string;
  evaluate(ctx: EvaluatorContext): Promise<EvaluatorResult> | EvaluatorResult;
}

export type EvaluatorFactory = (config?: JsonObject) => Evaluator;
