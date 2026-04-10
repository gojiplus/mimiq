/**
 * Mimiq Playwright fixtures for LayoutLens visual assertions.
 *
 * This example demonstrates visual AI-powered assertions using LayoutLens:
 * - Visual element verification
 * - Accessibility audits
 * - UI state validation
 */

import { type Page } from "@playwright/test";
import { join } from "path";
import {
  test as mimiqTest,
  createDefaultChatAdapter,
  type MimiqFixtures,
  type MimiqWorkerFixtures,
} from "@gojiplus/mimiq/playwright";
import { createLocalRuntime } from "@gojiplus/mimiq/node";

const recordingEnabled = process.env.MIMIQ_RECORDING === "1";
const recordingsDir = join(process.cwd(), "..", "outputs", "recordings");
const scenesDir = join(process.cwd(), "scenes");

export const test = mimiqTest.extend<MimiqFixtures, MimiqWorkerFixtures>({
  mimiqRuntimeFactory: [
    async ({}, use) => {
      await use(() =>
        createLocalRuntime({
          scenesDir,
          layoutLensConfig: {
            pythonPath: process.env.LAYOUTLENS_PYTHON || "python",
            timeout: 30000,
            screenshotDir: join(process.cwd(), "..", "outputs", "visual-reports"),
          },
          recording: {
            enabled: recordingEnabled,
            outputDir: recordingsDir,
            screenshots: {
              enabled: true,
              timing: "both",
              format: "png",
            },
            transcript: {
              format: "json",
              includeUiState: true,
            },
            actionLog: {
              enabled: true,
              format: "markdown",
            },
            runNaming: "sequential",
            defaultRunCount: 1,
          },
        })
      );
    },
    { scope: "worker" },
  ],

  mimiqAdapterFactory: [
    async ({}, use) => {
      await use((page: Page) =>
        createDefaultChatAdapter(page, {
          transcript: "[data-test=transcript]",
          messageRow: "[data-test=message-row]",
          messageRoleAttr: "data-role",
          messageText: "[data-test=message-text]",
          input: "[data-test=chat-input]",
          send: "[data-test=send-button]",
          idleMarker: "[data-test=agent-idle]",
          workingMarker: "[data-test=agent-working]",
          toolCallsSelector: "[data-test=tool-calls]",
          actionTargets: {
            "track-order": "[data-test=track-order]",
            "start-return": "[data-test=start-return]",
          },
        })
      );
    },
    { scope: "worker" },
  ],
});

export { expect } from "@playwright/test";
