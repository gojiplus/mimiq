#!/usr/bin/env node
/**
 * Generate aggregate HTML report from all recordings and evaluations.
 *
 * Usage: node generate-report.mjs <outputs_dir>
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function main() {
  const [, , outputsDir] = process.argv;

  if (!outputsDir) {
    console.error("Usage: node generate-report.mjs <outputs_dir>");
    process.exit(1);
  }

  const recordingsDir = path.join(outputsDir, "recordings");
  const evalsFile = path.join(outputsDir, "evals", "visual-evals.json");
  const reportFile = path.join(outputsDir, "reports", "aggregate-report.html");

  // Gather recording data
  const scenes = [];
  if (fs.existsSync(recordingsDir)) {
    for (const sceneName of fs.readdirSync(recordingsDir)) {
      const sceneDir = path.join(recordingsDir, sceneName);
      if (!fs.statSync(sceneDir).isDirectory() || sceneName.startsWith(".")) {
        continue;
      }

      const runs = [];
      for (const runName of fs.readdirSync(sceneDir)) {
        const runDir = path.join(sceneDir, runName);
        if (!fs.statSync(runDir).isDirectory()) continue;

        const metadataFile = path.join(runDir, "metadata.json");
        const transcriptFile = path.join(runDir, "transcript.json");

        let metadata = {};
        let transcript = {};

        if (fs.existsSync(metadataFile)) {
          metadata = JSON.parse(fs.readFileSync(metadataFile, "utf-8"));
        }
        if (fs.existsSync(transcriptFile)) {
          transcript = JSON.parse(fs.readFileSync(transcriptFile, "utf-8"));
        }

        const screenshotsDir = path.join(runDir, "screenshots");
        const screenshots = fs.existsSync(screenshotsDir)
          ? fs.readdirSync(screenshotsDir).filter((f) => f.endsWith(".png"))
          : [];

        runs.push({
          name: runName,
          metadata,
          transcript,
          screenshots: screenshots.length,
          turns: transcript.turns?.length || 0,
          terminalState: transcript.terminalState || "unknown",
          status: metadata.status || "unknown",
        });
      }

      scenes.push({
        name: sceneName,
        runs,
        totalRuns: runs.length,
        avgTurns:
          runs.reduce((sum, r) => sum + r.turns, 0) / runs.length || 0,
      });
    }
  }

  // Load evaluations
  let evaluations = { evaluations: [] };
  if (fs.existsSync(evalsFile)) {
    evaluations = JSON.parse(fs.readFileSync(evalsFile, "utf-8"));
  }

  // Calculate summary stats
  const totalRuns = scenes.reduce((sum, s) => sum + s.totalRuns, 0);
  const totalEvals = evaluations.evaluations.length;
  const evalsPassed = evaluations.evaluations.filter(
    (e) => e.summary.passed === e.summary.total
  ).length;

  // Generate HTML
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mimiq E2E Report</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
      background: #f5f5f5;
    }
    h1, h2, h3 { color: #333; }
    .summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }
    .card {
      background: white;
      border-radius: 8px;
      padding: 20px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .card h3 {
      margin-top: 0;
      color: #666;
      font-size: 14px;
      text-transform: uppercase;
    }
    .card .value {
      font-size: 32px;
      font-weight: bold;
      color: #2196f3;
    }
    .scene {
      background: white;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 20px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .scene h2 {
      margin-top: 0;
      border-bottom: 2px solid #eee;
      padding-bottom: 10px;
    }
    .runs {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 15px;
    }
    .run {
      background: #f9f9f9;
      border-radius: 6px;
      padding: 15px;
      border-left: 4px solid #4caf50;
    }
    .run.failed { border-left-color: #f44336; }
    .run h4 { margin: 0 0 10px 0; }
    .run .stats { font-size: 14px; color: #666; }
    .eval-summary {
      margin-top: 30px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      background: white;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    th, td {
      padding: 12px;
      text-align: left;
      border-bottom: 1px solid #eee;
    }
    th { background: #f5f5f5; font-weight: 600; }
    .pass { color: #4caf50; }
    .fail { color: #f44336; }
    .timestamp {
      color: #999;
      font-size: 12px;
      margin-top: 20px;
    }
  </style>
</head>
<body>
  <h1>Mimiq E2E Test Report</h1>

  <div class="summary">
    <div class="card">
      <h3>Scenes</h3>
      <div class="value">${scenes.length}</div>
    </div>
    <div class="card">
      <h3>Total Runs</h3>
      <div class="value">${totalRuns}</div>
    </div>
    <div class="card">
      <h3>Visual Evals</h3>
      <div class="value">${totalEvals}</div>
    </div>
    <div class="card">
      <h3>Evals Passed</h3>
      <div class="value">${evalsPassed}/${totalEvals}</div>
    </div>
  </div>

  <h2>Scenes</h2>
  ${scenes
    .map(
      (scene) => `
    <div class="scene">
      <h2>${scene.name}</h2>
      <p>${scene.totalRuns} runs, avg ${scene.avgTurns.toFixed(1)} turns</p>
      <div class="runs">
        ${scene.runs
          .map(
            (run) => `
          <div class="run ${run.status === "failed" ? "failed" : ""}">
            <h4>${run.name}</h4>
            <div class="stats">
              <div>Turns: ${run.turns}</div>
              <div>Screenshots: ${run.screenshots}</div>
              <div>Terminal: ${run.terminalState}</div>
            </div>
          </div>
        `
          )
          .join("")}
      </div>
    </div>
  `
    )
    .join("")}

  <div class="eval-summary">
    <h2>Visual Evaluations</h2>
    ${
      evaluations.evaluations.length > 0
        ? `
      <table>
        <thead>
          <tr>
            <th>Scene</th>
            <th>Run</th>
            <th>Screenshot</th>
            <th>Checks</th>
            <th>Confidence</th>
          </tr>
        </thead>
        <tbody>
          ${evaluations.evaluations
            .map(
              (e) => `
            <tr>
              <td>${e.scene}</td>
              <td>${e.run}</td>
              <td>${e.screenshot}</td>
              <td class="${e.summary.passed === e.summary.total ? "pass" : "fail"}">
                ${e.summary.passed}/${e.summary.total}
              </td>
              <td>${(e.summary.avgConfidence * 100).toFixed(0)}%</td>
            </tr>
          `
            )
            .join("")}
        </tbody>
      </table>
    `
        : "<p>No visual evaluations found.</p>"
    }
  </div>

  <p class="timestamp">Generated: ${new Date().toISOString()}</p>
</body>
</html>`;

  fs.writeFileSync(reportFile, html);
  console.log(`Report generated: ${reportFile}`);
  console.log(`  ${scenes.length} scenes, ${totalRuns} runs, ${totalEvals} evaluations`);
}

main();
