/**
 * HTML-based browser adapter for Playwright that captures cleaned HTML and uses LLM for analysis.
 * More token-efficient than vision while preserving DOM structure.
 */

import type { Page } from "@playwright/test";
import type {
  AffordanceSnapshot,
  AwaitSettledOptions,
  BrowserSimAction,
  TranscriptTurn,
  UIActionTarget,
} from "../../../types";
import type { PlaywrightBrowserAdapter, HtmlCleanupOptions } from "../../types";
import { complete, completeWithImage, completeWithHtmlAndImage } from "../../../core/llm";

export interface HtmlAdapterConfig {
  mode: "html" | "screenshot" | "hybrid";
  model?: string;
  htmlCleanupOptions?: HtmlCleanupOptions;
  maxHtmlLength?: number;
  inputSelector?: string;
  sendSelector?: string;
  waitForIdleMs?: number;
  containerSelector?: string;
}

interface HtmlAnalysisResult {
  transcript: TranscriptTurn[];
  availableActions: UIActionTarget[];
  stateMarkers: string[];
}

const HTML_EXTRACTION_PROMPT = `You are analyzing the HTML of a chat/support interface.

Extract the following information as JSON:

1. **transcript**: Array of messages visible in the chat. For each message:
   - role: "user" or "assistant"
   - text: the message content

2. **availableActions**: Array of interactive elements the user can use:
   - id: a unique identifier based on data attributes, id, or semantic meaning (e.g., "send-button", "chat-input", "track-order-btn")
   - kind: one of "message", "click", "type", "select"
   - label: the visible text, aria-label, or placeholder
   - enabled: true if the element is not disabled

3. **stateMarkers**: Array of strings describing UI state:
   - Include "agent-idle" if the agent appears ready (no loading indicators visible)
   - Include "agent-busy" if there's a loading/typing indicator
   - Include any other relevant state observations (e.g., "form-visible", "error-displayed")

Look for:
- Chat messages in elements with roles like "user"/"assistant" or data attributes
- Input fields (input, textarea, contenteditable elements)
- Buttons, especially submit/send buttons
- Loading indicators (spinners, "typing..." text, skeleton loaders)
- Form elements (select, checkbox, radio)
- Action buttons with semantic meanings (track order, start return, etc.)

Respond with ONLY valid JSON, no markdown or explanation:
{
  "transcript": [...],
  "availableActions": [...],
  "stateMarkers": [...]
}`;

const HYBRID_EXTRACTION_PROMPT = `You are analyzing both the HTML structure and a screenshot of a chat/support interface.

Use BOTH sources to extract accurate information:
- HTML provides: exact text, form values, hidden fields, ARIA labels, data attributes
- Screenshot provides: visual layout, what's actually visible, loading states

Extract the following information as JSON:

1. **transcript**: Array of messages visible in the chat. For each message:
   - role: "user" or "assistant"
   - text: the message content

2. **availableActions**: Array of interactive elements the user can use:
   - id: identifier from data-test, id attribute, or semantic meaning
   - kind: one of "message", "click", "type", "select"
   - label: the visible text or description
   - enabled: true if usable (check both HTML disabled attr and visual state)

3. **stateMarkers**: Array of strings describing UI state:
   - Include "agent-idle" if ready (no loading indicators)
   - Include "agent-busy" if loading/typing indicator visible
   - Include other observations

Respond with ONLY valid JSON:
{
  "transcript": [...],
  "availableActions": [...],
  "stateMarkers": [...]
}`;

function parseAnalysisResponse(text: string): HtmlAnalysisResult {
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
    console.error("Failed to parse analysis response:", text);
    return {
      transcript: [],
      availableActions: [],
      stateMarkers: ["parse-error"],
    };
  }
}

interface CleanHtmlParams {
  containerSelector: string;
  removeScripts: boolean;
  removeStyles: boolean;
  removeComments: boolean;
  preserveDataAttributes: boolean;
  removeHiddenElements: boolean;
}

async function cleanHtml(page: Page, containerSelector: string, options: HtmlCleanupOptions = {}): Promise<string> {
  const {
    removeScripts = true,
    removeStyles = true,
    removeComments = true,
    preserveDataAttributes = true,
    removeHiddenElements = true,
  } = options;

  const params: CleanHtmlParams = {
    containerSelector,
    removeScripts,
    removeStyles,
    removeComments,
    preserveDataAttributes,
    removeHiddenElements,
  };

  return page.evaluate((p: CleanHtmlParams) => {
    const container = document.querySelector(p.containerSelector);
    if (!container) return "";

    const clone = container.cloneNode(true) as Element;

    if (p.removeScripts) {
      clone.querySelectorAll("script, noscript").forEach((el) => el.remove());
    }

    if (p.removeStyles) {
      clone.querySelectorAll("style, link[rel='stylesheet']").forEach((el) => el.remove());
    }

    if (p.removeComments) {
      const walker = document.createTreeWalker(clone, NodeFilter.SHOW_COMMENT, null);
      const comments: Comment[] = [];
      while (walker.nextNode()) {
        comments.push(walker.currentNode as Comment);
      }
      comments.forEach((comment) => comment.remove());
    }

    if (p.removeHiddenElements) {
      clone.querySelectorAll('[style*="display: none"], [style*="visibility: hidden"], [hidden]')
        .forEach((el) => el.remove());
    }

    clone.querySelectorAll("*").forEach((el) => {
      el.removeAttribute("class");
      el.removeAttribute("style");
      if (!p.preserveDataAttributes) {
        Array.from(el.attributes)
          .filter((attr) => attr.name.startsWith("data-"))
          .forEach((attr) => el.removeAttribute(attr.name));
      }
    });

    return clone.innerHTML;
  }, params);
}

export function createHtmlAdapter(
  page: Page,
  config: HtmlAdapterConfig,
): PlaywrightBrowserAdapter {
  const inputSelector = config.inputSelector || 'input[type="text"], textarea, [contenteditable="true"]';
  const sendSelector = config.sendSelector || 'button[type="submit"], button:has-text("Send")';
  const waitForIdleMs = config.waitForIdleMs || 2000;
  const maxHtmlLength = config.maxHtmlLength || 50000;
  const containerSelector = config.containerSelector || "body";

  return {
    async captureSnapshot(): Promise<AffordanceSnapshot> {
      let cleanedHtml = await cleanHtml(page, containerSelector, config.htmlCleanupOptions);

      if (cleanedHtml.length > maxHtmlLength) {
        cleanedHtml = cleanedHtml.substring(0, maxHtmlLength) + "...";
      }

      const llmConfig = { model: config.model, temperature: 0, maxTokens: 2048 };

      if (config.mode === "screenshot") {
        const screenshotBuffer = await page.screenshot({ type: "png" });
        const imageBase64 = screenshotBuffer.toString("base64");

        const response = await completeWithImage(
          HYBRID_EXTRACTION_PROMPT,
          imageBase64,
          llmConfig,
        );

        const result = parseAnalysisResponse(response);
        return {
          url: page.url(),
          transcript: result.transcript,
          availableActions: result.availableActions,
          availableUserTools: [],
          stateMarkers: result.stateMarkers,
          metadata: { mode: "screenshot" },
        };
      }

      if (config.mode === "hybrid") {
        const screenshotBuffer = await page.screenshot({ type: "png" });
        const imageBase64 = screenshotBuffer.toString("base64");

        const response = await completeWithHtmlAndImage(
          HYBRID_EXTRACTION_PROMPT,
          cleanedHtml,
          imageBase64,
          llmConfig,
        );

        const result = parseAnalysisResponse(response);
        return {
          url: page.url(),
          transcript: result.transcript,
          availableActions: result.availableActions,
          availableUserTools: [],
          stateMarkers: result.stateMarkers,
          metadata: { mode: "hybrid", htmlLength: cleanedHtml.length },
        };
      }

      const response = await complete(
        `${HTML_EXTRACTION_PROMPT}\n\n${cleanedHtml}`,
        llmConfig,
      );

      const result = parseAnalysisResponse(response);
      return {
        url: page.url(),
        transcript: result.transcript,
        availableActions: result.availableActions,
        availableUserTools: [],
        stateMarkers: result.stateMarkers,
        metadata: { mode: "html", htmlLength: cleanedHtml.length },
      };
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
      await page.locator(containerSelector).waitFor({ state: "visible" });
    },
  };
}

export { type HtmlCleanupOptions };
