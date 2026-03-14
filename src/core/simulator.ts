/**
 * Simulator: generates user turns from scene, persona, and conversation history.
 * Ported from understudy Python package.
 */

import type { Persona, Scene } from "./models";
import { personaToPrompt, resolvePersona } from "./models";

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
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

export class Simulator {
  private systemPrompt: string;
  private startingPrompt: string;
  private maxTurns: number;
  private config: Required<SimulatorConfig>;

  constructor(scene: Scene, config: SimulatorConfig = {}) {
    const persona: Persona = resolvePersona(scene.persona);

    this.systemPrompt = SIMULATOR_SYSTEM_PROMPT
      .replace("{persona}", personaToPrompt(persona))
      .replace("{conversation_plan}", scene.conversation_plan);

    this.startingPrompt = scene.starting_prompt;
    this.maxTurns = scene.max_turns ?? 15;

    this.config = {
      apiKey: config.apiKey || process.env.OPENAI_API_KEY || "",
      model: config.model || process.env.SIMULATOR_MODEL || "gpt-4o",
      baseUrl: config.baseUrl || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    };

    if (!this.config.apiKey) {
      throw new Error(
        "No API key provided. Set OPENAI_API_KEY environment variable or pass apiKey in config.",
      );
    }
  }

  async nextTurn(history: ConversationTurn[]): Promise<string | null> {
    if (history.length === 0) {
      return this.startingPrompt;
    }

    const prompt = this.buildPrompt(history);

    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 256,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Simulator API error: ${response.status} ${text}`);
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    const text = data.choices[0]?.message?.content?.trim() || "";

    if (text.toLowerCase().includes(FINISHED_SIGNAL)) {
      return null;
    }

    return text;
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
}
