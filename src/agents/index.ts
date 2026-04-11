/**
 * Browser agent registry and factory.
 */

import { createRequire } from "module";
import type { BrowserAgent, BrowserAgentFactory, BrowserAgentOptions } from "./browserAgent";
import type { BrowserAgentType } from "../types";
import { createLogger } from "../utils/nodeLogger";

const esmRequire = createRequire(import.meta.url);

export type { BrowserAgent, BrowserAgentFactory, BrowserAgentOptions };

const log = createLogger("AgentRegistry");

const agentFactories = new Map<BrowserAgentType, BrowserAgentFactory>();

export function registerAgent(type: BrowserAgentType, factory: BrowserAgentFactory): void {
  agentFactories.set(type, factory);
  log.debug({ type }, "Agent registered");
}

export function getAgentFactory(type: BrowserAgentType): BrowserAgentFactory | undefined {
  return agentFactories.get(type);
}

export function listAgentTypes(): BrowserAgentType[] {
  return Array.from(agentFactories.keys());
}

export async function createAgent(
  type: BrowserAgentType,
  options?: BrowserAgentOptions
): Promise<BrowserAgent> {
  let factory = agentFactories.get(type);

  if (!factory) {
    if (type === "stagehand") {
      const { createStagehandAgent } = await import("./stagehandAgent");
      factory = createStagehandAgent;
      registerAgent(type, factory);
    } else {
      throw new Error(
        `Unknown agent type: ${type}. Available: ${listAgentTypes().join(", ") || "none (install @browserbasehq/stagehand for stagehand)"}`
      );
    }
  }

  return factory(options);
}

export function isAgentAvailable(type: BrowserAgentType): boolean {
  if (agentFactories.has(type)) return true;

  if (type === "stagehand") {
    try {
      esmRequire.resolve("@browserbasehq/stagehand");
      return true;
    } catch {
      return false;
    }
  }

  return false;
}
