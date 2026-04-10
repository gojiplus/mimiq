import {
  createDefaultChatAdapter,
  createHtmlAdapter,
  createVisionAdapter,
  registerMimiqCommands,
  type BrowserAdapter,
} from "@gojiplus/mimiq";

type AdapterMode = "default" | "html" | "hybrid" | "vision";

const ADAPTER_MODE = (Cypress.env("ADAPTER_MODE") || "default") as AdapterMode;

function createAdapter(): BrowserAdapter {
  switch (ADAPTER_MODE) {
    case "html":
      return createHtmlAdapter({
        mode: "html",
        inputSelector: '[data-test="chat-input"]',
        sendSelector: '[data-test="send-button"]',
        containerSelector: '[data-test="transcript"]',
      });

    case "hybrid":
      return createHtmlAdapter({
        mode: "hybrid",
        inputSelector: '[data-test="chat-input"]',
        sendSelector: '[data-test="send-button"]',
        containerSelector: '[data-test="transcript"]',
      });

    case "vision":
      return createVisionAdapter({
        inputSelector: '[data-test="chat-input"]',
        sendSelector: '[data-test="send-button"]',
      });

    default:
      return createDefaultChatAdapter({
        transcript: '[data-test="transcript"]',
        messageRow: '[data-test="message-row"]',
        messageRoleAttr: "data-role",
        messageText: '[data-test="message-text"]',
        input: '[data-test="chat-input"]',
        send: '[data-test="send-button"]',
        idleMarker: '[data-test="agent-idle"]',
        workingMarker: '[data-test="agent-working"]',
        toolCallsSelector: '[data-test="tool-calls"]',
        actionTargets: {
          "track-order": '[data-test="track-order"]',
          "start-return": '[data-test="start-return"]',
        },
      });
  }
}

const browserAdapter = createAdapter();

registerMimiqCommands({
  browserAdapter,
  defaults: {
    maxTurns: 15,
    settleTimeoutMs: 30000,
  },
});
