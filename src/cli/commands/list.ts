/**
 * list command: List jobs in output directory.
 */

import { Command } from "commander";
import { JobManager } from "../../node/jobManager";

interface ListOptions {
  output: string;
}

export const listCommand = new Command("list")
  .description("List jobs in output directory")
  .option("-o, --output <dir>", "Output directory containing jobs", "./recordings")
  .action(async (options: ListOptions) => {
    const jobs = JobManager.listJobs(options.output);

    if (jobs.length === 0) {
      console.log("No jobs found");
      return;
    }

    console.log(`Found ${jobs.length} job(s):\n`);

    for (const job of jobs) {
      const statusEmoji = job.status === "completed" ? "✓" : job.status === "running" ? "…" : "✗";
      const runInfo = `${job.completedRuns}/${job.totalRuns} runs`;
      const framework = job.config.framework;

      console.log(`${statusEmoji} ${job.jobId}`);
      console.log(`    Framework: ${framework}`);
      console.log(`    Status: ${job.status}`);
      console.log(`    Runs: ${runInfo}`);
      console.log(`    Scenes: ${job.scenesRun.join(", ") || "none"}`);
      console.log(`    Created: ${job.createdAt}`);
      if (job.finishedAt) {
        console.log(`    Finished: ${job.finishedAt}`);
      }
      console.log();
    }
  });
