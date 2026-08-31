/**
 * Autonomous browser-action policy.
 * Playwright owns the browser; this simulator chooses the next allowed user action.
 */

import type { Scene } from "../core/models";
import { complete } from "../core/llm";
import type { AffordanceSnapshot, BrowserSimAction } from "../types";
import type { SimulatorInterface, SimulatorResult } from "../core/simulatorInterface";
import { createLogger } from "../utils/nodeLogger";

const log = createLogger("BrowserUseSimulator");

const ACTION_POLICY_PROMPT = `You are an autonomous user operating a real application.
Your goal is defined by the scene. Choose exactly one next action from the observed affordances.

SCENE GOAL:
{goal}

SCENE CONTEXT:
{context}

CURRENT OBSERVATION:
{observation}

Return only JSON. Valid forms are:
{"kind":"message","text":"..."}
{"kind":"click","targetId":"..."}
{"kind":"type","targetId":"...","text":"...","clearFirst":true}
{"kind":"select","targetId":"...","value":"..."}
{"kind":"upload","targetId":"...","fileRef":"..."}
{"kind":"navigate","url":"https://..."}
{"kind":"navigate","targetId":"..."}
{"kind":"done","reason":"..."}

Never invent a targetId. Do not claim an action succeeded; the browser will report that separately.`;

export interface BrowserUseSimulatorOptions {
  model?: string;
  baseURL?: string;
  apiKey?: string;
}

interface ParsedAction {
  kind?: unknown;
  text?: unknown;
  targetId?: unknown;
  value?: unknown;
  fileRef?: unknown;
  url?: unknown;
  clearFirst?: unknown;
  reason?: unknown;
}

export class BrowserUseSimulator implements SimulatorInterface {
  private scene: Scene;
  private options: Required<BrowserUseSimulatorOptions>;
  private maxTurns: number;
  private turnCount = 0;

  constructor(scene: Scene, options: BrowserUseSimulatorOptions = {}) {
    this.scene = scene;
    this.options = {
      model: options.model || process.env.SIMULATOR_MODEL || process.env.LLM_MODEL || "local/qwen3:8b",
      baseURL: options.baseURL ?? process.env.LLM_BASE_URL ?? "",
      apiKey: options.apiKey ?? process.env.LLM_API_KEY ?? "",
    };
    this.maxTurns = scene.max_turns ?? 15;
  }

  async nextTurn(snapshot: AffordanceSnapshot): Promise<SimulatorResult> {
    if (this.turnCount >= this.maxTurns) {
      return { kind: "done", reason: "Max turns reached" };
    }

    this.turnCount++;
    if (this.turnCount === 1 && this.scene.starting_prompt.trim()) {
      return { kind: "message", text: this.scene.starting_prompt };
    }

    const prompt = ACTION_POLICY_PROMPT
      .replace("{goal}", this.scene.conversation_plan)
      .replace("{context}", JSON.stringify(this.scene.context ?? {}))
      .replace("{observation}", JSON.stringify(snapshot));
    const response = await complete(prompt, {
      model: this.options.model,
      baseURL: this.options.baseURL || undefined,
      apiKey: this.options.apiKey || undefined,
      maxTokens: 256,
    });
    const action = this.parseAction(response);
    this.validateAction(action, snapshot);
    log.debug({ actionKind: action.kind, turn: this.turnCount }, "Browser action chosen");
    return action;
  }

  private parseAction(response: string): BrowserSimAction | { kind: "done"; reason?: string } {
    const match = response.match(/```(?:json)?\s*([\s\S]*?)\s*```/) ?? [undefined, response];
    let parsed: ParsedAction;
    try {
      parsed = JSON.parse(match[1].trim()) as ParsedAction;
    } catch {
      throw new Error(`Browser action policy returned invalid JSON: ${response}`);
    }

    if (typeof parsed.kind !== "string") {
      throw new Error("Browser action policy response must include a string kind.");
    }
    if (parsed.kind === "done") {
      return { kind: "done", ...(typeof parsed.reason === "string" ? { reason: parsed.reason } : {}) };
    }
    if (parsed.kind === "message" && typeof parsed.text === "string") {
      return { kind: "message", text: parsed.text };
    }
    if (parsed.kind === "click" && typeof parsed.targetId === "string") {
      return { kind: "click", targetId: parsed.targetId };
    }
    if (parsed.kind === "type" && typeof parsed.targetId === "string" && typeof parsed.text === "string") {
      return {
        kind: "type",
        targetId: parsed.targetId,
        text: parsed.text,
        ...(typeof parsed.clearFirst === "boolean" ? { clearFirst: parsed.clearFirst } : {}),
      };
    }
    if (parsed.kind === "select" && typeof parsed.targetId === "string" && typeof parsed.value === "string") {
      return { kind: "select", targetId: parsed.targetId, value: parsed.value };
    }
    if (parsed.kind === "upload" && typeof parsed.targetId === "string" && typeof parsed.fileRef === "string") {
      return { kind: "upload", targetId: parsed.targetId, fileRef: parsed.fileRef };
    }
    if (parsed.kind === "navigate" && (typeof parsed.targetId === "string" || typeof parsed.url === "string")) {
      return {
        kind: "navigate",
        ...(typeof parsed.targetId === "string" ? { targetId: parsed.targetId } : {}),
        ...(typeof parsed.url === "string" ? { url: parsed.url } : {}),
      };
    }
    throw new Error(`Browser action policy returned an invalid ${parsed.kind} action.`);
  }

  private validateAction(
    action: BrowserSimAction | { kind: "done"; reason?: string },
    snapshot: AffordanceSnapshot,
  ): void {
    if (action.kind === "done" || action.kind === "message" || (action.kind === "navigate" && action.url)) {
      return;
    }

    const targetId = action.targetId;
    const target = snapshot.availableActions.find((candidate) => candidate.id === targetId);
    if (!target) {
      throw new Error(`Browser action policy selected unobserved target "${targetId}".`);
    }
    if (!target.enabled) {
      throw new Error(`Browser action policy selected disabled target "${targetId}".`);
    }
    if (target.kind !== action.kind) {
      throw new Error(`Browser action policy selected "${targetId}" as ${action.kind}, but it is ${target.kind}.`);
    }
  }

  getMaxTurns(): number {
    return this.maxTurns;
  }

  getStartingPrompt(): string {
    return this.scene.starting_prompt;
  }

  async cleanup(): Promise<void> {}
}
