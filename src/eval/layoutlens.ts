/**
 * LayoutLens integration for visual assertions and accessibility audits.
 * Supports both CLI (child process) and HTTP bridge modes.
 */

import { spawn } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

export interface LayoutLensResult {
  passed: boolean;
  answer: string;
  confidence: number;
  reasoning?: string;
  screenshotPath?: string;
  error?: string;
}

export interface LayoutLensConfig {
  pythonPath?: string;
  timeout?: number;
  screenshotDir?: string;
  httpEndpoint?: string;
}

export interface VisualAssertionConfig {
  query: string;
  minConfidence?: number;
}

export interface AccessibilityAuditConfig {
  level?: "A" | "AA" | "AAA";
  requiredPass?: boolean;
}

export interface VisualCompareConfig {
  baselineName: string;
  threshold?: number;
}

function ensureScreenshotDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function runLayoutLensHttp(
  endpoint: string,
  path: string,
  body: Record<string, unknown>,
  timeout: number = 60000
): Promise<LayoutLensResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const url = `${endpoint}${path}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        passed: false,
        answer: "",
        confidence: 0,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const result = await response.json();
    return {
      passed: result.passed ?? (result.confidence >= 0.8),
      answer: result.answer || "",
      confidence: result.confidence || 0,
      reasoning: result.reasoning,
      screenshotPath: result.screenshot_path,
      error: result.error,
    };
  } catch (err) {
    clearTimeout(timeoutId);
    const message = err instanceof Error ? err.message : String(err);
    return {
      passed: false,
      answer: "",
      confidence: 0,
      error: `HTTP request failed: ${message}`,
    };
  }
}

async function runLayoutLensCommand(
  args: string[],
  config: LayoutLensConfig = {}
): Promise<LayoutLensResult> {
  const pythonPath = config.pythonPath || "python";
  const timeout = config.timeout || 60000;

  return new Promise((resolve) => {
    const proc = spawn(pythonPath, ["-m", "layoutlens.cli", ...args], {
      timeout,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("error", (err) => {
      resolve({
        passed: false,
        answer: "",
        confidence: 0,
        error: `Failed to spawn layoutlens: ${err.message}. Make sure layoutlens is installed: pip install layoutlens`,
      });
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        resolve({
          passed: false,
          answer: "",
          confidence: 0,
          error: `LayoutLens exited with code ${code}: ${stderr}`,
        });
        return;
      }

      try {
        const result = JSON.parse(stdout.trim());
        resolve({
          passed: result.passed ?? (result.confidence >= 0.8),
          answer: result.answer || "",
          confidence: result.confidence || 0,
          reasoning: result.reasoning,
          screenshotPath: result.screenshot_path,
        });
      } catch {
        resolve({
          passed: false,
          answer: stdout.trim(),
          confidence: 0,
          error: `Failed to parse layoutlens output: ${stdout}`,
        });
      }
    });
  });
}

export async function visualAssert(
  source: string,
  query: string,
  config: LayoutLensConfig = {}
): Promise<LayoutLensResult> {
  if (config.httpEndpoint) {
    return runLayoutLensHttp(
      config.httpEndpoint,
      "/analyze",
      { source, query },
      config.timeout
    );
  }

  const args = ["analyze", source, query, "--output", "json"];
  return runLayoutLensCommand(args, config);
}

export async function accessibilityAudit(
  source: string,
  options: AccessibilityAuditConfig = {},
  config: LayoutLensConfig = {}
): Promise<LayoutLensResult> {
  const level = options.level || "AA";

  if (config.httpEndpoint) {
    return runLayoutLensHttp(
      config.httpEndpoint,
      "/accessibility-audit",
      { source, level },
      config.timeout
    );
  }

  const args = [
    "audit-accessibility",
    source,
    "--level",
    level,
    "--output",
    "json",
  ];

  return runLayoutLensCommand(args, config);
}

export async function visualCompare(
  source: string,
  baselinePath: string,
  options: VisualCompareConfig,
  config: LayoutLensConfig = {}
): Promise<LayoutLensResult> {
  const threshold = options.threshold ?? 0.95;

  if (config.httpEndpoint) {
    return runLayoutLensHttp(
      config.httpEndpoint,
      "/compare",
      { source, baseline: baselinePath, threshold },
      config.timeout
    );
  }

  const args = [
    "compare",
    source,
    baselinePath,
    "--threshold",
    String(threshold),
    "--output",
    "json",
  ];

  return runLayoutLensCommand(args, config);
}

export async function captureAndAssert(
  url: string,
  query: string,
  config: LayoutLensConfig = {}
): Promise<LayoutLensResult> {
  const screenshotDir = config.screenshotDir || path.join(os.tmpdir(), "mimiq-screenshots");
  ensureScreenshotDir(screenshotDir);

  return visualAssert(url, query, config);
}

export async function runVisualAssertions(
  url: string,
  assertions: VisualAssertionConfig[],
  config: LayoutLensConfig = {}
): Promise<{
  passed: boolean;
  results: Array<{
    query: string;
    result: LayoutLensResult;
    passed: boolean;
  }>;
}> {
  const results: Array<{
    query: string;
    result: LayoutLensResult;
    passed: boolean;
  }> = [];

  for (const assertion of assertions) {
    const minConfidence = assertion.minConfidence ?? 0.8;
    const result = await visualAssert(url, assertion.query, config);
    const passed = !result.error && result.confidence >= minConfidence;

    results.push({
      query: assertion.query,
      result,
      passed,
    });
  }

  return {
    passed: results.every((r) => r.passed),
    results,
  };
}

export async function checkLayoutLensServer(
  endpoint: string,
  timeout: number = 5000
): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(`${endpoint}/health`, {
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return response.ok;
  } catch {
    return false;
  }
}

export function createLayoutLensClient(config: LayoutLensConfig = {}) {
  return {
    visualAssert: (source: string, query: string) =>
      visualAssert(source, query, config),
    accessibilityAudit: (source: string, options?: AccessibilityAuditConfig) =>
      accessibilityAudit(source, options, config),
    visualCompare: (
      source: string,
      baselinePath: string,
      options: VisualCompareConfig
    ) => visualCompare(source, baselinePath, options, config),
    runVisualAssertions: (url: string, assertions: VisualAssertionConfig[]) =>
      runVisualAssertions(url, assertions, config),
    checkServer: () =>
      config.httpEndpoint
        ? checkLayoutLensServer(config.httpEndpoint, config.timeout)
        : Promise.resolve(false),
  };
}

export function createHttpLayoutLensClient(
  endpoint: string = "http://localhost:8765",
  timeout: number = 60000
) {
  return createLayoutLensClient({
    httpEndpoint: endpoint,
    timeout,
  });
}
