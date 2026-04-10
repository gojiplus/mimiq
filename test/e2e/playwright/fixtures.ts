/**
 * Mimiq Playwright test fixtures.
 * Configure the runtime and adapter factories for your project.
 */

import { type Page } from "@playwright/test";
import { join } from "path";
import {
  test as mimiqTest,
  createDefaultChatAdapter,
  type MimiqFixtures,
  type MimiqWorkerFixtures,
} from "../../../dist/adapters/playwright/index.js";
import { createLocalRuntime } from "../../../dist/node/index.js";

const recordingEnabled = process.env.MIMIQ_RECORDING === "1";
const recordingsDir = join(process.cwd(), "test", "recordings");
const scenesDir = join(process.cwd(), "test", "scenes");

export const test = mimiqTest.extend<MimiqFixtures, MimiqWorkerFixtures>({
  mimiqRuntimeFactory: [
    async ({}, use) => {
      await use(() =>
        createLocalRuntime({
          scenesDir,
          recording: {
            enabled: recordingEnabled,
            outputDir: recordingsDir,
            screenshots: {
              enabled: true,
              timing: "before",
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
            defaultRunCount: 3,
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
