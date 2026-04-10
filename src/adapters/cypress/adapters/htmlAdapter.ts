/**
 * HTML-based browser adapter that captures cleaned HTML and uses LLM for analysis.
 * More token-efficient than vision (smaller than images) while preserving DOM structure.
 * Routes LLM calls through Cypress tasks to Node.js for multi-provider support via Vercel AI SDK.
 */

import type {
  AffordanceSnapshot,
  AwaitSettledOptions,
  BrowserSimAction,
  TranscriptTurn,
  UIActionTarget,
} from "../../../types";
import type { CypressBrowserAdapter, HtmlCleanupOptions } from "../../types";

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

function cleanHtml(html: string, options: HtmlCleanupOptions = {}): string {
  const {
    removeScripts = true,
    removeStyles = true,
    removeComments = true,
    preserveDataAttributes = true,
    removeHiddenElements = true,
  } = options;

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  if (removeScripts) {
    doc.querySelectorAll("script, noscript").forEach((el) => el.remove());
  }

  if (removeStyles) {
    doc.querySelectorAll("style, link[rel='stylesheet']").forEach((el) =>
      el.remove()
    );
  }

  if (removeComments) {
    const walker = document.createTreeWalker(
      doc.body,
      NodeFilter.SHOW_COMMENT,
      null
    );
    const comments: Comment[] = [];
    while (walker.nextNode()) {
      comments.push(walker.currentNode as Comment);
    }
    comments.forEach((comment) => comment.remove());
  }

  if (removeHiddenElements) {
    doc
      .querySelectorAll('[style*="display: none"], [style*="visibility: hidden"], [hidden]')
      .forEach((el) => el.remove());
  }

  if (!preserveDataAttributes) {
    doc.querySelectorAll("*").forEach((el) => {
      Array.from(el.attributes)
        .filter((attr) => attr.name.startsWith("data-"))
        .forEach((attr) => el.removeAttribute(attr.name));
    });
  }

  doc.querySelectorAll("*").forEach((el) => {
    const attrsToRemove = ["class", "style"];
    if (!preserveDataAttributes) {
      attrsToRemove.push(
        ...Array.from(el.attributes)
          .filter((a) => a.name.startsWith("data-"))
          .map((a) => a.name)
      );
    }
    attrsToRemove.forEach((attr) => {
      if (attr === "class" || attr === "style") {
        el.removeAttribute(attr);
      }
    });
  });

  return doc.body.innerHTML;
}


export function createHtmlAdapter(
  config: HtmlAdapterConfig
): CypressBrowserAdapter {
  const inputSelector =
    config.inputSelector ||
    'input[type="text"], textarea, [contenteditable="true"]';
  const sendSelector =
    config.sendSelector || 'button[type="submit"], button:contains("Send")';
  const waitForIdleMs = config.waitForIdleMs || 2000;
  const maxHtmlLength = config.maxHtmlLength || 50000;
  const containerSelector = config.containerSelector || "body";

  return {
    captureSnapshot(): Cypress.Chainable<AffordanceSnapshot> {
      return cy.get(containerSelector).then(($container) => {
        const rawHtml = $container.html();
        let cleanedHtml = cleanHtml(rawHtml, config.htmlCleanupOptions);

        if (cleanedHtml.length > maxHtmlLength) {
          cleanedHtml = cleanedHtml.substring(0, maxHtmlLength) + "...";
        }

        const llmConfig = { model: config.model, temperature: 0, maxTokens: 2048 };

        if (config.mode === "screenshot") {
          return cy
            .screenshot({ capture: "viewport" })
            .then((details: unknown) => {
              const screenshotDetails = details as { path: string };
              return cy
                .readFile(screenshotDetails.path, "base64")
                .then((imageBase64: string) => {
                  return cy
                    .task("mimiq:llm:completeWithImage", {
                      prompt: HYBRID_EXTRACTION_PROMPT,
                      imageBase64,
                      config: llmConfig,
                    })
                    .then((response: unknown) => {
                      const result = parseAnalysisResponse(response as string);
                      const snapshot: AffordanceSnapshot = {
                        url: window.location.href,
                        transcript: result.transcript,
                        availableActions: result.availableActions,
                        availableUserTools: [],
                        stateMarkers: result.stateMarkers,
                        metadata: { mode: "screenshot" },
                      };
                      return snapshot;
                    });
                });
            }) as unknown as Cypress.Chainable<AffordanceSnapshot>;
        }

        if (config.mode === "hybrid") {
          return cy
            .screenshot({ capture: "viewport" })
            .then((details: unknown) => {
              const screenshotDetails = details as { path: string };
              return cy
                .readFile(screenshotDetails.path, "base64")
                .then((imageBase64: string) => {
                  return cy
                    .task("mimiq:llm:completeWithHtmlAndImage", {
                      prompt: HYBRID_EXTRACTION_PROMPT,
                      html: cleanedHtml,
                      imageBase64,
                      config: llmConfig,
                    })
                    .then((response: unknown) => {
                      const result = parseAnalysisResponse(response as string);
                      const snapshot: AffordanceSnapshot = {
                        url: window.location.href,
                        transcript: result.transcript,
                        availableActions: result.availableActions,
                        availableUserTools: [],
                        stateMarkers: result.stateMarkers,
                        metadata: {
                          mode: "hybrid",
                          htmlLength: cleanedHtml.length,
                        },
                      };
                      return snapshot;
                    });
                });
            }) as unknown as Cypress.Chainable<AffordanceSnapshot>;
        }

        return cy
          .task("mimiq:llm:complete", {
            prompt: `${HTML_EXTRACTION_PROMPT}\n\n${cleanedHtml}`,
            config: llmConfig,
          })
          .then((response: unknown) => {
            const result = parseAnalysisResponse(response as string);
            const snapshot: AffordanceSnapshot = {
              url: window.location.href,
              transcript: result.transcript,
              availableActions: result.availableActions,
              availableUserTools: [],
              stateMarkers: result.stateMarkers,
              metadata: { mode: "html", htmlLength: cleanedHtml.length },
            };
            return snapshot;
          }) as unknown as Cypress.Chainable<AffordanceSnapshot>;
      }) as unknown as Cypress.Chainable<AffordanceSnapshot>;
    },

    executeAction(action: BrowserSimAction): Cypress.Chainable<void> {
      switch (action.kind) {
        case "message":
          return cy
            .get(inputSelector)
            .first()
            .clear()
            .type(action.text)
            .then(() => {
              cy.get(sendSelector).first().click();
            }) as unknown as Cypress.Chainable<void>;

        case "click":
          return cy
            .contains(action.targetId.replace(/-/g, " "))
            .click()
            .then(() => {}) as unknown as Cypress.Chainable<void>;

        case "type":
          return cy
            .get(inputSelector)
            .first()
            .clear()
            .type(action.text)
            .then(() => {}) as unknown as Cypress.Chainable<void>;

        case "select":
          return cy
            .get("select")
            .select(action.value)
            .then(() => {}) as unknown as Cypress.Chainable<void>;

        case "upload":
          return cy
            .get('input[type="file"]')
            .selectFile(action.fileRef, { force: true })
            .then(() => {}) as unknown as Cypress.Chainable<void>;

        case "navigate":
          if (action.url) {
            return cy
              .visit(action.url)
              .then(() => {}) as unknown as Cypress.Chainable<void>;
          }
          throw new Error("Navigate action requires url");
      }
    },

    awaitSettled(options?: AwaitSettledOptions): Cypress.Chainable<void> {
      const timeout = options?.timeoutMs ?? waitForIdleMs;
      return cy
        .wait(timeout)
        .then(() => {}) as unknown as Cypress.Chainable<void>;
    },

    assertHealthy(): Cypress.Chainable<void> {
      return cy
        .get(containerSelector)
        .should("exist")
        .then(() => {}) as unknown as Cypress.Chainable<void>;
    },

    captureScreenshot(): Cypress.Chainable<string> {
      return cy.screenshot({ capture: "viewport", overwrite: true }).then(() => {
        return cy.task("mimiq:getLastScreenshot", {}, { log: false });
      }) as unknown as Cypress.Chainable<string>;
    },
  };
}

export { type HtmlCleanupOptions };
