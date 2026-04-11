/**
 * sim command: Run simulations for scenes.
 */

import { Command } from "commander";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join, basename } from "path";
import { parse as parseYaml } from "yaml";
import { JobManager } from "../../node/jobManager";
import { RecordingCollector } from "../../node/recordingCollector";
import { createLocalRuntime } from "../../node/localRuntime";
import type { Framework, JobConfig } from "../../types";
import type { Scene } from "../../core/models";

interface SimOptions {
  scenes: string;
  runs: string;
  framework: string;
  output: string;
  jobId?: string;
}

function discoverScenes(scenesDir: string): string[] {
  if (!existsSync(scenesDir)) {
    return [];
  }

  return readdirSync(scenesDir)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .map((f) => join(scenesDir, f));
}

function loadScene(scenePath: string): Scene {
  const content = readFileSync(scenePath, "utf-8");
  return parseYaml(content) as Scene;
}

export const simCommand = new Command("sim")
  .description("Run simulations for scenes")
  .requiredOption("-s, --scenes <dir>", "Directory containing scene YAML files")
  .option("-r, --runs <count>", "Number of runs per scene", "3")
  .option("-f, --framework <name>", "Test framework (playwright|cypress)", "playwright")
  .option("-o, --output <dir>", "Output directory for recordings", "./recordings")
  .option("--job-id <id>", "Custom job ID (auto-generated if not provided)")
  .action(async (options: SimOptions) => {
    const scenePaths = discoverScenes(options.scenes);

    if (scenePaths.length === 0) {
      console.error(`No scene files found in ${options.scenes}`);
      process.exit(1);
    }

    console.log(`Found ${scenePaths.length} scene(s)`);

    const framework = options.framework as Framework;
    const runsPerScene = parseInt(options.runs, 10);

    const jobConfig: JobConfig = {
      jobId: options.jobId,
      scenesDir: options.scenes,
      outputDir: options.output,
      framework,
      runs: runsPerScene,
    };

    const jobManager = new JobManager(jobConfig);
    console.log(`Job ID: ${jobManager.getJobId()}`);
    console.log(`Output: ${jobManager.getJobDir()}`);

    const runtime = createLocalRuntime({
      scenesDir: options.scenes,
    });

    for (const scenePath of scenePaths) {
      const scene = loadScene(scenePath);
      const sceneId = scene.id || basename(scenePath, ".yaml").replace(".yml", "");
      jobManager.addScene(sceneId);

      console.log(`\nScene: ${sceneId}`);

      for (let runNum = 1; runNum <= runsPerScene; runNum++) {
        const runDir = jobManager.getRunDir(framework, sceneId, runNum);

        console.log(`  Run ${runNum}/${runsPerScene}...`);

        try {
          const { runId } = await runtime.startRun({ scenePath });

          const recorder = new RecordingCollector({
            sceneId,
            runId,
            config: {
              enabled: true,
              outputDir: jobManager.getJobDir(),
              framework,
            },
            runDir,
            runNumber: runNum,
          });

          let done = false;
          while (!done) {
            const snapshot = {
              transcript: [],
              availableActions: [],
              availableUserTools: [],
            };

            const result = await runtime.advanceRun({
              runId,
              snapshot,
            });

            if (result.action.kind === "done") {
              done = true;
            }
          }

          await runtime.evaluateRun({ runId });
          recorder.finalize();
          jobManager.incrementCompletedRuns();

          console.log(`    Completed`);
        } catch (err) {
          console.error(`    Failed: ${(err as Error).message}`);
        }
      }
    }

    jobManager.markCompleted();
    console.log(`\nJob completed: ${jobManager.getJobId()}`);
  });
