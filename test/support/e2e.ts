import {
  createDefaultChatAdapter,
  registerMimiqCommands,
} from "../../src";

const chatAdapter = createDefaultChatAdapter({
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

registerMimiqCommands({
  browserAdapter: chatAdapter,
  defaults: {
    maxTurns: 15,
    settleTimeoutMs: 30000,
  },
});
