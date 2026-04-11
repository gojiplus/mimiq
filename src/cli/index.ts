#!/usr/bin/env node
/**
 * Mimiq CLI - Simulation, Evaluation, and Reporting pipeline.
 */

import { Command } from "commander";
import { simCommand } from "./commands/sim";
import { evalCommand } from "./commands/eval";
import { reportCommand } from "./commands/report";
import { runCommand } from "./commands/run";
import { listCommand } from "./commands/list";
import { agentCommand } from "./commands/agent";

const program = new Command();

program
  .name("mimiq")
  .description("Simulate users and evaluate AI agents in e2e tests")
  .version("0.3.0");

program.addCommand(simCommand);
program.addCommand(evalCommand);
program.addCommand(reportCommand);
program.addCommand(runCommand);
program.addCommand(listCommand);
program.addCommand(agentCommand);

program.parse();
