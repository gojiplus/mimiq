/**
 * Vision-based browser adapter for Playwright using LLM vision capabilities.
 * Analyzes screenshots to extract UI state without requiring data-test selectors.
 */

import type { Page } from "@playwright/test";
import type {
  AffordanceSnapshot,
  AwaitSettledOptions,
  BrowserSimAction,
  TranscriptTurn,
  UIActionTarget,
} from "../../../types";
import type { PlaywrightBrowserAdapter } from "../../types";
import { completeWithImage } from "../../../core/llm";

const VISION_EXTRACTION_PROMPT = `You are analyzing a screenshot of a chat/support interface.

Extract the following information as JSON:

1. **transcript**: Array of messages visible in the chat. For each message:
   - role: "user" or "assistant"
   - text: the message content

2. **availableActions**: Array of interactive elements the user can use:
   - id: a unique identifier you create (e.g., "send-button", "input-field", "track-order-btn")
   - kind: one of "message", "click", "type", "select"
   - label: the visible text or description
   - enabled: true if the element appears clickable/usable

3. **stateMarkers**: Array of strings describing UI state:
   - Include "agent-idle" if the agent appears ready (no loading indicators)
   - Include "agent-busy" if there's a loading/typing indicator
   - Include any other relevant state observations

4. **agentMessage**: If there's a new/latest message from the assistant, extract its full text.

Respond with ONLY valid JSON, no markdown or explanation:
{
  "transcript": [...],
  "availableActions": [...],
  "stateMarkers": [...],
  "agentMessage": "..." or null
}`;

export interface VisionAdapterConfig {
  model?: string;
  inputSelector?: string;
  sendSelector?: string;
  waitForIdleMs?: number;
}

interface VisionAnalysisResult {
  transcript: TranscriptTurn[];
  availableActions: UIActionTarget[];
  stateMarkers: string[];
}

function parseAnalysisResponse(text: string): VisionAnalysisResult {
  const jsonMatch =
    text.match(/```json\s*([\s\S]*?)\s*```/) ||
    text.match(/```\s*([\s\S]*?)\s*```/) ||
    [null, text];
  const jsonStr = jsonMatch[1] || text;

  try {
    const parsed = JSON.parse(jsonStr.trim());
    return {
      transcript: parsed.transcript || [],
      availableActions: parsed.availableActions || [],
      stateMarkers: parsed.stateMarkers || [],
    };
  } catch {
    console.error("Failed to parse vision response:", text);
    return {
      transcript: [],
      availableActions: [],
      stateMarkers: ["parse-error"],
    };
  }
}

export function createVisionAdapter(
  page: Page,
  config: VisionAdapterConfig = {},
): PlaywrightBrowserAdapter {
  const inputSelector = config.inputSelector || 'input[type="text"], textarea, [contenteditable="true"]';
  const sendSelector = config.sendSelector || 'button[type="submit"], button:has-text("Send")';
  const waitForIdleMs = config.waitForIdleMs || 2000;

  return {
    async captureSnapshot(): Promise<AffordanceSnapshot> {
      const screenshotBuffer = await page.screenshot({ type: "png" });
      const imageBase64 = screenshotBuffer.toString("base64");

      const response = await completeWithImage(
        VISION_EXTRACTION_PROMPT,
        imageBase64,
        { model: config.model, temperature: 0, maxTokens: 2048 },
      );

      const result = parseAnalysisResponse(response);
      const snapshot: AffordanceSnapshot = {
        url: page.url(),
        transcript: result.transcript,
        availableActions: result.availableActions,
        availableUserTools: [],
        stateMarkers: result.stateMarkers,
      };

      return snapshot;
    },

    async executeAction(action: BrowserSimAction): Promise<void> {
      switch (action.kind) {
        case "message": {
          const input = page.locator(inputSelector).first();
          await input.clear();
          await input.fill(action.text);
          await page.locator(sendSelector).first().click();
          break;
        }

        case "click": {
          await page.getByText(action.targetId.replace(/-/g, " ")).click();
          break;
        }

        case "type": {
          const input = page.locator(inputSelector).first();
          await input.clear();
          await input.fill(action.text);
          break;
        }

        case "select": {
          await page.locator("select").selectOption(action.value);
          break;
        }

        case "upload": {
          await page.locator('input[type="file"]').setInputFiles(action.fileRef);
          break;
        }

        case "navigate": {
          if (action.url) {
            await page.goto(action.url);
            break;
          }
          throw new Error("Navigate action requires url");
        }
      }
    },

    async awaitSettled(options?: AwaitSettledOptions): Promise<void> {
      const timeout = options?.timeoutMs ?? waitForIdleMs;
      await page.waitForTimeout(timeout);
    },

    async assertHealthy(): Promise<void> {
      await page.screenshot({ type: "png" });
    },
  };
}
