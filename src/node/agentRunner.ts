/**
 * AgentRunner: Orchestrates browser agent execution.
 * Manages goal-directed conversation loop, DOM extraction, terminal state detection,
 * and trace recording.
 */

import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { parse as parseYaml } from "yaml";

import { createAgent, type BrowserAgent } from "../agents";
import { createLogger } from "../utils/nodeLogger";
import type {
  BrowserTrace,
  BrowserStep,
  JsonObject,
  EvaluatorResult,
} from "../types";
import { type AgentScene, resolvePersona, type Persona } from "../core/models";
import { complete } from "../core/llm";

const log = createLogger("AgentRunner");

export interface AgentRunnerOptions {
  outputDir?: string;
  headless?: boolean;
  model?: string;
  maxTurns?: number;
}

export interface AgentRunResult {
  trace: BrowserTrace;
  evaluation: {
    passed: boolean;
    results: EvaluatorResult[];
  };
}

function loadAgentScene(scenePathOrObject: string | JsonObject): AgentScene {
  if (typeof scenePathOrObject === "string") {
    const content = readFileSync(scenePathOrObject, "utf-8");
    return parseYaml(content) as AgentScene;
  }
  return scenePathOrObject as unknown as AgentScene;
}

function buildAgentSystemPrompt(scene: AgentScene, persona?: Persona): string {
  const lines: string[] = [
    "You are a browser automation agent interacting with a web application to achieve a specific goal.",
    "",
    `GOAL: ${scene.goal}`,
  ];

  if (scene.context) {
    lines.push("");
    lines.push("CONTEXT:");
    for (const [key, value] of Object.entries(scene.context)) {
      lines.push(`  ${key}: ${JSON.stringify(value)}`);
    }
  }

  if (persona) {
    lines.push("");
    lines.push(`PERSONA: ${persona.description}`);
    if (persona.behaviors.length > 0) {
      lines.push("Behaviors:");
      for (const b of persona.behaviors) {
        lines.push(`  - ${b}`);
      }
    }
  }

  lines.push("");
  lines.push("INSTRUCTIONS:");
  lines.push("1. Observe the current page state");
  lines.push("2. Decide on the next action to progress toward the goal");
  lines.push("3. Execute the action using natural language instructions");
  lines.push("4. If you've achieved the goal or reached a terminal state, indicate completion");
  lines.push("");
  lines.push("Respond with ONLY the next action instruction to execute, or 'DONE: <reason>' if finished.");

  return lines.join("\n");
}

async function planNextAction(
  systemPrompt: string,
  observation: string,
  history: string[],
  model?: string
): Promise<{ action: string; isDone: boolean; reason?: string }> {
  const historyText = history.length > 0
    ? `\n\nPREVIOUS ACTIONS:\n${history.join("\n")}`
    : "";

  const prompt = `${systemPrompt}

CURRENT PAGE STATE:
${observation}${historyText}

What is the next action to take?`;

  const response = await complete(prompt, { model });

  if (response.toUpperCase().startsWith("DONE:")) {
    return {
      action: "",
      isDone: true,
      reason: response.slice(5).trim(),
    };
  }

  return {
    action: response.trim(),
    isDone: false,
  };
}

function detectTerminalState(observation: string, response?: string): string | undefined {
  const combined = `${observation}\n${response || ""}`;

  const patterns: Array<{ pattern: RegExp; state: string }> = [
    { pattern: /return\s+(request\s+)?initiated/i, state: "return_initiated" },
    { pattern: /return\s+label\s+sent/i, state: "return_label_sent" },
    { pattern: /refund\s+(has been\s+)?issued/i, state: "refund_issued" },
    { pattern: /refund\s+(has been\s+)?processed/i, state: "refund_processed" },
    { pattern: /order\s+cancelled/i, state: "order_cancelled" },
    { pattern: /escalat(ed|ing).*?to\s+(a\s+)?human/i, state: "escalated_to_human" },
    { pattern: /transferred?\s+to\s+(a\s+)?(live\s+)?agent/i, state: "transferred_to_agent" },
    { pattern: /ticket\s+(id\s+)?[A-Z]+-[A-Z0-9]+/i, state: "ticket_created" },
    { pattern: /ticket\s+(has been\s+)?created/i, state: "ticket_created" },
    { pattern: /issue\s+(has been\s+)?resolved/i, state: "issue_resolved" },
    { pattern: /TERMINAL_STATE:\s*(\S+)/i, state: "explicit" },
  ];

  for (const { pattern, state } of patterns) {
    const match = combined.match(pattern);
    if (match) {
      if (state === "explicit" && match[1]) {
        return match[1];
      }
      return state;
    }
  }

  return undefined;
}

export class AgentRunner {
  private scene: AgentScene;
  private agent: BrowserAgent | null = null;
  private options: AgentRunnerOptions;
  private trace: BrowserTrace;
  private actionHistory: string[] = [];

  constructor(scene: AgentScene, options: AgentRunnerOptions = {}) {
    this.scene = scene;
    this.options = options;
    this.trace = {
      sceneId: scene.id,
      targetUrl: scene.target.url,
      startedAt: new Date().toISOString(),
      steps: [],
      goalAchieved: false,
    };
  }

  static async fromScenePath(
    scenePath: string,
    options: AgentRunnerOptions = {}
  ): Promise<AgentRunner> {
    const scene = loadAgentScene(scenePath);
    return new AgentRunner(scene, options);
  }

  async run(): Promise<AgentRunResult> {
    const agentType = this.scene.agent.type;
    const model = this.options.model || this.scene.agent.model;
    const headless = this.options.headless ?? this.scene.agent.headless ?? true;
    const maxTurns = this.options.maxTurns || this.scene.max_turns || 15;

    log.info(
      { sceneId: this.scene.id, agentType, url: this.scene.target.url, maxTurns },
      "Starting agent run"
    );

    this.agent = await createAgent(agentType, {
      type: agentType,
      model,
      headless,
    });

    try {
      await this.agent.start(this.scene.target.url);

      const persona = this.scene.persona
        ? resolvePersona(this.scene.persona)
        : undefined;
      const systemPrompt = buildAgentSystemPrompt(this.scene, persona);

      let turn = 0;
      let done = false;

      while (!done && turn < maxTurns) {
        turn++;
        log.debug({ turn, maxTurns }, "Starting turn");

        const step = await this.executeTurn(turn, systemPrompt, model);
        this.trace.steps.push(step);

        if (step.action.type === "observe" && step.action.result?.includes("DONE:")) {
          done = true;
          this.trace.goalAchieved = true;
        }

        const terminalState = detectTerminalState(
          step.action.result || "",
          step.response?.text
        );

        if (terminalState) {
          this.trace.terminalState = terminalState;
          log.info({ turn, terminalState }, "Terminal state detected");
          done = true;
        }

        if (step.action.error) {
          log.warn({ turn, error: step.action.error }, "Action error");
        }
      }

      if (turn >= maxTurns && !done) {
        log.warn({ turn, maxTurns }, "Max turns reached without completion");
      }

      this.trace.finishedAt = new Date().toISOString();
      this.trace.goalAchieved = this.assessGoalAchievement();

      const evaluation = await this.evaluate();

      if (this.options.outputDir) {
        this.saveTrace();
      }

      return { trace: this.trace, evaluation };
    } finally {
      if (this.agent) {
        await this.agent.stop();
      }
    }
  }

  private async executeTurn(
    turn: number,
    systemPrompt: string,
    model?: string
  ): Promise<BrowserStep> {
    const timestamp = new Date().toISOString();
    const observation = await this.agent!.observe();
    const url = observation.url;

    const observationText = this.formatObservation(observation);

    const plan = await planNextAction(
      systemPrompt,
      observationText,
      this.actionHistory,
      model
    );

    if (plan.isDone) {
      log.info({ turn, reason: plan.reason }, "Agent indicated done");

      return {
        turn,
        timestamp,
        url,
        action: {
          type: "observe",
          instruction: "Goal assessment",
          result: `DONE: ${plan.reason}`,
        },
      };
    }

    this.actionHistory.push(`Turn ${turn}: ${plan.action}`);

    const actionResult = await this.agent!.act(plan.action);

    let screenshot: string | undefined;
    if (this.options.outputDir) {
      try {
        const screenshotBuffer = await this.agent!.screenshot();
        const screenshotsDir = join(this.options.outputDir, "screenshots");
        mkdirSync(screenshotsDir, { recursive: true });
        const filename = `turn-${String(turn).padStart(3, "0")}-before.png`;
        writeFileSync(join(screenshotsDir, filename), screenshotBuffer);
        screenshot = `screenshots/${filename}`;
      } catch (error) {
        log.debug({ error }, "Screenshot capture failed");
      }
    }

    const postObservation = await this.agent!.observe();
    const responseText = this.extractAgentResponse(observation, postObservation);

    return {
      turn,
      timestamp,
      url,
      action: {
        type: "act",
        instruction: plan.action,
        result: actionResult.text,
        error: actionResult.error,
      },
      response: responseText
        ? { text: responseText }
        : undefined,
      screenshot,
    };
  }

  private formatObservation(observation: {
    url: string;
    title?: string;
    visibleText?: string;
    chatMessages?: Array<{ role: string; content: string }>;
  }): string {
    const lines: string[] = [
      `URL: ${observation.url}`,
    ];

    if (observation.title) {
      lines.push(`Title: ${observation.title}`);
    }

    if (observation.chatMessages && observation.chatMessages.length > 0) {
      lines.push("");
      lines.push("CHAT MESSAGES:");
      for (const msg of observation.chatMessages) {
        lines.push(`  ${msg.role.toUpperCase()}: ${msg.content}`);
      }
    }

    if (observation.visibleText) {
      lines.push("");
      lines.push("VISIBLE TEXT:");
      const text = typeof observation.visibleText === "string"
        ? observation.visibleText
        : JSON.stringify(observation.visibleText);
      lines.push(text.slice(0, 2000));
    }

    return lines.join("\n");
  }

  private extractAgentResponse(
    before: { chatMessages?: Array<{ role: string; content: string }> },
    after: { chatMessages?: Array<{ role: string; content: string }> }
  ): string | undefined {
    const beforeMessages = before.chatMessages || [];
    const afterMessages = after.chatMessages || [];

    if (afterMessages.length > beforeMessages.length) {
      const newMessages = afterMessages.slice(beforeMessages.length);
      const agentMessages = newMessages.filter(
        (m) => m.role === "assistant" || m.role === "agent"
      );
      if (agentMessages.length > 0) {
        return agentMessages.map((m) => m.content).join("\n");
      }
    }

    return undefined;
  }

  private assessGoalAchievement(): boolean {
    if (this.trace.terminalState) {
      const allowedStates = this.scene.expectations?.allowed_terminal_states || [];
      if (allowedStates.length > 0) {
        return allowedStates.includes(this.trace.terminalState);
      }
      return true;
    }

    const lastStep = this.trace.steps[this.trace.steps.length - 1];
    if (lastStep?.action.result?.includes("DONE:")) {
      return true;
    }

    return false;
  }

  private async evaluate(): Promise<{
    passed: boolean;
    results: EvaluatorResult[];
  }> {
    const results: EvaluatorResult[] = [];
    const expectations = this.scene.expectations || {};

    if (expectations.required_tools && expectations.required_tools.length > 0) {
      const usedTools = new Set<string>();
      for (const step of this.trace.steps) {
        if (step.response?.toolCalls) {
          for (const tc of step.response.toolCalls) {
            usedTools.add(tc.tool);
          }
        }
      }

      const missing = expectations.required_tools.filter(
        (t) => !usedTools.has(t)
      );

      results.push({
        name: "required-tools",
        passed: missing.length === 0,
        details: missing.length === 0
          ? "All required tools used"
          : `Missing tools: ${missing.join(", ")}`,
      });
    }

    if (expectations.allowed_terminal_states && expectations.allowed_terminal_states.length > 0) {
      const passed = expectations.allowed_terminal_states.includes(
        this.trace.terminalState || ""
      );

      results.push({
        name: "terminal-state",
        passed,
        details: passed
          ? `Reached allowed state: ${this.trace.terminalState}`
          : `State "${this.trace.terminalState || "none"}" not allowed`,
      });
    }

    results.push({
      name: "goal-achieved",
      passed: this.trace.goalAchieved,
      details: this.trace.goalAchieved
        ? "Goal was achieved"
        : "Goal was not achieved",
    });

    const passed = results.every((r) => r.passed);

    return { passed, results };
  }

  private saveTrace(): void {
    if (!this.options.outputDir) return;

    mkdirSync(this.options.outputDir, { recursive: true });

    const tracePath = join(this.options.outputDir, "trace.json");
    writeFileSync(tracePath, JSON.stringify(this.trace, null, 2));

    log.info({ tracePath }, "Trace saved");
  }

  getTrace(): BrowserTrace {
    return this.trace;
  }
}

export async function runAgentScene(
  scenePathOrObject: string | JsonObject,
  options: AgentRunnerOptions = {}
): Promise<AgentRunResult> {
  const scene = loadAgentScene(scenePathOrObject);
  const runner = new AgentRunner(scene, options);
  return runner.run();
}
