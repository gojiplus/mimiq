/**
 * RecordingCollector manages artifact writing for enhanced recording.
 * Produces transcript.json, action-log.md, and screenshots.
 */

import { existsSync, mkdirSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";
import type {
  RecordingConfig,
  RecordingMetadata,
  RecordingTranscript,
  RecordingTurn,
  RecordingUiState,
} from "../types";

export const DEFAULT_RECORDING_CONFIG: RecordingConfig = {
  enabled: false,
  outputDir: "./test/recordings",
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
};

export interface RecordingCollectorOptions {
  sceneId: string;
  runId: string;
  config?: Partial<RecordingConfig>;
  runDir?: string;
  runNumber?: number;
}

export class RecordingCollector {
  private config: RecordingConfig;
  private sceneId: string;
  private runId: string;
  private runNumber: number;
  private transcript: RecordingTranscript;
  private metadata: RecordingMetadata;
  private runDir: string;
  private screenshotsDir: string;
  private turnCounter: number = 0;

  constructor(options: RecordingCollectorOptions);
  constructor(sceneId: string, runId: string, config?: Partial<RecordingConfig>);
  constructor(
    optionsOrSceneId: RecordingCollectorOptions | string,
    runId?: string,
    config?: Partial<RecordingConfig>
  ) {
    if (typeof optionsOrSceneId === "string") {
      this.config = { ...DEFAULT_RECORDING_CONFIG, ...config };
      this.sceneId = optionsOrSceneId;
      this.runId = runId!;
      this.runNumber = this.determineRunNumber();
      this.runDir = this.createRunDirectory();
    } else {
      const opts = optionsOrSceneId;
      this.config = { ...DEFAULT_RECORDING_CONFIG, ...opts.config };
      this.sceneId = opts.sceneId;
      this.runId = opts.runId;

      if (opts.runDir && opts.runNumber !== undefined) {
        this.runDir = opts.runDir;
        this.runNumber = opts.runNumber;
        if (this.config.enabled) {
          mkdirSync(this.runDir, { recursive: true });
        }
      } else {
        this.runNumber = this.determineRunNumber();
        this.runDir = this.createRunDirectory();
      }
    }

    this.screenshotsDir = join(this.runDir, "screenshots");

    if (this.config.enabled && this.config.screenshots.enabled) {
      mkdirSync(this.screenshotsDir, { recursive: true });
    }

    this.transcript = {
      runId: this.runId,
      sceneId: this.sceneId,
      startedAt: new Date().toISOString(),
      turns: [],
    };

    this.metadata = {
      runId: this.runId,
      sceneId: this.sceneId,
      runNumber: this.runNumber,
      startedAt: new Date().toISOString(),
      status: "running",
      config: this.config,
    };
  }

  private getSceneBasePath(): string {
    const parts = [this.config.outputDir];
    if (this.config.framework) {
      parts.push(this.config.framework);
    }
    parts.push(this.sceneId);
    return join(...parts);
  }

  private determineRunNumber(): number {
    if (this.config.runNaming === "timestamp") {
      return Date.now();
    }

    const sceneDir = this.getSceneBasePath();
    if (!existsSync(sceneDir)) {
      return 1;
    }

    let maxRun = 0;
    try {
      const entries = readdirSync(sceneDir);
      for (const entry of entries) {
        const match = entry.match(/^run-(\d+)$/);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num > maxRun) maxRun = num;
        }
      }
    } catch {
      // Directory doesn't exist yet
    }

    return maxRun + 1;
  }

  private createRunDirectory(): string {
    const runFolder =
      this.config.runNaming === "sequential"
        ? `run-${String(this.runNumber).padStart(3, "0")}`
        : `run-${this.runNumber}`;

    const dir = join(this.getSceneBasePath(), runFolder);
    if (this.config.enabled) {
      mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  getRunDir(): string {
    return this.runDir;
  }

  getScreenshotsDir(): string {
    return this.screenshotsDir;
  }

  getRunNumber(): number {
    return this.runNumber;
  }

  getScreenshotPath(timing: "before" | "after"): string {
    const turnStr = String(this.turnCounter + 1).padStart(3, "0");
    const ext = this.config.screenshots.format;
    return join(this.screenshotsDir, `turn-${turnStr}-${timing}.${ext}`);
  }

  getRelativeScreenshotPath(timing: "before" | "after"): string {
    const turnStr = String(this.turnCounter + 1).padStart(3, "0");
    const ext = this.config.screenshots.format;
    return `screenshots/turn-${turnStr}-${timing}.${ext}`;
  }

  recordTurn(
    actor: "customer" | "agent",
    type: RecordingTurn["type"],
    options: {
      content?: string;
      target?: string;
      toolCalls?: RecordingTurn["toolCalls"];
      uiState?: RecordingUiState;
      screenshotPath?: string;
    } = {}
  ): void {
    if (!this.config.enabled) return;

    this.turnCounter++;

    const turn: RecordingTurn = {
      turn: this.turnCounter,
      timestamp: new Date().toISOString(),
      actor,
      type,
      ...options,
    };

    if (options.screenshotPath) {
      turn.screenshot = options.screenshotPath;
    }

    this.transcript.turns.push(turn);
  }

  setTerminalState(state: string): void {
    this.transcript.terminalState = state;
  }

  async saveScreenshot(
    screenshotBuffer: Buffer,
    timing: "before" | "after"
  ): Promise<string> {
    if (!this.config.enabled || !this.config.screenshots.enabled) {
      return "";
    }

    const shouldCapture =
      this.config.screenshots.timing === "both" ||
      this.config.screenshots.timing === timing;

    if (!shouldCapture) {
      return "";
    }

    const path = this.getScreenshotPath(timing);
    writeFileSync(path, screenshotBuffer);
    return this.getRelativeScreenshotPath(timing);
  }

  finalize(): void {
    if (!this.config.enabled) return;

    this.transcript.finishedAt = new Date().toISOString();
    this.metadata.finishedAt = new Date().toISOString();
    this.metadata.status = "completed";

    this.writeTranscript();
    if (this.config.actionLog.enabled) {
      this.writeActionLog();
    }
    this.writeMetadata();
  }

  markFailed(): void {
    if (!this.config.enabled) return;

    this.transcript.finishedAt = new Date().toISOString();
    this.metadata.finishedAt = new Date().toISOString();
    this.metadata.status = "failed";

    this.writeTranscript();
    if (this.config.actionLog.enabled) {
      this.writeActionLog();
    }
    this.writeMetadata();
  }

  private writeTranscript(): void {
    const path = join(this.runDir, "transcript.json");
    writeFileSync(path, JSON.stringify(this.transcript, null, 2));
  }

  private writeMetadata(): void {
    const path = join(this.runDir, "metadata.json");
    writeFileSync(path, JSON.stringify(this.metadata, null, 2));
  }

  private writeActionLog(): void {
    const path = join(this.runDir, "action-log.md");
    const content = this.generateActionLogMarkdown();
    writeFileSync(path, content);
  }

  private generateActionLogMarkdown(): string {
    const lines: string[] = [];

    const statusEmoji = this.metadata.status === "completed" ? "✓" : "✗";
    lines.push(
      `# Simulation: ${this.sceneId} (run-${String(this.runNumber).padStart(3, "0")})`
    );
    lines.push("");
    lines.push(`**Started:** ${this.formatTimestamp(this.transcript.startedAt)}`);
    if (this.transcript.finishedAt) {
      lines.push(
        `**Finished:** ${this.formatTimestamp(this.transcript.finishedAt)}`
      );
    }
    if (this.transcript.terminalState) {
      lines.push(`**Terminal State:** ${this.transcript.terminalState} ${statusEmoji}`);
    }
    lines.push("");
    lines.push("---");

    for (const turn of this.transcript.turns) {
      lines.push("");
      lines.push(
        `## Turn ${turn.turn} - ${this.capitalizeFirst(turn.actor)} ${this.capitalizeFirst(turn.type)}`
      );
      lines.push(`**Time:** ${this.formatTime(turn.timestamp)}`);
      lines.push("");

      if (turn.uiState) {
        lines.push(
          `**Screen State:** Agent ${turn.uiState.agentStatus}, ${turn.uiState.visibleMessages} messages visible`
        );
        lines.push("");
      }

      if (turn.type === "message" && turn.content) {
        const label = turn.actor === "customer" ? "Customer said" : "Agent said";
        lines.push(`**${label}:**`);
        lines.push(`> ${turn.content.replace(/\n/g, "\n> ")}`);
      } else if (turn.type === "click" && turn.target) {
        lines.push(`**Customer clicked:** \`${turn.target}\``);
      } else if (turn.type === "type" && turn.target && turn.content) {
        lines.push(`**Customer typed in \`${turn.target}\`:** "${turn.content}"`);
      }

      if (turn.toolCalls && turn.toolCalls.length > 0) {
        lines.push("");
        lines.push("**Tools Called:**");
        for (const tc of turn.toolCalls) {
          const argsStr = JSON.stringify(tc.args);
          const resultStr = tc.result ? ` → \`${JSON.stringify(tc.result)}\`` : "";
          lines.push(`- \`${tc.tool}(${argsStr})\`${resultStr}`);
        }
      }

      if (turn.screenshot) {
        lines.push("");
        lines.push(`![Before](${turn.screenshot})`);
      }

      lines.push("");
      lines.push("---");
    }

    return lines.join("\n");
  }

  private formatTimestamp(iso: string): string {
    const d = new Date(iso);
    return d.toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
  }

  private formatTime(iso: string): string {
    const d = new Date(iso);
    return d.toTimeString().split(" ")[0];
  }

  private capitalizeFirst(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
}
