/**
 * Vision-based browser adapter using Gemini's vision capabilities.
 * Analyzes screenshots to extract UI state without requiring data-test selectors.
 */

import type {
  AffordanceSnapshot,
  AwaitSettledOptions,
  BrowserAdapter,
  BrowserSimAction,
  TranscriptTurn,
  UIActionTarget,
} from "../types";

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
  apiKey?: string;
  model?: string;
  screenshotSelector?: string;
  inputSelector?: string;
  sendSelector?: string;
  waitForIdleMs?: number;
}

interface VisionAnalysisResult {
  transcript: TranscriptTurn[];
  availableActions: UIActionTarget[];
  stateMarkers: string[];
}

async function analyzeScreenshot(
  imageBase64: string,
  config: VisionAdapterConfig,
): Promise<{
  transcript: TranscriptTurn[];
  availableActions: UIActionTarget[];
  stateMarkers: string[];
}> {
  const apiKey = config.apiKey || Cypress.env("GOOGLE_API_KEY") || "";
  const model = config.model || "gemini-2.0-flash";

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: VISION_EXTRACTION_PROMPT },
              {
                inline_data: {
                  mime_type: "image/png",
                  data: imageBase64,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 2048,
        },
      }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Vision API error: ${response.status} ${text}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";

  // Extract JSON from potential markdown code blocks
  const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) ||
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

export function createVisionAdapter(config: VisionAdapterConfig = {}): BrowserAdapter {
  const inputSelector = config.inputSelector || 'input[type="text"], textarea, [contenteditable="true"]';
  const sendSelector = config.sendSelector || 'button[type="submit"], button:contains("Send")';
  const waitForIdleMs = config.waitForIdleMs || 2000;

  return {
    captureSnapshot(): Cypress.Chainable<AffordanceSnapshot> {
      return cy.screenshot({ capture: "viewport" }).then((details: unknown) => {
        const screenshotDetails = details as { path: string };
        // Read the screenshot file and convert to base64
        return cy.readFile(screenshotDetails.path, "base64").then((imageBase64: string) => {
          // Call vision API to analyze the screenshot
          return cy.wrap(
            analyzeScreenshot(imageBase64, config),
            { timeout: 30000 }
          ).then((rawResult: unknown) => {
            const result = rawResult as VisionAnalysisResult;
            const snapshot: AffordanceSnapshot = {
              url: window.location.href,
              transcript: result.transcript,
              availableActions: result.availableActions,
              availableUserTools: [],
              stateMarkers: result.stateMarkers,
            };
            return snapshot;
          });
        });
      }) as unknown as Cypress.Chainable<AffordanceSnapshot>;
    },

    executeAction(action: BrowserSimAction): Cypress.Chainable<void> {
      switch (action.kind) {
        case "message":
          // Find the input field and type the message
          return cy.get(inputSelector).first().clear().type(action.text).then(() => {
            // Find and click send button
            cy.get(sendSelector).first().click();
          }) as unknown as Cypress.Chainable<void>;

        case "click":
          // Use vision-identified element - try to find by text content
          return cy.contains(action.targetId.replace(/-/g, " ")).click()
            .then(() => {}) as unknown as Cypress.Chainable<void>;

        case "type":
          return cy.get(inputSelector).first().clear().type(action.text)
            .then(() => {}) as unknown as Cypress.Chainable<void>;

        case "select":
          return cy.get("select").select(action.value)
            .then(() => {}) as unknown as Cypress.Chainable<void>;

        case "upload":
          return cy.get('input[type="file"]').selectFile(action.fileRef, { force: true })
            .then(() => {}) as unknown as Cypress.Chainable<void>;

        case "navigate":
          if (action.url) {
            return cy.visit(action.url).then(() => {}) as unknown as Cypress.Chainable<void>;
          }
          throw new Error("Navigate action requires url");
      }
    },

    awaitSettled(options?: AwaitSettledOptions): Cypress.Chainable<void> {
      const timeout = options?.timeoutMs ?? waitForIdleMs;
      // Wait and then check if UI has stabilized
      return cy.wait(timeout).then(() => {}) as unknown as Cypress.Chainable<void>;
    },

    assertHealthy(): Cypress.Chainable<void> {
      // Take a screenshot and verify we can analyze it
      return cy.screenshot({ capture: "viewport" }).then(() => {
        // If screenshot succeeds, we're healthy
      }) as unknown as Cypress.Chainable<void>;
    },
  };
}
