/**
 * agent command: Run browser agent evaluation on agentic apps.
 */

import { Command } from "commander";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join, basename } from "path";
import { parse as parseYaml } from "yaml";

import { AgentRunner } from "../../node/agentRunner";
import { isAgentAvailable } from "../../agents";
import type { AgentScene } from "../../core/models";
import type { BrowserAgentType, BrowserTrace, EvaluatorResult, JobEvalResults, RunEvalResult } from "../../types";

interface AgentOptions {
  scene?: string;
  scenes?: string;
  url?: string;
  agent: string;
  model?: string;
  headless: boolean;
  runs: string;
  output: string;
  framework: string;
  jobId?: string;
  skipReport?: boolean;
}

function discoverAgentScenes(scenesDir: string): string[] {
  if (!existsSync(scenesDir)) {
    return [];
  }

  return readdirSync(scenesDir)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .map((f) => join(scenesDir, f));
}

function loadAgentScene(scenePath: string): AgentScene {
  const content = readFileSync(scenePath, "utf-8");
  return parseYaml(content) as AgentScene;
}

function isValidAgentScene(scene: unknown): scene is AgentScene {
  if (!scene || typeof scene !== "object") return false;
  const s = scene as Record<string, unknown>;
  return Boolean(s.id && s.agent && s.target && s.goal);
}

interface TranscriptTurn {
  turn: number;
  timestamp: string;
  actor: string;
  type: string;
  content?: string;
  result?: string;
  toolCalls?: Array<{ tool: string; args: Record<string, unknown>; result?: unknown }>;
  screenshot?: string;
}

interface Transcript {
  runId: string;
  sceneId: string;
  startedAt: string;
  finishedAt?: string;
  turns: TranscriptTurn[];
  terminalState?: string;
}

function generateActionLogMarkdown(
  transcript: Transcript,
  sceneId: string,
  runNumber: number
): string {
  const lines: string[] = [];
  const runStr = String(runNumber).padStart(3, "0");

  lines.push(`# Agent Run: ${sceneId} (run-${runStr})`);
  lines.push("");
  lines.push(`**Started:** ${formatTimestamp(transcript.startedAt)}`);
  if (transcript.finishedAt) {
    lines.push(`**Finished:** ${formatTimestamp(transcript.finishedAt)}`);
  }
  if (transcript.terminalState) {
    lines.push(`**Terminal State:** ${transcript.terminalState}`);
  }
  lines.push("");
  lines.push("---");

  for (const turn of transcript.turns) {
    lines.push("");
    lines.push(`## Turn ${turn.turn} - Agent Action`);
    lines.push(`**Time:** ${formatTime(turn.timestamp)}`);
    lines.push("");

    if (turn.content) {
      lines.push(`**Instruction:**`);
      lines.push(`> ${turn.content.replace(/\n/g, "\n> ")}`);
      lines.push("");
    }

    if (turn.result) {
      lines.push(`**Result:**`);
      lines.push(`> ${turn.result.replace(/\n/g, "\n> ")}`);
      lines.push("");
    }

    if (turn.toolCalls && turn.toolCalls.length > 0) {
      lines.push("**Tools Called:**");
      for (const tc of turn.toolCalls) {
        const argsStr = JSON.stringify(tc.args);
        const resultStr = tc.result ? ` -> \`${JSON.stringify(tc.result)}\`` : "";
        lines.push(`- \`${tc.tool}(${argsStr})\`${resultStr}`);
      }
      lines.push("");
    }

    if (turn.screenshot) {
      lines.push(`![Screenshot](${turn.screenshot})`);
      lines.push("");
    }

    lines.push("---");
  }

  return lines.join("\n");
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toTimeString().split(" ")[0];
}

export const agentCommand = new Command("agent")
  .description("Run browser agent evaluation on agentic apps")
  .option("-s, --scene <path>", "Path to single agent scene YAML file")
  .option("--scenes <dir>", "Directory containing agent scene YAML files")
  .option("-u, --url <url>", "Override target URL from scene")
  .option("-a, --agent <type>", "Agent type (stagehand)", "stagehand")
  .option("-m, --model <model>", "LLM model for the agent")
  .option("--headless", "Run in headless mode", true)
  .option("--no-headless", "Run in visible browser mode")
  .option("-r, --runs <count>", "Number of runs per scene", "1")
  .option("-o, --output <dir>", "Output directory", "./outputs")
  .option("-f, --framework <name>", "Framework name for output structure", "stagehand")
  .option("--job-id <id>", "Custom job ID (creates job-xxx subfolder)")
  .option("--skip-report", "Skip report generation")
  .action(async (options: AgentOptions) => {
    const agentType = options.agent as BrowserAgentType;
    const framework = options.framework;

    if (!isAgentAvailable(agentType)) {
      console.error(`Agent "${agentType}" is not available.`);
      if (agentType === "stagehand") {
        console.error("Install Stagehand: npm install @browserbasehq/stagehand");
      }
      process.exit(1);
    }

    let scenePaths: string[] = [];

    if (options.scene) {
      if (!existsSync(options.scene)) {
        console.error(`Scene file not found: ${options.scene}`);
        process.exit(1);
      }
      scenePaths = [options.scene];
    } else if (options.scenes) {
      scenePaths = discoverAgentScenes(options.scenes);
      if (scenePaths.length === 0) {
        console.error(`No scene files found in ${options.scenes}`);
        process.exit(1);
      }
    } else {
      console.error("Must provide --scene or --scenes");
      process.exit(1);
    }

    console.log(`Found ${scenePaths.length} agent scene(s)`);

    const runsPerScene = parseInt(options.runs, 10);
    const baseDir = options.output;
    const recordingsDir = join(baseDir, "recordings", framework);
    const evalsDir = join(baseDir, "evals", framework);
    const reportsDir = join(baseDir, "reports", framework);

    mkdirSync(recordingsDir, { recursive: true });
    mkdirSync(evalsDir, { recursive: true });
    mkdirSync(reportsDir, { recursive: true });

    console.log(`\nOutput: ${baseDir}`);
    console.log(`Framework: ${framework}`);

    console.log("\n=== AGENT EXECUTION ===");

    const allResults: Array<{
      sceneId: string;
      runNumber: number;
      trace: BrowserTrace;
      evaluation: { passed: boolean; results: EvaluatorResult[] };
    }> = [];

    const scenesRun: string[] = [];

    for (const scenePath of scenePaths) {
      const scene = loadAgentScene(scenePath);

      if (!isValidAgentScene(scene)) {
        console.warn(`Skipping invalid agent scene: ${scenePath}`);
        continue;
      }

      const sceneId = scene.id || basename(scenePath, ".yaml").replace(".yml", "");
      if (!scenesRun.includes(sceneId)) scenesRun.push(sceneId);

      const targetUrl = options.url || scene.target.url;

      console.log(`\nScene: ${sceneId}`);
      console.log(`  Target: ${targetUrl}`);
      console.log(`  Goal: ${scene.goal.slice(0, 80)}${scene.goal.length > 80 ? "..." : ""}`);

      const sceneDir = join(recordingsDir, sceneId);
      mkdirSync(sceneDir, { recursive: true });

      for (let runNum = 1; runNum <= runsPerScene; runNum++) {
        console.log(`  Run ${runNum}/${runsPerScene}...`);

        const runFolder = `run-${String(runNum).padStart(3, "0")}`;
        const runDir = join(sceneDir, runFolder);
        mkdirSync(runDir, { recursive: true });

        const sceneWithOverrides: AgentScene = {
          ...scene,
          target: { ...scene.target, url: targetUrl },
          agent: {
            ...scene.agent,
            type: agentType,
            model: options.model || scene.agent.model,
            headless: options.headless,
          },
        };

        try {
          const runner = new AgentRunner(sceneWithOverrides, {
            outputDir: runDir,
            headless: options.headless,
            model: options.model,
          });

          const result = await runner.run();

          const tracePath = join(runDir, "trace.json");
          writeFileSync(tracePath, JSON.stringify(result.trace, null, 2));

          const transcript = {
            runId: `${sceneId}-run-${runNum}`,
            sceneId,
            startedAt: result.trace.startedAt,
            finishedAt: result.trace.finishedAt,
            turns: result.trace.steps.map((step, idx) => ({
              turn: idx + 1,
              timestamp: step.timestamp,
              actor: "agent" as const,
              type: "action" as const,
              content: step.action.instruction,
              result: step.action.result,
              toolCalls: step.response?.toolCalls?.map((tc) => ({
                tool: tc.tool,
                args: tc.args as Record<string, unknown>,
                result: tc.result,
              })),
              screenshot: step.screenshot,
            })),
            terminalState: result.trace.terminalState,
          };

          const transcriptPath = join(runDir, "transcript.json");
          writeFileSync(transcriptPath, JSON.stringify(transcript, null, 2));

          const actionLog = generateActionLogMarkdown(transcript, sceneId, runNum);
          writeFileSync(join(runDir, "action-log.md"), actionLog);

          const metadata = {
            sceneId,
            runNumber: runNum,
            framework,
            startedAt: result.trace.startedAt,
            finishedAt: result.trace.finishedAt,
            passed: result.evaluation.passed,
            terminalState: result.trace.terminalState,
          };
          writeFileSync(join(runDir, "metadata.json"), JSON.stringify(metadata, null, 2));

          allResults.push({
            sceneId,
            runNumber: runNum,
            trace: result.trace,
            evaluation: result.evaluation,
          });

          const status = result.evaluation.passed ? "PASS" : "FAIL";
          const termState = result.trace.terminalState
            ? ` (${result.trace.terminalState})`
            : "";
          console.log(`    ${status}${termState}`);
        } catch (err) {
          console.error(`    Failed: ${(err as Error).message}`);
          allResults.push({
            sceneId,
            runNumber: runNum,
            trace: {
              sceneId,
              targetUrl,
              startedAt: new Date().toISOString(),
              finishedAt: new Date().toISOString(),
              steps: [],
              goalAchieved: false,
            },
            evaluation: {
              passed: false,
              results: [
                { name: "execution", passed: false, details: (err as Error).message },
              ],
            },
          });
        }
      }
    }

    console.log("\n=== EVALUATION SUMMARY ===");

    const runResults: RunEvalResult[] = allResults.map((r) => ({
      runId: `${r.sceneId}-run-${r.runNumber}`,
      sceneId: r.sceneId,
      runNumber: r.runNumber,
      passed: r.evaluation.passed,
      terminalState: r.trace.terminalState,
      results: r.evaluation.results,
    }));

    const byScene: Record<string, { total: number; passed: number; passRate: number }> = {};
    const byEvaluator: Record<string, { total: number; passed: number; passRate: number }> = {};

    for (const result of allResults) {
      if (!byScene[result.sceneId]) {
        byScene[result.sceneId] = { total: 0, passed: 0, passRate: 0 };
      }
      byScene[result.sceneId].total++;
      if (result.evaluation.passed) {
        byScene[result.sceneId].passed++;
      }

      for (const evalResult of result.evaluation.results) {
        if (!byEvaluator[evalResult.name]) {
          byEvaluator[evalResult.name] = { total: 0, passed: 0, passRate: 0 };
        }
        byEvaluator[evalResult.name].total++;
        if (evalResult.passed) {
          byEvaluator[evalResult.name].passed++;
        }
      }
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

    const totalRuns = allResults.length;
    const passedRuns = allResults.filter((r) => r.evaluation.passed).length;
    const failedRuns = totalRuns - passedRuns;
    const passRate = totalRuns > 0 ? Math.round((passedRuns / totalRuns) * 100) : 0;

    const evalResults: JobEvalResults = {
      jobId: framework,
      evaluatedAt: new Date().toISOString(),
      evaluators: ["goal-achieved", "terminal-state", "required-tools"],
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

    const resultsPath = join(evalsDir, "results.json");
    writeFileSync(resultsPath, JSON.stringify(evalResults, null, 2));

    console.log(`\nResults saved to: ${resultsPath}`);
    console.log(`Pass rate: ${passRate}% (${passedRuns}/${totalRuns})`);

    for (const [sceneId, stats] of Object.entries(byScene)) {
      console.log(`  ${sceneId}: ${stats.passRate}% (${stats.passed}/${stats.total})`);
    }

    if (!options.skipReport) {
      console.log("\n=== REPORT ===");
      console.log(`Reports directory: ${reportsDir}`);
    }

    console.log(`\nCompleted: ${framework}`);

    if (passRate < 100) {
      process.exit(1);
    }
  });
