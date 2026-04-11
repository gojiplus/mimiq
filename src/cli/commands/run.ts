/**
 * run command: Full pipeline - sim → eval → report.
 */

import { Command } from "commander";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join, basename } from "path";
import { parse as parseYaml } from "yaml";
import { JobManager } from "../../node/jobManager";
import { RecordingCollector } from "../../node/recordingCollector";
import { createLocalRuntime } from "../../node/localRuntime";
import { getAllEvaluators } from "../../eval/registry";
import { generateJobReport } from "../../node/reportGenerator";
import type { Framework, JobConfig, JobEvalResults, RunEvalResult, RecordingTranscript, EvaluatorResult } from "../../types";
import type { Scene } from "../../core/models";
import type { EvaluatorContext } from "../../eval/evaluator";

import "../../eval";

interface RunOptions {
  scenes: string;
  runs: string;
  framework: string;
  output: string;
  jobId?: string;
  evaluators?: string;
  skipReport?: boolean;
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

export const runCommand = new Command("run")
  .description("Full pipeline: sim → eval → report")
  .requiredOption("-s, --scenes <dir>", "Directory containing scene YAML files")
  .option("-r, --runs <count>", "Number of runs per scene", "3")
  .option("-f, --framework <name>", "Test framework (playwright|cypress)", "playwright")
  .option("-o, --output <dir>", "Output directory for recordings", "./recordings")
  .option("--job-id <id>", "Custom job ID (auto-generated if not provided)")
  .option("-e, --evaluators <list>", "Comma-separated list of evaluators (default: all)")
  .option("--skip-report", "Skip report generation")
  .action(async (options: RunOptions) => {
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
    console.log(`\nJob ID: ${jobManager.getJobId()}`);
    console.log(`Output: ${jobManager.getJobDir()}`);

    const runtime = createLocalRuntime({
      scenesDir: options.scenes,
    });

    console.log("\n=== SIMULATION ===");

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

    console.log("\n=== EVALUATION ===");

    const evaluators = getAllEvaluators();
    console.log(`Using evaluators: ${evaluators.map((e) => e.name).join(", ")}`);

    const transcripts = jobManager.collectRunTranscripts();
    console.log(`Found ${transcripts.length} run(s) to evaluate`);

    const runResults: RunEvalResult[] = [];
    const byScene: Record<string, { total: number; passed: number; passRate: number }> = {};
    const byEvaluator: Record<string, { total: number; passed: number; passRate: number }> = {};

    for (const { sceneId, runNumber, transcriptPath, metadataPath } of transcripts) {
      if (!existsSync(transcriptPath)) continue;

      const transcript = JSON.parse(readFileSync(transcriptPath, "utf-8")) as RecordingTranscript;

      const ctx: EvaluatorContext = {
        transcript,
        metadata: existsSync(metadataPath)
          ? JSON.parse(readFileSync(metadataPath, "utf-8"))
          : undefined,
      };

      const results: EvaluatorResult[] = [];
      let allPassed = true;

      for (const evaluator of evaluators) {
        try {
          const result = await evaluator.evaluate(ctx);
          results.push(result);

          if (!result.passed) allPassed = false;

          if (!byEvaluator[evaluator.name]) {
            byEvaluator[evaluator.name] = { total: 0, passed: 0, passRate: 0 };
          }
          byEvaluator[evaluator.name].total++;
          if (result.passed) byEvaluator[evaluator.name].passed++;
        } catch (err) {
          results.push({
            name: evaluator.name,
            passed: false,
            details: `Error: ${(err as Error).message}`,
          });
          allPassed = false;
        }
      }

      if (!byScene[sceneId]) {
        byScene[sceneId] = { total: 0, passed: 0, passRate: 0 };
      }
      byScene[sceneId].total++;
      if (allPassed) byScene[sceneId].passed++;

      runResults.push({
        runId: transcript.runId,
        sceneId,
        runNumber,
        passed: allPassed,
        terminalState: transcript.terminalState,
        results,
      });

      const status = allPassed ? "PASS" : "FAIL";
      console.log(`  ${sceneId}/run-${String(runNumber).padStart(3, "0")}: ${status}`);
    }

    for (const sceneId of Object.keys(byScene)) {
      byScene[sceneId].passRate = Math.round(
        (byScene[sceneId].passed / byScene[sceneId].total) * 100
      );
    }

    for (const evalName of Object.keys(byEvaluator)) {
      byEvaluator[evalName].passRate = Math.round(
        (byEvaluator[evalName].passed / byEvaluator[evalName].total) * 100
      );
    }

    const totalRuns = runResults.length;
    const passedRuns = runResults.filter((r) => r.passed).length;
    const failedRuns = totalRuns - passedRuns;
    const passRate = totalRuns > 0 ? Math.round((passedRuns / totalRuns) * 100) : 0;

    const evalResults: JobEvalResults = {
      jobId: jobManager.getJobId(),
      evaluatedAt: new Date().toISOString(),
      evaluators: evaluators.map((e) => e.name),
      runs: runResults,
      summary: {
        totalRuns,
        passedRuns,
        failedRuns,
        passRate,
        byScene,
        byEvaluator,
      },
    };

    const evalDir = jobManager.getEvalDir();
    const resultsPath = join(evalDir, "results.json");
    writeFileSync(resultsPath, JSON.stringify(evalResults, null, 2));

    console.log(`\nResults saved to: ${resultsPath}`);
    console.log(`Pass rate: ${passRate}% (${passedRuns}/${totalRuns})`);

    if (!options.skipReport) {
      console.log("\n=== REPORT ===");

      const reportPath = generateJobReport(options.output, jobManager.getJobId());
      if (reportPath) {
        console.log(`Report generated: ${reportPath}`);
      }
    }

    jobManager.markCompleted();
    console.log(`\nJob completed: ${jobManager.getJobId()}`);
  });
