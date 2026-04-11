/**
 * eval command: Run evaluators on job recordings.
 */

import { Command } from "commander";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { JobManager } from "../../node/jobManager";
import { getEvaluatorsByNames, getAllEvaluators, listEvaluators } from "../../eval/registry";
import type { EvaluatorContext } from "../../eval/evaluator";
import type { JobEvalResults, RunEvalResult, RecordingTranscript, EvaluatorResult } from "../../types";

import "../../eval";

interface EvalOptions {
  output: string;
  jobId?: string;
  latest?: boolean;
  evaluators?: string;
}

export const evalCommand = new Command("eval")
  .description("Run evaluators on job recordings")
  .option("-o, --output <dir>", "Output directory containing jobs", "./recordings")
  .option("--job-id <id>", "Job ID to evaluate")
  .option("--latest", "Use most recent job")
  .option("-e, --evaluators <list>", "Comma-separated list of evaluators (default: all)")
  .action(async (options: EvalOptions) => {
    let jobId = options.jobId;

    if (options.latest || !jobId) {
      jobId = JobManager.findLatestJob(options.output) || undefined;
      if (!jobId) {
        console.error("No jobs found in output directory");
        process.exit(1);
      }
    }

    const jobManager = JobManager.fromJobId(options.output, jobId!);
    if (!jobManager) {
      console.error(`Job not found: ${jobId}`);
      process.exit(1);
    }

    console.log(`Evaluating job: ${jobManager.getJobId()}`);

    const evaluatorNames = options.evaluators
      ? options.evaluators.split(",").map((s) => s.trim())
      : listEvaluators();

    const evaluators = options.evaluators
      ? getEvaluatorsByNames(evaluatorNames)
      : getAllEvaluators();

    if (evaluators.length === 0) {
      console.error("No evaluators found");
      process.exit(1);
    }

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
  });
