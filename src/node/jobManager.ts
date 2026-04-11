/**
 * JobManager: Manages job creation, discovery, and manifest for grouping runs.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { Framework, JobConfig, JobManifest } from "../types";

function generateJobId(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  const time = now.toTimeString().slice(0, 8).replace(/:/g, "");
  const rand = Math.random().toString(36).substring(2, 6);
  return `${date}-${time}-${rand}`;
}

export class JobManager {
  private outputDir: string;
  private jobId: string;
  private jobDir: string;
  private manifest: JobManifest;

  constructor(config: JobConfig) {
    this.outputDir = config.outputDir;
    this.jobId = config.jobId || generateJobId();
    this.jobDir = join(this.outputDir, `job-${this.jobId}`);

    mkdirSync(this.jobDir, { recursive: true });

    this.manifest = {
      jobId: this.jobId,
      createdAt: new Date().toISOString(),
      config,
      status: "running",
      scenesRun: [],
      runsPerScene: config.runs,
      totalRuns: 0,
      completedRuns: 0,
    };

    this.saveManifest();
  }

  static fromJobId(outputDir: string, jobId: string): JobManager | null {
    const jobDir = join(outputDir, `job-${jobId}`);
    const manifestPath = join(jobDir, "manifest.json");

    if (!existsSync(manifestPath)) {
      return null;
    }

    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as JobManifest;
    const manager = Object.create(JobManager.prototype) as JobManager;
    manager.outputDir = outputDir;
    manager.jobId = jobId;
    manager.jobDir = jobDir;
    manager.manifest = manifest;
    return manager;
  }

  static findLatestJob(outputDir: string): string | null {
    if (!existsSync(outputDir)) {
      return null;
    }

    const entries = readdirSync(outputDir)
      .filter((e) => e.startsWith("job-"))
      .sort()
      .reverse();

    if (entries.length === 0) {
      return null;
    }

    return entries[0].replace("job-", "");
  }

  static listJobs(outputDir: string): JobManifest[] {
    if (!existsSync(outputDir)) {
      return [];
    }

    const jobs: JobManifest[] = [];
    const entries = readdirSync(outputDir).filter((e) => e.startsWith("job-"));

    for (const entry of entries) {
      const manifestPath = join(outputDir, entry, "manifest.json");
      if (existsSync(manifestPath)) {
        const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as JobManifest;
        jobs.push(manifest);
      }
    }

    return jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getJobId(): string {
    return this.jobId;
  }

  getJobDir(): string {
    return this.jobDir;
  }

  getManifest(): JobManifest {
    return this.manifest;
  }

  getFrameworkDir(framework: Framework): string {
    const dir = join(this.jobDir, framework);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  getSceneDir(framework: Framework, sceneId: string): string {
    const dir = join(this.getFrameworkDir(framework), sceneId);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  getRunDir(framework: Framework, sceneId: string, runNumber: number): string {
    const runFolder = `run-${String(runNumber).padStart(3, "0")}`;
    const dir = join(this.getSceneDir(framework, sceneId), runFolder);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  getEvalDir(): string {
    const dir = join(this.jobDir, "eval");
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  getReportsDir(): string {
    const dir = join(this.jobDir, "reports");
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  addScene(sceneId: string): void {
    if (!this.manifest.scenesRun.includes(sceneId)) {
      this.manifest.scenesRun.push(sceneId);
      this.manifest.totalRuns = this.manifest.scenesRun.length * this.manifest.runsPerScene;
      this.saveManifest();
    }
  }

  incrementCompletedRuns(): void {
    this.manifest.completedRuns++;
    this.saveManifest();
  }

  markCompleted(): void {
    this.manifest.status = "completed";
    this.manifest.finishedAt = new Date().toISOString();
    this.saveManifest();
  }

  markFailed(): void {
    this.manifest.status = "failed";
    this.manifest.finishedAt = new Date().toISOString();
    this.saveManifest();
  }

  private saveManifest(): void {
    const path = join(this.jobDir, "manifest.json");
    writeFileSync(path, JSON.stringify(this.manifest, null, 2));
  }

  getNextRunNumber(framework: Framework, sceneId: string): number {
    const sceneDir = join(this.getFrameworkDir(framework), sceneId);
    if (!existsSync(sceneDir)) {
      return 1;
    }

    let maxRun = 0;
    const entries = readdirSync(sceneDir);
    for (const entry of entries) {
      const match = entry.match(/^run-(\d+)$/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxRun) maxRun = num;
      }
    }

    return maxRun + 1;
  }

  collectRunTranscripts(): Array<{
    sceneId: string;
    runNumber: number;
    transcriptPath: string;
    metadataPath: string;
  }> {
    const results: Array<{
      sceneId: string;
      runNumber: number;
      transcriptPath: string;
      metadataPath: string;
    }> = [];

    const framework = this.manifest.config.framework;
    const frameworkDir = join(this.jobDir, framework);

    if (!existsSync(frameworkDir)) {
      return results;
    }

    for (const sceneId of readdirSync(frameworkDir)) {
      const sceneDir = join(frameworkDir, sceneId);
      if (!existsSync(sceneDir)) continue;

      for (const runEntry of readdirSync(sceneDir)) {
        const match = runEntry.match(/^run-(\d+)$/);
        if (!match) continue;

        const runNumber = parseInt(match[1], 10);
        const runDir = join(sceneDir, runEntry);
        const transcriptPath = join(runDir, "transcript.json");
        const metadataPath = join(runDir, "metadata.json");

        if (existsSync(transcriptPath)) {
          results.push({ sceneId, runNumber, transcriptPath, metadataPath });
        }
      }
    }

    return results.sort((a, b) => {
      if (a.sceneId !== b.sceneId) return a.sceneId.localeCompare(b.sceneId);
      return a.runNumber - b.runNumber;
    });
  }
}
