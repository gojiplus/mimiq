/**
 * browser-use based simulator.
 * Uses browser-use Python library via HTTP bridge for autonomous browser automation.
 */

import type { Scene } from "../core/models";
import type { AffordanceSnapshot } from "../types";
import type { SimulatorInterface, SimulatorResult } from "../core/simulatorInterface";

export interface BrowserUseSimulatorOptions {
  apiUrl?: string;
  model?: string;
  timeout?: number;
}

/**
 * Simulator that uses browser-use for autonomous browser automation.
 * Requires a running browser-use HTTP bridge service.
 */
export class BrowserUseSimulator implements SimulatorInterface {
  private scene: Scene;
  private options: Required<BrowserUseSimulatorOptions>;
  private maxTurns: number;
  private startingPrompt: string;
  private sessionId: string | null = null;
  private turnCount: number = 0;

  constructor(scene: Scene, options: BrowserUseSimulatorOptions = {}) {
    this.scene = scene;
    this.options = {
      apiUrl: options.apiUrl || process.env.BROWSER_USE_API_URL || "http://localhost:8000",
      model: options.model || process.env.BROWSER_USE_MODEL || "gpt-4o",
      timeout: options.timeout || 30000,
    };
    this.maxTurns = scene.max_turns ?? 15;
    this.startingPrompt = scene.starting_prompt;
  }

  async nextTurn(snapshot: AffordanceSnapshot): Promise<SimulatorResult> {
    if (this.turnCount === 0) {
      this.turnCount++;
      await this.initSession(snapshot);
      return { kind: "message", text: this.startingPrompt };
    }

    try {
      const action = await this.getNextAction(snapshot);
      this.turnCount++;
      return action;
    } catch (error) {
      console.error("browser-use error:", error);
      return { kind: "done", reason: `browser-use error: ${error}` };
    }
  }

  private async initSession(snapshot: AffordanceSnapshot): Promise<void> {
    const response = await fetch(`${this.options.apiUrl}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        goal: this.scene.conversation_plan,
        starting_url: snapshot.url,
        model: this.options.model,
        max_steps: this.maxTurns,
      }),
      signal: AbortSignal.timeout(this.options.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to init browser-use session: ${response.statusText}`);
    }

    const data = await response.json();
    this.sessionId = data.session_id;
  }

  private async getNextAction(snapshot: AffordanceSnapshot): Promise<SimulatorResult> {
    if (!this.sessionId) {
      throw new Error("No active browser-use session");
    }

    const lastAgentMessage = [...snapshot.transcript]
      .reverse()
      .find((t) => t.role === "assistant");

    const response = await fetch(`${this.options.apiUrl}/session/${this.sessionId}/step`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        current_url: snapshot.url,
        page_content: snapshot.transcript.map((t) => `${t.role}: ${t.text}`).join("\n"),
        last_agent_message: lastAgentMessage?.text,
        available_actions: snapshot.availableActions,
        state_markers: snapshot.stateMarkers,
      }),
      signal: AbortSignal.timeout(this.options.timeout),
    });

    if (!response.ok) {
      throw new Error(`browser-use step failed: ${response.statusText}`);
    }

    const data = await response.json();
    return this.parseResponse(data);
  }

  private parseResponse(data: Record<string, unknown>): SimulatorResult {
    if (data.done || data.completed) {
      return { kind: "done", reason: data.reason as string | undefined };
    }

    const actionType = data.action_type || data.type;

    switch (actionType) {
      case "click":
        return {
          kind: "click",
          targetId: String(data.target || data.selector || data.element_id),
        };

      case "type":
      case "input":
        return {
          kind: "type",
          targetId: String(data.target || data.selector || "chat-input"),
          text: String(data.text || data.value),
          clearFirst: Boolean(data.clear_first),
        };

      case "select":
        return {
          kind: "select",
          targetId: String(data.target || data.selector),
          value: String(data.value),
        };

      case "navigate":
      case "goto":
        return {
          kind: "navigate",
          url: String(data.url),
        };

      case "message":
      case "send_message":
        return {
          kind: "message",
          text: String(data.text || data.message),
        };

      default:
        if (data.text || data.message) {
          return { kind: "message", text: String(data.text || data.message) };
        }
        return { kind: "done", reason: "Unknown action type" };
    }
  }

  getMaxTurns(): number {
    return this.maxTurns;
  }

  getStartingPrompt(): string {
    return this.startingPrompt;
  }

  async cleanup(): Promise<void> {
    if (this.sessionId) {
      try {
        await fetch(`${this.options.apiUrl}/session/${this.sessionId}`, {
          method: "DELETE",
          signal: AbortSignal.timeout(5000),
        });
      } catch {
        // Ignore cleanup errors
      }
      this.sessionId = null;
    }
  }
}
