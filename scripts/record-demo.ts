/**
 * Demo recording script for mimiq.
 *
 * Records a simulation run with video and screenshots for demo purposes.
 * Outputs to examples/outputs/{videos,gifs}/
 *
 * Usage:
 *   npx tsx scripts/record-demo.ts [sceneId]
 *   npx tsx scripts/record-demo.ts track_order_via_button
 */

import { chromium, type Page, type BrowserContext } from "@playwright/test";
import { join } from "path";
import { existsSync, mkdirSync, writeFileSync } from "fs";

interface RecordingConfig {
  sceneId: string;
  outputDir: string;
  headless: boolean;
  videoDir: string;
  screenshotsDir: string;
}

async function recordDemo(config: RecordingConfig) {
  console.log(`Recording demo for scene: ${config.sceneId}`);

  mkdirSync(config.videoDir, { recursive: true });
  mkdirSync(config.screenshotsDir, { recursive: true });

  const browser = await chromium.launch({
    headless: config.headless,
    slowMo: 100,
  });

  const context: BrowserContext = await browser.newContext({
    recordVideo: {
      dir: config.videoDir,
      size: { width: 1280, height: 720 },
    },
    viewport: { width: 1280, height: 720 },
  });

  const page: Page = await context.newPage();

  const screenshots: string[] = [];
  let screenshotIndex = 0;

  const captureScreenshot = async (label: string) => {
    screenshotIndex++;
    const filename = `${String(screenshotIndex).padStart(3, "0")}-${label}.png`;
    const filepath = join(config.screenshotsDir, filename);
    await page.screenshot({ path: filepath });
    screenshots.push(filepath);
    console.log(`  Captured: ${filename}`);
  };

  try {
    console.log("Navigating to app...");
    await page.goto("http://localhost:5173");
    await page.waitForLoadState("networkidle");
    await captureScreenshot("initial");

    console.log("Loading mimiq runtime...");
    const { createLocalRuntime } = await import("../dist/node/index.js");
    const { createDefaultChatAdapter } = await import(
      "../dist/adapters/playwright/index.js"
    );

    const runtime = createLocalRuntime({
      scenesDir: join(process.cwd(), "test", "scenes"),
    });

    const adapter = createDefaultChatAdapter(page, {
      transcript: "[data-test=transcript]",
      messageRow: "[data-test=message-row]",
      messageRoleAttr: "data-role",
      messageText: "[data-test=message-text]",
      input: "[data-test=chat-input]",
      send: "[data-test=send-button]",
      idleMarker: "[data-test=agent-idle]",
      workingMarker: "[data-test=agent-working]",
      actionTargets: {
        "track-order": "[data-test=track-order]",
        "start-return": "[data-test=start-return]",
      },
    });

    console.log("Starting run...");
    const { runId } = await runtime.startRun({ sceneId: config.sceneId });
    console.log(`Run ID: ${runId}`);

    let turnCount = 0;
    const maxTurns = 15;

    while (turnCount < maxTurns) {
      turnCount++;
      console.log(`Turn ${turnCount}...`);

      await captureScreenshot(`turn-${turnCount}-before`);

      const snapshot = await adapter.captureSnapshot();
      const response = await runtime.advanceRun({ runId, snapshot });

      if (response.action.kind === "done") {
        console.log(`Done: ${response.action.reason}`);
        await captureScreenshot(`turn-${turnCount}-done`);
        break;
      }

      await adapter.executeAction(response.action);
      await adapter.awaitSettled({ timeoutMs: 5000 });

      await captureScreenshot(`turn-${turnCount}-after`);
    }

    console.log("Evaluating...");
    const report = await runtime.evaluateRun({ runId });

    console.log("\nEvaluation:");
    console.log(`  Passed: ${report.passed}`);
    console.log(`  Terminal State: ${report.terminalState}`);
    console.log(`  Summary: ${report.summary}`);

    const metadataPath = join(config.outputDir, `${config.sceneId}-metadata.json`);
    writeFileSync(
      metadataPath,
      JSON.stringify(
        {
          sceneId: config.sceneId,
          runId,
          screenshots,
          report,
          recordedAt: new Date().toISOString(),
        },
        null,
        2
      )
    );

    console.log(`\nMetadata saved: ${metadataPath}`);
    console.log(`Screenshots: ${screenshots.length} captured`);
    console.log(`\nTo generate GIF, run:`);
    console.log(`  ./scripts/generate-gifs.sh ${config.sceneId}`);
  } catch (error) {
    console.error("Recording failed:", error);
    await captureScreenshot("error");
  } finally {
    await context.close();
    await browser.close();
  }

  console.log("\nVideo saved to:", config.videoDir);
}

async function main() {
  const sceneId = process.argv[2] || "track_order_via_button";

  const outputDir = join(process.cwd(), "examples", "outputs");
  const config: RecordingConfig = {
    sceneId,
    outputDir,
    headless: false,
    videoDir: join(outputDir, "videos"),
    screenshotsDir: join(outputDir, "screenshots", sceneId),
  };

  await recordDemo(config);
}

main().catch(console.error);
