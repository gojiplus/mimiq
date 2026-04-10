import type { Page } from "@playwright/test";
import type {
  AffordanceSnapshot,
  AwaitSettledOptions,
  BrowserSimAction,
  TranscriptTurn,
  UIActionTarget,
  UserToolAvailability,
} from "../../../types";
import type { PlaywrightBrowserAdapter, Selector } from "../../types";

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

async function toTranscript(
  page: Page,
  transcriptSelector: Selector,
  messageRow: Selector,
  messageRoleAttr: string,
  messageText: Selector,
): Promise<TranscriptTurn[]> {
  const transcript = page.locator(transcriptSelector);
  const rows = transcript.locator(messageRow);
  const count = await rows.count();

  const turns: TranscriptTurn[] = [];
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const role = (await row.getAttribute(messageRoleAttr)) ?? "assistant";
    const textElement = row.locator(messageText);
    const text = (await textElement.textContent()) ?? "";

    turns.push({
      id: String(i + 1),
      role: role as TranscriptTurn["role"],
      text: text.trim(),
    });
  }

  return turns;
}

async function toActionTargets(
  page: Page,
  actionTargets: Record<string, Selector> | undefined,
): Promise<UIActionTarget[]> {
  if (!actionTargets) return [];

  const entries = Object.entries(actionTargets);
  const targets: UIActionTarget[] = [];

  for (const [id, selector] of entries) {
    const el = page.locator(selector).first();
    const count = await page.locator(selector).count();
    const isVisible = count > 0;
    const isDisabled = isVisible && await el.isDisabled().catch(() => false);
    const text = isVisible ? (await el.textContent()) ?? id : id;

    targets.push({
      id,
      kind: "click" as const,
      label: text.trim() || id,
      enabled: isVisible && !isDisabled,
    });
  }

  return targets;
}

export function createDefaultChatAdapter(
  page: Page,
  config: DefaultChatAdapterConfig,
): PlaywrightBrowserAdapter {
  return {
    async captureSnapshot(): Promise<AffordanceSnapshot> {
      const transcript = await toTranscript(
        page,
        config.transcript,
        config.messageRow,
        config.messageRoleAttr,
        config.messageText,
      );

      const inputCount = await page.locator(config.input).count();
      const availableActions: UIActionTarget[] = [
        {
          id: "chat-input",
          kind: "message",
          label: "Chat input",
          enabled: inputCount > 0,
        },
        ...(await toActionTargets(page, config.actionTargets)),
      ];

      let toolCalls: Array<{ name: string; args: Record<string, unknown>; result?: unknown }> = [];
      if (config.toolCallsSelector) {
        const toolCallsEl = page.locator(config.toolCallsSelector);
        const count = await toolCallsEl.count();
        if (count > 0) {
          try {
            const text = (await toolCallsEl.textContent()) || "[]";
            toolCalls = JSON.parse(text);
          } catch {
            toolCalls = [];
          }
        }
      }

      const idleMarkerCount = await page.locator(config.idleMarker).count();

      const snapshot: AffordanceSnapshot = {
        url: page.url(),
        transcript,
        availableActions,
        availableUserTools: config.availableUserTools?.() ?? [],
        stateMarkers: [idleMarkerCount > 0 ? "agent-idle" : "agent-busy"],
        metadata: {
          ...config.snapshotMetadata?.(),
          toolCalls: toolCalls as unknown as string,
        },
      };

      return snapshot;
    },

    async executeAction(action: BrowserSimAction): Promise<void> {
      switch (action.kind) {
        case "message": {
          const input = page.locator(config.input);
          await input.clear();
          await input.fill(action.text);
          await page.locator(config.send).click();
          break;
        }

        case "click": {
          const selector = config.actionTargets?.[action.targetId];
          if (!selector) {
            throw new Error(
              `No selector mapping found for semantic target "${action.targetId}"`,
            );
          }
          await page.locator(selector).click();
          break;
        }

        case "type": {
          const selector = config.actionTargets?.[action.targetId] ?? config.input;
          const locator = page.locator(selector);
          if (action.clearFirst) {
            await locator.clear();
          }
          await locator.fill(action.text);
          break;
        }

        case "select": {
          const selector = config.actionTargets?.[action.targetId];
          if (!selector) {
            throw new Error(
              `No selector mapping found for semantic target "${action.targetId}"`,
            );
          }
          await page.locator(selector).selectOption(action.value);
          break;
        }

        case "upload": {
          const selector = config.actionTargets?.[action.targetId];
          if (!selector) {
            throw new Error(
              `No selector mapping found for semantic target "${action.targetId}"`,
            );
          }
          await page.locator(selector).setInputFiles(action.fileRef);
          break;
        }

        case "navigate": {
          if (action.url) {
            await page.goto(action.url);
            break;
          }
          if (action.targetId) {
            const selector = config.actionTargets?.[action.targetId];
            if (!selector) {
              throw new Error(
                `No selector mapping found for semantic target "${action.targetId}"`,
              );
            }
            await page.locator(selector).click();
            break;
          }
          throw new Error("Navigate action requires either url or targetId.");
        }
      }
    },

    async awaitSettled(options?: AwaitSettledOptions): Promise<void> {
      const timeout = options?.timeoutMs ?? 15000;

      if (config.workingMarker) {
        const workingEl = page.locator(config.workingMarker);
        const isWorking = (await workingEl.count()) > 0;
        if (isWorking) {
          await workingEl.waitFor({ state: "hidden", timeout });
        }
      }

      await page.locator(config.idleMarker).waitFor({ state: "visible", timeout });
    },

    async assertHealthy(): Promise<void> {
      await page.locator(config.transcript).waitFor({ state: "visible" });
    },

    async captureScreenshot(): Promise<Buffer> {
      return await page.screenshot({ type: "png", fullPage: false });
    },
  };
}
