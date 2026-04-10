/**
 * Simulator interface for mimiq.
 * Defines the contract for all simulator implementations (LLM, Stagehand, browser-use).
 */

import type { AffordanceSnapshot, BrowserSimAction, DoneAction } from "../types";

/**
 * Result from a simulator's nextTurn method.
 * Can be a browser action, done signal, or null (treated as done).
 */
export type SimulatorResult = BrowserSimAction | DoneAction | null;

/**
 * Interface for all simulator implementations.
 * Simulators generate user actions based on the current UI state.
 */
export interface SimulatorInterface {
  /**
   * Generate the next action based on current snapshot.
   * @param snapshot Current UI state
   * @returns The next action to perform, done signal, or null
   */
  nextTurn(snapshot: AffordanceSnapshot): Promise<SimulatorResult>;

  /**
   * Get the maximum number of turns allowed.
   */
  getMaxTurns(): number;

  /**
   * Get the starting prompt for this simulator.
   */
  getStartingPrompt(): string;

  /**
   * Clean up any resources (optional).
   */
  cleanup?(): Promise<void>;
}

/**
 * Simulator type identifier for scene configuration.
 */
export type SimulatorType = "llm" | "stagehand" | "browser-use";

/**
 * Configuration for simulator in scene files.
 */
export interface SimulatorConfig {
  type: SimulatorType;
  options?: Record<string, unknown>;
}
