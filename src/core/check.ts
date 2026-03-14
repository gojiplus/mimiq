/**
 * Check: validate a trace against scene expectations.
 * Ported from understudy Python package.
 */

import type { Expectations, Trace } from "./models";
import { traceAgentCalled, traceAgentsInvoked, traceCallSequence } from "./models";

export interface CheckItem {
  label: string;
  passed: boolean;
  detail: string;
}

export interface CheckResult {
  checks: CheckItem[];
  passed: boolean;
  failedChecks: CheckItem[];
}

export function check(trace: Trace, expectations: Expectations): CheckResult {
  const checks: CheckItem[] = [];
  const calledTools = new Set(traceCallSequence(trace));

  // Required tools
  for (const tool of expectations.required_tools ?? []) {
    checks.push({
      label: "required_tool",
      passed: calledTools.has(tool),
      detail: `${tool} ${calledTools.has(tool) ? "called" : "NOT called"}`,
    });
  }

  // Forbidden tools
  for (const tool of expectations.forbidden_tools ?? []) {
    const wasCalled = calledTools.has(tool);
    checks.push({
      label: "forbidden_tool",
      passed: !wasCalled,
      detail: `${tool} ${wasCalled ? "CALLED (violation)" : "not called"}`,
    });
  }

  // Terminal state - allowed
  if (expectations.allowed_terminal_states?.length) {
    const inAllowed = expectations.allowed_terminal_states.includes(trace.terminal_state ?? "");
    checks.push({
      label: "terminal_state",
      passed: inAllowed,
      detail: `${trace.terminal_state} (${inAllowed ? "allowed" : "NOT in allowed"})`,
    });
  }

  // Terminal state - forbidden
  if (expectations.forbidden_terminal_states?.length) {
    const inForbidden = expectations.forbidden_terminal_states.includes(trace.terminal_state ?? "");
    checks.push({
      label: "forbidden_terminal_state",
      passed: !inForbidden,
      detail: `${trace.terminal_state} ${inForbidden ? "FORBIDDEN (violation)" : "not forbidden"}`,
    });
  }

  // Required agents
  const invokedAgents = new Set(traceAgentsInvoked(trace));
  for (const agent of expectations.required_agents ?? []) {
    checks.push({
      label: "required_agent",
      passed: invokedAgents.has(agent),
      detail: `${agent} ${invokedAgents.has(agent) ? "invoked" : "NOT invoked"}`,
    });
  }

  // Forbidden agents
  for (const agent of expectations.forbidden_agents ?? []) {
    const wasInvoked = invokedAgents.has(agent);
    checks.push({
      label: "forbidden_agent",
      passed: !wasInvoked,
      detail: `${agent} ${wasInvoked ? "INVOKED (violation)" : "not invoked"}`,
    });
  }

  // Required agent tools
  for (const [agent, tools] of Object.entries(expectations.required_agent_tools ?? {})) {
    for (const tool of tools) {
      const called = traceAgentCalled(trace, agent, tool);
      checks.push({
        label: "required_agent_tool",
        passed: called,
        detail: `${agent}.${tool} ${called ? "called" : "NOT called"}`,
      });
    }
  }

  const passed = checks.every((c) => c.passed);
  const failedChecks = checks.filter((c) => !c.passed);

  return { checks, passed, failedChecks };
}

export function checkResultSummary(result: CheckResult): string {
  const lines: string[] = [];
  for (const c of result.checks) {
    const mark = c.passed ? "✓" : "✗";
    lines.push(`  ${mark} ${c.label}: ${c.detail}`);
  }
  return lines.join("\n");
}
