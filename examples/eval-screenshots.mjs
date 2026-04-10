#!/usr/bin/env node
/**
 * Evaluate screenshots using LayoutLens visual assertions.
 *
 * Usage: node eval-screenshots.mjs <scene> <run> <screenshots_dir> <output_file>
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Import from built package
const mimiqPath = path.join(__dirname, "..", "dist", "index.js");

async function main() {
  const [, , sceneName, runName, screenshotsDir, outputFile] = process.argv;

  if (!sceneName || !runName || !screenshotsDir || !outputFile) {
    console.error(
      "Usage: node eval-screenshots.mjs <scene> <run> <screenshots_dir> <output_file>"
    );
    process.exit(1);
  }

  // Get list of screenshots
  const screenshots = fs
    .readdirSync(screenshotsDir)
    .filter((f) => f.endsWith(".png"))
    .sort();

  if (screenshots.length === 0) {
    console.log(`  No screenshots found in ${screenshotsDir}`);
    return;
  }

  const evaluations = [];

  for (const screenshot of screenshots) {
    const screenshotPath = path.join(screenshotsDir, screenshot);
    const imageBase64 = fs.readFileSync(screenshotPath, "base64");

    // Run visual assertions
    const queries = [
      "Is there a chat interface visible?",
      "Is there a message input field?",
      "Are there any error messages visible?",
      "Is the UI properly laid out?",
    ];

    const results = [];

    try {
      // Dynamic import of mimiq
      const { completeWithImage } = await import(mimiqPath);

      for (const query of queries) {
        const prompt = `Answer this question about the screenshot with YES or NO, followed by a confidence score 0-100:
${query}

Format: YES|NO <confidence>`;

        const response = await completeWithImage(prompt, imageBase64, {
          model: process.env.LLM_MODEL || "openai/gpt-4o",
        });

        const match = response.match(/(YES|NO)\s*(\d+)?/i);
        if (match) {
          results.push({
            query,
            passed: match[1].toUpperCase() === "YES",
            confidence: parseInt(match[2] || "80") / 100,
            response: response.trim(),
          });
        }
      }
    } catch (error) {
      console.log(`  Error evaluating ${screenshot}: ${error.message}`);
      results.push({
        query: "evaluation",
        passed: false,
        confidence: 0,
        error: error.message,
      });
    }

    evaluations.push({
      scene: sceneName,
      run: runName,
      screenshot,
      timestamp: new Date().toISOString(),
      results,
      summary: {
        total: results.length,
        passed: results.filter((r) => r.passed).length,
        avgConfidence:
          results.reduce((sum, r) => sum + (r.confidence || 0), 0) /
          results.length,
      },
    });
  }

  // Append to output file
  let existing = { evaluations: [] };
  if (fs.existsSync(outputFile)) {
    try {
      existing = JSON.parse(fs.readFileSync(outputFile, "utf-8"));
    } catch {
      existing = { evaluations: [] };
    }
  }

  existing.evaluations.push(...evaluations);
  fs.writeFileSync(outputFile, JSON.stringify(existing, null, 2));

  const totalPassed = evaluations.reduce(
    (sum, e) => sum + e.summary.passed,
    0
  );
  const totalChecks = evaluations.reduce(
    (sum, e) => sum + e.summary.total,
    0
  );
  console.log(
    `  Evaluated ${screenshots.length} screenshots: ${totalPassed}/${totalChecks} checks passed`
  );
}

main().catch(console.error);
