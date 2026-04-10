/**
 * mimiq - Simulate users and evaluate AI agents in browser e2e tests.
 *
 * Main entry point providing core types and Cypress-compatible exports.
 * For Playwright support, import from "@gojiplus/mimiq/playwright".
 * For browser agent simulators, import from "@gojiplus/mimiq/simulators".
 */

export type * from "./types";
export * from "./core";
export * from "./eval";

export {
  createDefaultChatAdapter,
  createVisionAdapter,
  createHtmlAdapter,
  registerMimiqCommands,
  type DefaultChatAdapterConfig,
  type VisionAdapterConfig,
  type HtmlAdapterConfig,
  type HtmlCleanupOptions,
  type RegisterMimiqCommandsOptions,
  type MimiqCommandDefaults,
  type CypressBrowserAdapter,
} from "./adapters/cypress";

export type {
  BrowserAdapter,
  PlaywrightBrowserAdapter,
  LegacyBrowserAdapter,
  Selector,
  BaseAdapterConfig,
} from "./adapters/types";
