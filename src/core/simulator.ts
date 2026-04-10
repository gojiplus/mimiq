/**
 * Simulator: generates user turns from scene, persona, and conversation history.
 * Ported from understudy Python package.
 * Now implements SimulatorInterface for compatibility with browser agent simulators.
 */

import type { Persona, Scene } from "./models";
import { personaToPrompt, resolvePersona } from "./models";
import { complete } from "./llm";
import type { AffordanceSnapshot, MessageAction } from "../types";
import type { SimulatorInterface, SimulatorResult } from "./simulatorInterface";
import { createLogger } from "../utils/logger";

const log = createLogger("Simulator");

const SIMULATOR_SYSTEM_PROMPT = `\
You are simulating a user in a customer interaction. You are NOT the agent.
You are the customer. Stay in character.

{persona}

CONVERSATION PLAN:
{conversation_plan}

RULES:
- Follow the conversation plan above. It tells you what you want and
  how to react to what the agent does.
- Respond naturally as a human would. Keep responses concise (1-3 sentences).
- If the plan says to provide information "if asked", wait until the
  agent asks before providing it.
- If you have accomplished your goal or the conversation has reached
  a natural end, respond with exactly: <finished>
- Never break character. Never mention that you are a simulator.
- Never use tool calls or function calls. You are the user, not the agent.
`;

const FINISHED_SIGNAL = "<finished>";

export interface SimulatorConfig {
  model?: string;
}

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

/**
 * LLM-based simulator that generates text messages.
 * Implements SimulatorInterface for compatibility with the runtime.
 */
export class Simulator implements SimulatorInterface {
  private systemPrompt: string;
  private startingPrompt: string;
  private maxTurns: number;
  private config: Required<SimulatorConfig>;
  private isFirstTurn: boolean = true;

  constructor(scene: Scene, config: SimulatorConfig = {}) {
    const persona: Persona = resolvePersona(scene.persona);

    this.systemPrompt = SIMULATOR_SYSTEM_PROMPT
      .replace("{persona}", personaToPrompt(persona))
      .replace("{conversation_plan}", scene.conversation_plan);

    this.startingPrompt = scene.starting_prompt;
    this.maxTurns = scene.max_turns ?? 15;

    this.config = {
      model:
        config.model ||
        process.env.SIMULATOR_MODEL ||
        process.env.LLM_MODEL ||
        "google/gemini-2.0-flash",
    };

    log.debug({ persona: persona.description, model: this.config.model, maxTurns: this.maxTurns }, "Simulator initialized");
  }

  /**
   * Generate next turn from snapshot.
   * Implements SimulatorInterface.
   */
  async nextTurn(snapshot: AffordanceSnapshot): Promise<SimulatorResult> {
    const history = this.snapshotToHistory(snapshot);
    const text = await this.nextTurnFromHistory(history);

    if (text === null) {
      return { kind: "done", reason: "Simulator finished" };
    }

    const action: MessageAction = { kind: "message", text };
    return action;
  }

  /**
   * Legacy method: generate next turn from conversation history.
   * Kept for backward compatibility.
   */
  async nextTurnFromHistory(history: ConversationTurn[]): Promise<string | null> {
    const turnNumber = history.length;

    if (history.length === 0 || this.isFirstTurn) {
      this.isFirstTurn = false;
      log.debug({ turnNumber, startingPrompt: this.startingPrompt }, "Returning starting prompt");
      return this.startingPrompt;
    }

    log.debug({ turnNumber, messageCount: history.length }, "Generating next turn");

    const prompt = this.buildPrompt(history);
    const text = await complete(prompt, {
      model: this.config.model,
      maxTokens: 256,
    });

    log.debug({ turnNumber, responseLength: text.length }, "LLM response received");

    if (text.toLowerCase().includes(FINISHED_SIGNAL)) {
      log.info({ turnNumber }, "Conversation finished signal received");
      return null;
    }

    return text;
  }

  private snapshotToHistory(snapshot: AffordanceSnapshot): ConversationTurn[] {
    return snapshot.transcript.map((t) => ({
      role: t.role as "user" | "assistant",
      content: t.text,
    }));
  }

  private buildPrompt(history: ConversationTurn[]): string {
    let prompt = this.systemPrompt + "\n\nCONVERSATION SO FAR:\n";
    for (const turn of history) {
      const role = turn.role.toUpperCase();
      prompt += `${role}: ${turn.content}\n`;
    }
    prompt += "\nUSER:";
    return prompt;
  }

  getMaxTurns(): number {
    return this.maxTurns;
  }

  getStartingPrompt(): string {
    return this.startingPrompt;
  }

  async cleanup(): Promise<void> {
    // No cleanup needed for LLM simulator
  }
}
