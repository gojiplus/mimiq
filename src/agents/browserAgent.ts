/**
 * BrowserAgent interface for autonomous browser-based evaluation.
 * Agents can navigate, interact with, and extract information from web pages.
 */

import type { BrowserAgentConfig, BrowserObservation, BrowserActionResult } from "../types";

export interface BrowserAgent {
  start(url: string): Promise<void>;
  act(instruction: string): Promise<BrowserActionResult>;
  extract(query: string): Promise<string>;
  observe(): Promise<BrowserObservation>;
  screenshot(): Promise<Buffer>;
  stop(): Promise<void>;
}

export interface BrowserAgentOptions extends Partial<BrowserAgentConfig> {
  apiKey?: string;
}

export type BrowserAgentFactory = (options?: BrowserAgentOptions) => Promise<BrowserAgent>;
