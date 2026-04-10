/**
 * Playwright adapter module for mimiq.
 * Provides Playwright-specific browser adapters and test fixtures.
 */

export { createDefaultChatAdapter, type DefaultChatAdapterConfig } from "./adapters/defaultChatAdapter";
export { createVisionAdapter, type VisionAdapterConfig } from "./adapters/visionAdapter";
export { createHtmlAdapter, type HtmlAdapterConfig, type HtmlCleanupOptions } from "./adapters/htmlAdapter";
export { test, expect, MimiqTestHelper, type MimiqFixtures, type MimiqWorkerFixtures, type MimiqTestHelperOptions } from "./fixtures";
export type { PlaywrightBrowserAdapter } from "../types";
