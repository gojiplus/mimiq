import type { AffordanceSnapshot, TranscriptTurn } from "../types";
import { complete } from "../core/llm";

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

export interface Scene {
  id: string;
  description?: string;
  starting_prompt: string;
  conversation_plan: string;
  persona: string | { name?: string; traits?: string[] };
  max_turns?: number;
  context?: Record<string, unknown>;
  expectations?: {
    required_tools?: string[];
    forbidden_tools?: string[];
    allowed_terminal_states?: string[];
  };
}

function formatPersona(persona: Scene["persona"]): string {
  if (typeof persona === "string") {
    return `You are a ${persona} customer.`;
  }
  const parts: string[] = [];
  if (persona.name) {
    parts.push(`Your name is ${persona.name}.`);
  }
  if (persona.traits && persona.traits.length > 0) {
    parts.push(`Your traits: ${persona.traits.join(", ")}.`);
  }
  return parts.join(" ") || "You are a typical customer.";
}

function buildPrompt(scene: Scene, history: TranscriptTurn[]): string {
  const systemPrompt = SIMULATOR_SYSTEM_PROMPT
    .replace("{persona}", formatPersona(scene.persona))
    .replace("{conversation_plan}", scene.conversation_plan);

  let prompt = systemPrompt + "\n\nCONVERSATION SO FAR:\n";
  for (const turn of history) {
    const role = turn.role.toUpperCase();
    prompt += `${role}: ${turn.text}\n`;
  }
  prompt += "\nUSER:";

  return prompt;
}

export class Simulator {
  private config: Required<SimulatorConfig>;
  private scene: Scene;

  constructor(scene: Scene, config: SimulatorConfig = {}) {
    this.scene = scene;
    this.config = {
      model:
        config.model ||
        process.env.SIMULATOR_MODEL ||
        process.env.LLM_MODEL ||
        "google/gemini-2.0-flash",
    };
  }

  async nextTurn(snapshot: AffordanceSnapshot): Promise<string | null> {
    const history = snapshot.transcript;

    if (history.length === 0) {
      return this.scene.starting_prompt;
    }

    const prompt = buildPrompt(this.scene, history);
    const text = await complete(prompt, {
      model: this.config.model,
      maxTokens: 256,
    });

    if (text.toLowerCase().includes(FINISHED_SIGNAL)) {
      return null;
    }

    return text;
  }

  getScene(): Scene {
    return this.scene;
  }

  getMaxTurns(): number {
    return this.scene.max_turns ?? 15;
  }
}
