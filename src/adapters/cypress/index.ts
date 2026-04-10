/**
 * Cypress adapter module for mimiq.
 * Provides Cypress-specific browser adapters and commands.
 */

export { createDefaultChatAdapter, type DefaultChatAdapterConfig } from "./adapters/defaultChatAdapter";
export { createVisionAdapter, type VisionAdapterConfig } from "./adapters/visionAdapter";
export { createHtmlAdapter, type HtmlAdapterConfig, type HtmlCleanupOptions } from "./adapters/htmlAdapter";
export { registerMimiqCommands, type RegisterMimiqCommandsOptions, type MimiqCommandDefaults } from "./commands";
export type { CypressBrowserAdapter } from "../types";
