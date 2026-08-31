import type { Locator, Page } from "@playwright/test";
import type {
  AffordanceSnapshot,
  ApplicationTelemetryEvent,
  AwaitSettledOptions,
  BrowserSimAction,
  JsonValue,
  UIActionTarget,
} from "../../../types";
import type { PlaywrightBrowserAdapter } from "../../types";

export const DEFAULT_TELEMETRY_EVENT_NAME = "mimiq:telemetry";

export interface BrowserAdapterConfig {
  maxDiscoveredActions?: number;
  settleTimeoutMs?: number;
  telemetryEventName?: string;
}

function installApplicationTelemetryListener(eventName: string): void {
  const queuesKey = "__mimiqTelemetryQueues";
  const listenersKey = "__mimiqTelemetryListeners";
  const target = window as typeof window & Record<string, unknown>;
  const queues = (target[queuesKey] ??= {}) as Record<string, unknown[]>;
  const listeners = (target[listenersKey] ??= {}) as Record<string, boolean>;

  queues[eventName] ??= [];
  if (!listeners[eventName]) {
    window.addEventListener(eventName, (event) => {
      queues[eventName].push((event as CustomEvent<unknown>).detail);
    });
    listeners[eventName] = true;
  }
}

export async function installApplicationTelemetryCollector(
  page: Page,
  eventName = DEFAULT_TELEMETRY_EVENT_NAME,
): Promise<void> {
  await page.addInitScript(installApplicationTelemetryListener, eventName);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || ["string", "boolean"].includes(typeof value)) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (typeof value === "object") {
    return Object.values(value).every(isJsonValue);
  }
  return false;
}

function isTelemetryEvent(value: unknown): value is ApplicationTelemetryEvent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const event = value as Record<string, unknown>;
  return typeof event.name === "string"
    && event.name.length > 0
    && (event.data === undefined || isJsonValue(event.data))
    && (event.timestamp === undefined || typeof event.timestamp === "string");
}

export async function collectApplicationTelemetry(
  page: Page,
  eventName = DEFAULT_TELEMETRY_EVENT_NAME,
): Promise<ApplicationTelemetryEvent[]> {
  await page.evaluate(installApplicationTelemetryListener, eventName);
  const events = await page.evaluate((configuredEventName) => {
    const queuesKey = "__mimiqTelemetryQueues";
    const target = window as typeof window & Record<string, unknown>;
    const queue = target[queuesKey] as Record<string, unknown[]> | undefined;
    const events = queue?.[configuredEventName] ?? [];
    return events.splice(0, events.length);
  }, eventName);

  if (!Array.isArray(events) || !events.every(isTelemetryEvent)) {
    throw new Error(
      `Application telemetry from "${eventName}" must contain events with a name and JSON data.`,
    );
  }
  return events;
}

export async function discoverPageActionTargets(
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

async function executeObservedAction(
  page: Page,
  locators: Map<string, Locator>,
  action: BrowserSimAction,
): Promise<void> {
  switch (action.kind) {
    case "message":
      return;
    case "click":
      await requireObservedLocator(locators, action.targetId).click();
      return;
    case "type": {
      const locator = requireObservedLocator(locators, action.targetId);
      if (action.clearFirst) await locator.clear();
      await locator.fill(action.text);
      return;
    }
    case "select":
      await requireObservedLocator(locators, action.targetId).selectOption(action.value);
      return;
    case "upload":
      await requireObservedLocator(locators, action.targetId).setInputFiles(action.fileRef);
      return;
    case "navigate":
      if (action.url) {
        await page.goto(action.url);
        return;
      }
      if (action.targetId) {
        await requireObservedLocator(locators, action.targetId).click();
        return;
      }
      throw new Error("Navigate action requires either url or targetId.");
  }
}

function requireObservedLocator(locators: Map<string, Locator>, targetId: string): Locator {
  const locator = locators.get(targetId);
  if (!locator) {
    throw new Error(`No observed target found for "${targetId}".`);
  }
  return locator;
}

export async function createBrowserAdapter(
  page: Page,
  config: BrowserAdapterConfig = {},
): Promise<PlaywrightBrowserAdapter> {
  const actionLocators = new Map<string, Locator>();
  await installApplicationTelemetryCollector(
    page,
    config.telemetryEventName,
  );

  return {
    async captureSnapshot(): Promise<AffordanceSnapshot> {
      actionLocators.clear();
      const applicationTelemetry = await collectApplicationTelemetry(
        page,
        config.telemetryEventName,
      );
      return {
        url: page.url(),
        transcript: [],
        availableActions: await discoverPageActionTargets(
          page,
          actionLocators,
          config.maxDiscoveredActions ?? 40,
        ),
        availableUserTools: [],
        metadata: applicationTelemetry.length > 0 ? { applicationTelemetry } : {},
      };
    },

    async executeAction(action: BrowserSimAction): Promise<void> {
      await executeObservedAction(page, actionLocators, action);
    },

    async awaitSettled(options?: AwaitSettledOptions): Promise<void> {
      await page.waitForLoadState("domcontentloaded", {
        timeout: options?.timeoutMs ?? config.settleTimeoutMs ?? 15000,
      }).catch(() => undefined);
    },

    async captureScreenshot(): Promise<Buffer> {
      return page.screenshot({ type: "png", fullPage: false });
    },
  };
}
