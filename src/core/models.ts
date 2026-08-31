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
import type { SimulatorConfig as SceneSimulatorConfig } from "./simulatorInterface";

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
  simulator?: SceneSimulatorConfig;
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
    if (!(persona in PERSONA_PRESETS)) {
      throw new Error(
        `Unknown persona preset "${persona}". Expected one of: ${Object.keys(PERSONA_PRESETS).join(", ")}`,
      );
    }
    return personaFromPreset(persona as PersonaPreset);
  }

  if (
    typeof persona.description !== "string" ||
    !Array.isArray(persona.behaviors) ||
    !persona.behaviors.every((behavior) => typeof behavior === "string")
  ) {
    throw new Error("Persona must provide a string description and an array of string behaviors.");
  }

  return persona;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateStringList(
  errors: string[],
  value: unknown,
  name: string,
): void {
  if (value !== undefined && (!Array.isArray(value) || !value.every((item) => typeof item === "string"))) {
    errors.push(`${name} must be an array of strings.`);
  }
}

export function validateScene(scene: unknown): asserts scene is Scene {
  if (!isRecord(scene)) {
    throw new Error("Scene must be an object.");
  }

  const errors: string[] = [];
  if (typeof scene.id !== "string" || scene.id.trim() === "") {
    errors.push("id must be a non-empty string.");
  }
  if (typeof scene.starting_prompt !== "string" || scene.starting_prompt.trim() === "") {
    errors.push("starting_prompt must be a non-empty string.");
  }
  if (typeof scene.conversation_plan !== "string" || scene.conversation_plan.trim() === "") {
    errors.push("conversation_plan must be a non-empty string.");
  }
  if (scene.persona === undefined) {
    errors.push("persona is required.");
  } else {
    try {
      resolvePersona(scene.persona as Persona | PersonaPreset | string);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (
    scene.max_turns !== undefined &&
    (!Number.isInteger(scene.max_turns) || (scene.max_turns as number) < 1)
  ) {
    errors.push("max_turns must be a positive integer.");
  }
  if (scene.context !== undefined && !isRecord(scene.context)) {
    errors.push("context must be an object.");
  }

  if (scene.simulator !== undefined) {
    if (!isRecord(scene.simulator)) {
      errors.push("simulator must be an object.");
    } else {
      if (scene.simulator.type !== "llm" && scene.simulator.type !== "browser-use") {
        errors.push("simulator.type must be \"llm\" or \"browser-use\".");
      }
      if (scene.simulator.model !== undefined && typeof scene.simulator.model !== "string") {
        errors.push("simulator.model must be a string.");
      }
      if (scene.simulator.options !== undefined && !isRecord(scene.simulator.options)) {
        errors.push("simulator.options must be an object.");
      }
    }
  }

  if (scene.expectations !== undefined) {
    if (!isRecord(scene.expectations)) {
      errors.push("expectations must be an object.");
    } else {
      const expectations = scene.expectations;
      for (const name of [
        "required_tools",
        "forbidden_tools",
        "allowed_terminal_states",
        "forbidden_terminal_states",
        "required_agents",
        "forbidden_agents",
      ]) {
        validateStringList(errors, expectations[name], `expectations.${name}`);
      }
      if (expectations.required_agent_tools !== undefined) {
        if (!isRecord(expectations.required_agent_tools)) {
          errors.push("expectations.required_agent_tools must be an object.");
        } else {
          for (const [agent, tools] of Object.entries(expectations.required_agent_tools)) {
            validateStringList(errors, tools, `expectations.required_agent_tools.${agent}`);
          }
        }
      }
      if (expectations.judges !== undefined) {
        if (!Array.isArray(expectations.judges)) {
          errors.push("expectations.judges must be an array.");
        } else {
          for (const [index, judge] of expectations.judges.entries()) {
            if (!isRecord(judge) || typeof judge.name !== "string" || typeof judge.rubric !== "string") {
              errors.push(`expectations.judges.${index} must provide string name and rubric fields.`);
            } else if (
              judge.samples !== undefined &&
              (!Number.isInteger(judge.samples) || (judge.samples as number) < 1)
            ) {
              errors.push(`expectations.judges.${index}.samples must be a positive integer.`);
            }
          }
        }
      }
      if (expectations.visual_assertions !== undefined) {
        if (!Array.isArray(expectations.visual_assertions)) {
          errors.push("expectations.visual_assertions must be an array.");
        } else {
          for (const [index, assertion] of expectations.visual_assertions.entries()) {
            if (!isRecord(assertion) || typeof assertion.query !== "string" || assertion.query.trim() === "") {
              errors.push(`expectations.visual_assertions.${index}.query must be a non-empty string.`);
            } else if (
              assertion.min_confidence !== undefined &&
              (typeof assertion.min_confidence !== "number" ||
                !Number.isFinite(assertion.min_confidence) ||
                assertion.min_confidence < 0 ||
                assertion.min_confidence > 1)
            ) {
              errors.push(`expectations.visual_assertions.${index}.min_confidence must be between 0 and 1.`);
            }
          }
        }
      }
      if (expectations.accessibility_audit !== undefined) {
        if (!isRecord(expectations.accessibility_audit)) {
          errors.push("expectations.accessibility_audit must be an object.");
        } else if (
          expectations.accessibility_audit.level !== undefined &&
          !["A", "AA", "AAA"].includes(expectations.accessibility_audit.level as string)
        ) {
          errors.push("expectations.accessibility_audit.level must be \"A\", \"AA\", or \"AAA\".");
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid scene:\n- ${errors.join("\n- ")}`);
  }
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
