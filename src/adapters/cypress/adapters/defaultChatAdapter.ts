import type {
  AgentToolCall,
  AffordanceSnapshot,
  AwaitSettledOptions,
  BrowserSimAction,
  JsonObject,
  JsonValue,
  TranscriptTurn,
  UIActionTarget,
  UserToolAvailability,
} from "../../../types";
import type { CypressBrowserAdapter, Selector } from "../../types";

export interface DefaultChatAdapterConfig {
  transcript: Selector;
  messageRow: Selector;
  messageRoleAttr: string;
  messageText: Selector;
  input: Selector;
  send: Selector;
  idleMarker: Selector;
  workingMarker?: Selector;
  toolCallsSelector?: Selector;
  actionTargets?: Record<string, Selector>;
  availableUserTools?: () => UserToolAvailability[];
  snapshotMetadata?: () => Record<string, string | number | boolean | null>;
}

function toTranscript(
  $rows: JQuery<HTMLElement>,
  messageRoleAttr: string,
  messageText: Selector,
): TranscriptTurn[] {
  return Array.from($rows).map((row, index) => {
    const $row = Cypress.$(row);
    const role = ($row.attr(messageRoleAttr) ?? "assistant") as TranscriptTurn["role"];
    const text = $row.find(messageText).text().trim();

    return {
      id: String(index + 1),
      role,
      text,
    };
  });
}

function toActionTargets(config: DefaultChatAdapterConfig): UIActionTarget[] {
  const entries = Object.entries(config.actionTargets ?? {});
  return entries.map(([id, selector]) => {
    const $el = Cypress.$(selector);
    return {
      id,
      kind: "click" as const,
      label: $el.text().trim() || id,
      enabled: $el.length > 0 && !$el.is(":disabled"),
    };
  });
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseToolCalls(text: string): AgentToolCall[] {
  const value: unknown = JSON.parse(text);
  if (!Array.isArray(value)) {
    throw new Error("Tool-call payload must be a JSON array.");
  }

  return value.map((toolCall, index) => {
    if (!isJsonObject(toolCall) || typeof toolCall.name !== "string" || !isJsonObject(toolCall.args)) {
      throw new Error(`Tool call at index ${index} must provide a name and object args.`);
    }
    return {
      ...(typeof toolCall.id === "string" ? { id: toolCall.id } : {}),
      name: toolCall.name,
      args: toolCall.args,
      result: toolCall.result as JsonValue | undefined,
    };
  });
}

export function createDefaultChatAdapter(
  config: DefaultChatAdapterConfig,
): CypressBrowserAdapter {
  return {
    captureSnapshot(): Cypress.Chainable<AffordanceSnapshot> {
      return cy.get(config.transcript).then(($transcript) => {
        const $rows = $transcript.find(config.messageRow);
        const transcript = toTranscript($rows, config.messageRoleAttr, config.messageText);
        const availableActions: UIActionTarget[] = [
          {
            id: "chat-input",
            kind: "message",
            label: "Chat input",
            enabled: Cypress.$(config.input).length > 0,
          },
          ...toActionTargets(config),
        ];

        let toolCalls: AgentToolCall[] = [];
        if (config.toolCallsSelector) {
          const $toolCalls = Cypress.$(config.toolCallsSelector);
          if ($toolCalls.length > 0) {
            toolCalls = parseToolCalls($toolCalls.text() || "[]");
          }
        }

        const snapshot: AffordanceSnapshot = {
          url: window.location.href,
          transcript,
          availableActions,
          availableUserTools: config.availableUserTools?.() ?? [],
          stateMarkers: [
            Cypress.$(config.idleMarker).length > 0 ? "agent-idle" : "agent-busy",
          ],
          metadata: {
            ...config.snapshotMetadata?.(),
            toolCalls,
          },
        };

        return snapshot;
      }) as unknown as Cypress.Chainable<AffordanceSnapshot>;
    },

    executeAction(action: BrowserSimAction): Cypress.Chainable<void> {
      switch (action.kind) {
        case "message":
          return cy.get(config.input).clear().type(action.text).then(() => {
            cy.get(config.send).click();
          }) as unknown as Cypress.Chainable<void>;

        case "click": {
          const selector = config.actionTargets?.[action.targetId];
          if (!selector) {
            throw new Error(
              `No selector mapping found for semantic target "${action.targetId}"`,
            );
          }
          return cy.get(selector).click().then(() => {}) as unknown as Cypress.Chainable<void>;
        }

        case "type": {
          const selector = config.actionTargets?.[action.targetId] ?? config.input;
          const chain = action.clearFirst ? cy.get(selector).clear() : cy.get(selector);
          return chain.type(action.text).then(() => {}) as unknown as Cypress.Chainable<void>;
        }

        case "select": {
          const selector = config.actionTargets?.[action.targetId];
          if (!selector) {
            throw new Error(
              `No selector mapping found for semantic target "${action.targetId}"`,
            );
          }
          return cy.get(selector).select(action.value).then(() => {}) as unknown as Cypress.Chainable<void>;
        }

        case "upload": {
          const selector = config.actionTargets?.[action.targetId];
          if (!selector) {
            throw new Error(
              `No selector mapping found for semantic target "${action.targetId}"`,
            );
          }
          return cy.get(selector).selectFile(action.fileRef, { force: true }).then(() => {}) as unknown as Cypress.Chainable<void>;
        }

        case "navigate":
          if (action.url) {
            return cy.visit(action.url).then(() => {}) as unknown as Cypress.Chainable<void>;
          }
          if (action.targetId) {
            const selector = config.actionTargets?.[action.targetId];
            if (!selector) {
              throw new Error(
                `No selector mapping found for semantic target "${action.targetId}"`,
              );
            }
            return cy.get(selector).click().then(() => {}) as unknown as Cypress.Chainable<void>;
          }
          throw new Error("Navigate action requires either url or targetId.");
      }
    },

    awaitSettled(options?: AwaitSettledOptions): Cypress.Chainable<void> {
      const timeout = options?.timeoutMs ?? 15000;
      if (config.workingMarker) {
        cy.get("body").then(($body) => {
          if ($body.find(config.workingMarker!).length > 0) {
            cy.get(config.workingMarker!, { timeout }).should("not.exist");
          }
        });
      }
      return cy.get(config.idleMarker, { timeout }).should("exist").then(() => {}) as unknown as Cypress.Chainable<void>;
    },

    assertHealthy(): Cypress.Chainable<void> {
      return cy.get(config.transcript).should("exist").then(() => {}) as unknown as Cypress.Chainable<void>;
    },

    captureScreenshot(): Cypress.Chainable<string> {
      return cy.screenshot({ capture: "viewport", overwrite: true }).then(() => {
        return cy.task("mimiq:getLastScreenshot", {}, { log: false });
      }) as unknown as Cypress.Chainable<string>;
    },
  };
}
