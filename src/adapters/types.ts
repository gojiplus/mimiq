/**
 * Shared types for browser adapters.
 * Provides separate interfaces for Cypress and Playwright adapters.
 */

import type {
  AffordanceSnapshot,
  AwaitSettledOptions,
  BrowserSimAction,
} from "../types";

/**
 * Cypress-specific browser adapter interface.
 */
export interface CypressBrowserAdapter {
  captureSnapshot(): Cypress.Chainable<AffordanceSnapshot>;
  executeAction(action: BrowserSimAction): Cypress.Chainable<void>;
  awaitSettled(options?: AwaitSettledOptions): Cypress.Chainable<void>;
  assertHealthy?(): Cypress.Chainable<void>;
  captureScreenshot?(): Cypress.Chainable<string>;
}

/**
 * Playwright-specific browser adapter interface.
 */
export interface PlaywrightBrowserAdapter {
  captureSnapshot(): Promise<AffordanceSnapshot>;
  executeAction(action: BrowserSimAction): Promise<void>;
  awaitSettled(options?: AwaitSettledOptions): Promise<void>;
  assertHealthy?(): Promise<void>;
  captureScreenshot?(): Promise<Buffer>;
}

/**
 * Union type for any browser adapter.
 */
export type BrowserAdapter = CypressBrowserAdapter | PlaywrightBrowserAdapter;

/**
 * Type alias for legacy compatibility.
 */
export type LegacyBrowserAdapter = CypressBrowserAdapter;

/**
 * Selector type for cross-platform compatibility.
 */
export type Selector = string;

/**
 * Shared adapter configuration base.
 */
export interface BaseAdapterConfig {
  inputSelector?: Selector;
  sendSelector?: Selector;
  waitForIdleMs?: number;
}

/**
 * Default chat adapter configuration (shared between Cypress and Playwright).
 */
export interface DefaultChatAdapterConfig extends BaseAdapterConfig {
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
}

/**
 * Vision adapter configuration (shared between Cypress and Playwright).
 */
export interface VisionAdapterConfig extends BaseAdapterConfig {
  model?: string;
  screenshotSelector?: Selector;
}

/**
 * HTML cleanup options for HTML adapter.
 */
export interface HtmlCleanupOptions {
  removeScripts?: boolean;
  removeStyles?: boolean;
  removeComments?: boolean;
  preserveDataAttributes?: boolean;
  removeHiddenElements?: boolean;
}

/**
 * HTML adapter configuration (shared between Cypress and Playwright).
 */
export interface HtmlAdapterConfig extends BaseAdapterConfig {
  mode: "html" | "screenshot" | "hybrid";
  model?: string;
  htmlCleanupOptions?: HtmlCleanupOptions;
  maxHtmlLength?: number;
  containerSelector?: Selector;
}
