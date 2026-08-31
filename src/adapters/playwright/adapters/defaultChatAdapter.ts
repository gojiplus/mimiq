import type { Locator, Page } from "@playwright/test";
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
  instrumentToolCalls?: boolean;
  actionTargets?: Record<string, Selector>;
  discoverActions?: boolean;
  maxDiscoveredActions?: number;
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
  locators: Map<string, Locator>,
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
      metadata: { selector },
    });
    locators.set(id, el);
  }

  return targets;
}

async function discoverActionTargets(
  page: Page,
  locators: Map<string, Locator>,
  maxActions: number,
): Promise<UIActionTarget[]> {
  const interactive = page.locator(
    'button, [role="button"], a[href], select, textarea, input:not([type="hidden"]), [contenteditable="true"]',
  );
  const count = Math.min(await interactive.count(), maxActions);
  const targets: UIActionTarget[] = [];

  for (let index = 0; index < count; index++) {
    const locator = interactive.nth(index);
    if (!await locator.isVisible().catch(() => false)) continue;

    const details = await locator.evaluate((element) => {
      const htmlElement = element as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
      const tag = element.tagName.toLowerCase();
      const inputType = tag === "input" ? htmlElement.type : "";
      const kind = tag === "select"
        ? "select"
        : inputType === "file"
          ? "upload"
          : tag === "input" || tag === "textarea" || element.getAttribute("contenteditable") === "true"
            ? "type"
            : "click";
      const label = element.getAttribute("aria-label")
        || element.getAttribute("title")
        || element.getAttribute("placeholder")
        || element.textContent?.trim()
        || element.getAttribute("name")
        || element.id
        || `${tag}-${inputType || "control"}`;
      const options = tag === "select"
        ? Array.from((element as HTMLSelectElement).options).map((option) => ({
            value: option.value,
            label: option.textContent?.trim() || option.value,
          }))
        : undefined;
      const selector = element.id
        ? `#${CSS.escape(element.id)}`
        : (() => {
            const path: string[] = [];
            let current: Element | null = element;
            while (current && current.parentElement) {
              const tagName = current.tagName.toLowerCase();
              const siblings = Array.from(current.parentElement.children)
                .filter((sibling) => sibling.tagName === current!.tagName);
              path.unshift(`${tagName}:nth-of-type(${siblings.indexOf(current) + 1})`);
              current = current.parentElement;
            }
            return path.join(" > ");
          })();
      return { tag, inputType, kind, label, options, selector };
    });
    const id = `mimiq-${details.tag}-${index + 1}`;

    targets.push({
      id,
      kind: details.kind as UIActionTarget["kind"],
      label: details.label,
      enabled: !await locator.isDisabled().catch(() => false),
      ...(details.options ? { options: details.options } : {}),
      metadata: { selector: details.selector },
    });
    locators.set(id, locator);
  }

  return targets;
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
      name: toolCall.name,
      args: toolCall.args,
      result: toolCall.result as JsonValue | undefined,
    };
  });
}

async function collectInstrumentedToolCalls(page: Page): Promise<AgentToolCall[]> {
  const events: unknown = await page.evaluate(() => {
    const eventName = "mimiq:agent-tool-call";
    const queueKey = "__mimiqAgentToolCalls";
    const listenerKey = "__mimiqAgentToolCallListener";
    const target = window as typeof window & Record<string, unknown>;

    if (!Array.isArray(target[queueKey])) {
      target[queueKey] = [];
    }
    if (!target[listenerKey]) {
      window.addEventListener(eventName, (event) => {
        (target[queueKey] as unknown[]).push((event as CustomEvent<unknown>).detail);
      });
      target[listenerKey] = true;
    }

    const queue = target[queueKey] as unknown[];
    return queue.splice(0, queue.length);
  });

  if (!Array.isArray(events)) {
    throw new Error("Instrumented agent tool calls must be an array.");
  }
  return events.map((toolCall, index) => {
    if (!isJsonObject(toolCall) || typeof toolCall.name !== "string" || !isJsonObject(toolCall.args)) {
      throw new Error(`Instrumented tool call at index ${index} must provide a name and object args.`);
    }
    return {
      name: toolCall.name,
      args: toolCall.args,
      result: toolCall.result as JsonValue | undefined,
    };
  });
}

export function createDefaultChatAdapter(
  page: Page,
  config: DefaultChatAdapterConfig,
): PlaywrightBrowserAdapter {
  const actionLocators = new Map<string, Locator>();

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
      actionLocators.clear();
      const availableActions: UIActionTarget[] = [
        {
          id: "chat-input",
          kind: "message",
          label: "Chat input",
          enabled: inputCount > 0,
          metadata: { selector: config.input },
        },
        ...(await toActionTargets(page, config.actionTargets, actionLocators)),
        ...(config.discoverActions === false
          ? []
          : await discoverActionTargets(page, actionLocators, config.maxDiscoveredActions ?? 40)),
      ];

      let toolCalls: AgentToolCall[] = [];
      if (config.toolCallsSelector) {
        const toolCallsEl = page.locator(config.toolCallsSelector);
        const count = await toolCallsEl.count();
        if (count > 0) {
          const text = (await toolCallsEl.textContent()) || "[]";
          toolCalls = parseToolCalls(text);
        }
      }
      if (config.instrumentToolCalls !== false) {
        toolCalls.push(...await collectInstrumentedToolCalls(page));
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
          toolCalls,
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
          const locator = actionLocators.get(action.targetId);
          const selector = config.actionTargets?.[action.targetId];
          if (!locator && !selector) {
            throw new Error(
              `No observed or configured target found for "${action.targetId}"`,
            );
          }
          await (locator ?? page.locator(selector!)).click();
          break;
        }

        case "type": {
          const locator = actionLocators.get(action.targetId)
            ?? page.locator(config.actionTargets?.[action.targetId] ?? config.input);
          if (action.clearFirst) {
            await locator.clear();
          }
          await locator.fill(action.text);
          break;
        }

        case "select": {
          const locator = actionLocators.get(action.targetId);
          const selector = config.actionTargets?.[action.targetId];
          if (!locator && !selector) {
            throw new Error(
              `No observed or configured target found for "${action.targetId}"`,
            );
          }
          await (locator ?? page.locator(selector!)).selectOption(action.value);
          break;
        }

        case "upload": {
          const locator = actionLocators.get(action.targetId);
          const selector = config.actionTargets?.[action.targetId];
          if (!locator && !selector) {
            throw new Error(
              `No observed or configured target found for "${action.targetId}"`,
            );
          }
          await (locator ?? page.locator(selector!)).setInputFiles(action.fileRef);
          break;
        }

        case "navigate": {
          if (action.url) {
            await page.goto(action.url);
            break;
          }
          if (action.targetId) {
            const locator = actionLocators.get(action.targetId);
            const selector = config.actionTargets?.[action.targetId];
            if (!locator && !selector) {
              throw new Error(
                `No observed or configured target found for "${action.targetId}"`,
              );
            }
            await (locator ?? page.locator(selector!)).click();
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
