import type { AffordanceSnapshot, TranscriptTurn } from "../types";

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

  async nextTurn(snapshot: AffordanceSnapshot): Promise<string | null> {
    const history = snapshot.transcript;

    if (history.length === 0) {
      return this.scene.starting_prompt;
    }

    const prompt = buildPrompt(this.scene, history);

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
      throw new Error(`LLM API error: ${response.status} ${text}`);
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

  getScene(): Scene {
    return this.scene;
  }

  getMaxTurns(): number {
    return this.scene.max_turns ?? 15;
  }
}
