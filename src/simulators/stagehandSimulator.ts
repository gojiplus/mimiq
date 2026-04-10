/**
 * Stagehand-based browser agent simulator.
 * Uses @browserbasehq/stagehand for dynamic browser automation.
 */

import type { Scene } from "../core/models";
import type { AffordanceSnapshot, BrowserSimAction } from "../types";
import type { SimulatorInterface, SimulatorResult } from "../core/simulatorInterface";
import { createLogger } from "../utils/logger";

const log = createLogger("StagehandSimulator");

export interface StagehandSimulatorOptions {
  model?: string;
  headless?: boolean;
  browserbaseApiKey?: string;
  browserbaseProjectId?: string;
  verbose?: boolean;
}

interface StagehandInstance {
  init(): Promise<void>;
  act(options: { action: string }): Promise<unknown>;
  close(): Promise<void>;
}

interface StagehandConstructor {
  new (config: Record<string, unknown>): StagehandInstance;
}

/**
 * Simulator that uses Stagehand for browser automation.
 * Stagehand can perform browser actions beyond just typing messages.
 */
export class StagehandSimulator implements SimulatorInterface {
  private scene: Scene;
  private options: StagehandSimulatorOptions;
  private stagehand: StagehandInstance | null = null;
  private StagehandClass: StagehandConstructor | null = null;
  private maxTurns: number;
  private startingPrompt: string;
  private turnCount: number = 0;

  constructor(scene: Scene, options: StagehandSimulatorOptions = {}) {
    this.scene = scene;
    this.options = {
      model: options.model || process.env.STAGEHAND_MODEL || "gpt-4o",
      headless: options.headless ?? true,
      browserbaseApiKey: options.browserbaseApiKey || process.env.BROWSERBASE_API_KEY,
      browserbaseProjectId: options.browserbaseProjectId || process.env.BROWSERBASE_PROJECT_ID,
      verbose: options.verbose ?? false,
    };
    this.maxTurns = scene.max_turns ?? 15;
    this.startingPrompt = scene.starting_prompt;

    log.debug({
      model: this.options.model,
      headless: this.options.headless,
      hasBrowserbaseApiKey: !!this.options.browserbaseApiKey,
      maxTurns: this.maxTurns,
    }, "StagehandSimulator initialized");
  }

  async nextTurn(snapshot: AffordanceSnapshot): Promise<SimulatorResult> {
    if (this.turnCount === 0) {
      this.turnCount++;
      return { kind: "message", text: this.startingPrompt };
    }

    const stagehand = await this.getStagehand();

    const lastAgentMessage = [...snapshot.transcript]
      .reverse()
      .find((t) => t.role === "assistant");

    const context = `
Current URL: ${snapshot.url || "unknown"}
Last agent message: ${lastAgentMessage?.text || "No message"}
Available actions: ${snapshot.availableActions.map((a) => `${a.id} (${a.kind}): ${a.label}`).join(", ")}
UI state: ${snapshot.stateMarkers?.join(", ") || "unknown"}

Conversation plan: ${this.scene.conversation_plan}

What should the user do next? If the goal is complete, return "DONE".
`;

    try {
      log.debug({ turn: this.turnCount, url: snapshot.url, availableActions: snapshot.availableActions.length }, "Executing stagehand action");

      const result = await stagehand.act({
        action: context,
      });

      log.debug({ turn: this.turnCount, resultType: typeof result }, "Stagehand action result");

      if (!result || (typeof result === "string" && result.toLowerCase().includes("done"))) {
        log.info({ turn: this.turnCount }, "Goal completed");
        return { kind: "done", reason: "Goal completed" };
      }

      const action = this.parseStagehandResult(result, snapshot);
      log.debug({ turn: this.turnCount, actionKind: action.kind }, "Parsed action");
      this.turnCount++;
      return action;
    } catch (error) {
      log.error({ turn: this.turnCount, error }, "Stagehand error");
      return { kind: "done", reason: `Stagehand error: ${error}` };
    }
  }

  private async loadStagehand(): Promise<StagehandConstructor> {
    if (this.StagehandClass) {
      return this.StagehandClass;
    }

    log.debug("Loading @browserbasehq/stagehand module");

    // Dynamic import to handle optional dependency
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const stagehandModule = await (Function('return import("@browserbasehq/stagehand")')() as Promise<{ Stagehand: StagehandConstructor }>);
    this.StagehandClass = stagehandModule.Stagehand;

    log.debug("Stagehand module loaded");
    return this.StagehandClass;
  }

  private async getStagehand(): Promise<StagehandInstance> {
    if (this.stagehand) {
      return this.stagehand;
    }

    const Stagehand = await this.loadStagehand();

    const config: Record<string, unknown> = {
      env: this.options.browserbaseApiKey ? "BROWSERBASE" : "LOCAL",
      verbose: this.options.verbose ? 1 : 0,
      headless: this.options.headless,
      modelName: this.options.model,
    };

    if (this.options.browserbaseApiKey) {
      config.apiKey = this.options.browserbaseApiKey;
      config.projectId = this.options.browserbaseProjectId;
    }

    log.debug({ env: config.env, headless: config.headless, model: config.modelName }, "Initializing Stagehand instance");

    this.stagehand = new Stagehand(config);
    await this.stagehand.init();

    log.info("Stagehand instance initialized");
    return this.stagehand;
  }

  private parseStagehandResult(result: unknown, _snapshot: AffordanceSnapshot): BrowserSimAction {
    if (typeof result === "string") {
      return { kind: "message", text: result };
    }

    if (typeof result === "object" && result !== null) {
      const obj = result as Record<string, unknown>;

      if (obj.action === "click" && obj.selector) {
        return {
          kind: "click",
          targetId: String(obj.selector),
        };
      }

      if (obj.action === "type" && obj.text) {
        return {
          kind: "type",
          targetId: obj.selector ? String(obj.selector) : "chat-input",
          text: String(obj.text),
        };
      }

      if (obj.action === "navigate" && obj.url) {
        return {
          kind: "navigate",
          url: String(obj.url),
        };
      }

      if (obj.text) {
        return { kind: "message", text: String(obj.text) };
      }
    }

    return { kind: "message", text: String(result) };
  }

  getMaxTurns(): number {
    return this.maxTurns;
  }

  getStartingPrompt(): string {
    return this.startingPrompt;
  }

  async cleanup(): Promise<void> {
    if (this.stagehand) {
      try {
        await this.stagehand.close();
      } catch {
        // Ignore cleanup errors
      }
      this.stagehand = null;
    }
  }
}
