/**
 * report command: Generate HTML reports from eval results.
 */

import { Command } from "commander";
import { JobManager } from "../../node/jobManager";
import { generateJobReport } from "../../node/reportGenerator";

interface ReportOptions {
  output: string;
  jobId?: string;
  latest?: boolean;
}

export const reportCommand = new Command("report")
  .description("Generate HTML reports from eval results")
  .option("-o, --output <dir>", "Output directory containing jobs", "./recordings")
  .option("--job-id <id>", "Job ID to report on")
  .option("--latest", "Use most recent job")
  .action(async (options: ReportOptions) => {
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

    console.log(`Generating report for job: ${jobManager.getJobId()}`);

    const reportPath = generateJobReport(options.output, jobId);

    if (!reportPath) {
      console.error("No eval results found. Run 'mimiq eval' first.");
      process.exit(1);
    }

    console.log(`Report generated: ${reportPath}`);
  });
