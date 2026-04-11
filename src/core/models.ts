/**
 * Core data models - ported from understudy Python package.
 */

export type PersonaPreset =
  | "cooperative"
  | "frustrated_but_cooperative"
  | "adversarial"
  | "vague"
  | "impatient";

export interface PersonaDescription {
  description: string;
  behaviors: string[];
}

export const PERSONA_PRESETS: Record<PersonaPreset, PersonaDescription> = {
  cooperative: {
    description: "Helpful and direct. Provides information when asked.",
    behaviors: [
      "Answers questions directly and completely",
      "Provides requested information without hesitation",
      "Follows agent instructions cooperatively",
    ],
  },
  frustrated_but_cooperative: {
    description: "Mildly frustrated but ultimately cooperative when asked clear questions.",
    behaviors: [
      "Expresses mild frustration at the situation",
      "Pushes back once on denials before accepting",
      "Cooperates when the agent asks clear, direct questions",
      "May use short, clipped sentences",
    ],
  },
  adversarial: {
    description: "Tries to push boundaries and social-engineer exceptions.",
    behaviors: [
      "Reframes requests to bypass policy",
      "Escalates language when denied",
      "Cites external authority (legal, regulatory)",
      "Does not accept the first denial",
      "May try to confuse or overwhelm the agent",
    ],
  },
  vague: {
    description: "Gives incomplete information, needs follow-up.",
    behaviors: [
      "Provides partial answers to questions",
      "Omits details the agent needs",
      "Requires multiple follow-ups to get complete info",
      "May go off-topic occasionally",
    ],
  },
  impatient: {
    description: "Wants fast resolution, dislikes long exchanges.",
    behaviors: [
      "Gives very short answers",
      "Expresses impatience if the conversation drags",
      "Wants to get to resolution quickly",
      "May skip pleasantries",
    ],
  },
};

export interface Persona {
  description: string;
  behaviors: string[];
}

export function personaFromPreset(preset: PersonaPreset): Persona {
  return { ...PERSONA_PRESETS[preset] };
}

export function personaToPrompt(persona: Persona): string {
  const lines = [`User persona: ${persona.description}`];
  if (persona.behaviors.length > 0) {
    lines.push("Behaviors:");
    for (const b of persona.behaviors) {
      lines.push(`  - ${b}`);
    }
  }
  return lines.join("\n");
}

export interface VisualAssertionExpectation {
  query: string;
  min_confidence?: number;
}

export interface AccessibilityAuditExpectation {
  level?: "A" | "AA" | "AAA";
  required_pass?: boolean;
}

export interface Expectations {
  required_tools?: string[];
  forbidden_tools?: string[];
  allowed_terminal_states?: string[];
  forbidden_terminal_states?: string[];
  required_agents?: string[];
  forbidden_agents?: string[];
  required_agent_tools?: Record<string, string[]>;
  judges?: JudgeConfig[];
  visual_assertions?: VisualAssertionExpectation[];
  accessibility_audit?: AccessibilityAuditExpectation;
}

export interface JudgeConfig {
  name: string;
  rubric: string;
  samples?: number;
  model?: string;
}

import type { BrowserAgentType } from "../types";

export interface AgentConfig {
  type: BrowserAgentType;
  model?: string;
  headless?: boolean;
  timeout?: number;
}

export interface TargetConfig {
  url: string;
  selector?: string;
}

export interface Scene {
  id: string;
  description?: string;
  starting_prompt: string;
  conversation_plan: string;
  persona: Persona | PersonaPreset;
  max_turns?: number;
  context?: Record<string, unknown>;
  expectations?: Expectations;
}

export interface AgentScene {
  id: string;
  description?: string;
  agent: AgentConfig;
  target: TargetConfig;
  goal: string;
  persona?: Persona | PersonaPreset;
  max_turns?: number;
  context?: Record<string, unknown>;
  expectations?: Expectations;
}

export function resolvePersona(persona: Persona | PersonaPreset | string): Persona {
  if (typeof persona === "string") {
    return personaFromPreset(persona as PersonaPreset);
  }
  return persona;
}

export interface ToolCall {
  tool_name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  timestamp?: string;
  error?: string;
  agent_name?: string;
}

export interface Turn {
  role: "user" | "agent";
  content: string;
  tool_calls: ToolCall[];
  timestamp?: string;
  agent_name?: string;
}

export interface Trace {
  scene_id: string;
  turns: Turn[];
  terminal_state?: string;
  started_at?: string;
  finished_at?: string;
  metadata?: Record<string, unknown>;
}

export function traceToolCalls(trace: Trace): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const turn of trace.turns) {
    calls.push(...turn.tool_calls);
  }
  return calls;
}

export function traceCallSequence(trace: Trace): string[] {
  return traceToolCalls(trace).map((c) => c.tool_name);
}

export function traceAgentsInvoked(trace: Trace): string[] {
  const agents = new Set<string>();
  for (const turn of trace.turns) {
    if (turn.agent_name) agents.add(turn.agent_name);
    for (const call of turn.tool_calls) {
      if (call.agent_name) agents.add(call.agent_name);
    }
  }
  return Array.from(agents).sort();
}

export function traceAgentCalled(trace: Trace, agent: string, tool: string): boolean {
  return traceToolCalls(trace).some((c) => c.agent_name === agent && c.tool_name === tool);
}

export function traceConversationText(trace: Trace): string {
  const lines: string[] = [];
  for (const turn of trace.turns) {
    let prefix = turn.role === "user" ? "[USER]" : "[AGENT]";
    if (turn.agent_name) {
      prefix = `[${turn.agent_name.toUpperCase()}]`;
    }
    lines.push(`${prefix}: ${turn.content}`);
    for (const call of turn.tool_calls) {
      lines.push(`  -> ${call.tool_name}(${JSON.stringify(call.arguments)})`);
      if (call.result !== undefined) {
        let resultStr = String(call.result);
        if (resultStr.length > 200) {
          resultStr = resultStr.slice(0, 200) + "...";
        }
        lines.push(`  <- ${resultStr}`);
      }
    }
  }
  return lines.join("\n");
}
