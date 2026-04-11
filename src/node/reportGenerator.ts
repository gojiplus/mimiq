/**
 * Report generator for job-level HTML reports.
 */

import { existsSync, writeFileSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import nunjucks from "nunjucks";
import type { JobEvalResults } from "../types";
import { JobManager } from "./jobManager";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function findTemplatesDir(): string {
  const candidates = [
    join(__dirname, "templates"),
    join(__dirname, "..", "templates"),
    join(__dirname, "..", "..", "templates"),
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, "job_summary.html"))) {
      return dir;
    }
  }
  return candidates[0];
}

const templatesDir = findTemplatesDir();
const nunjucksEnv = nunjucks.configure(templatesDir, { autoescape: true });

export interface ReportGeneratorOptions {
  outputDir: string;
  jobId?: string;
}

export class ReportGenerator {
  private jobManager: JobManager | null = null;
  private outputDir: string;

  constructor(options: ReportGeneratorOptions) {
    this.outputDir = options.outputDir;

    if (options.jobId) {
      this.jobManager = JobManager.fromJobId(options.outputDir, options.jobId);
    }
  }

  static fromLatestJob(outputDir: string): ReportGenerator | null {
    const latestJobId = JobManager.findLatestJob(outputDir);
    if (!latestJobId) return null;
    return new ReportGenerator({ outputDir, jobId: latestJobId });
  }

  setJobId(jobId: string): void {
    this.jobManager = JobManager.fromJobId(this.outputDir, jobId);
  }

  generateJobSummary(evalResults: JobEvalResults): string {
    if (!this.jobManager) {
      throw new Error("No job manager configured");
    }

    const manifest = this.jobManager.getManifest();

    return nunjucksEnv.render("job_summary.html", {
      job: manifest,
      summary: evalResults.summary,
      runs: evalResults.runs,
    });
  }

  writeJobSummary(evalResults: JobEvalResults): string {
    if (!this.jobManager) {
      throw new Error("No job manager configured");
    }

    const html = this.generateJobSummary(evalResults);
    const reportsDir = this.jobManager.getReportsDir();
    const reportPath = join(reportsDir, "index.html");
    writeFileSync(reportPath, html);
    return reportPath;
  }

  loadEvalResults(): JobEvalResults | null {
    if (!this.jobManager) return null;

    const evalDir = this.jobManager.getEvalDir();
    const resultsPath = join(evalDir, "results.json");

    if (!existsSync(resultsPath)) return null;

    return JSON.parse(readFileSync(resultsPath, "utf-8")) as JobEvalResults;
  }

  generateAndWriteReport(): string | null {
    const evalResults = this.loadEvalResults();
    if (!evalResults) return null;

    return this.writeJobSummary(evalResults);
  }
}

export function generateJobReport(outputDir: string, jobId?: string): string | null {
  const generator = jobId
    ? new ReportGenerator({ outputDir, jobId })
    : ReportGenerator.fromLatestJob(outputDir);

  if (!generator) return null;

  return generator.generateAndWriteReport();
}
