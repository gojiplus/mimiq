#!/usr/bin/env node
/**
 * Mimiq CLI - Simulation, Evaluation, and Reporting pipeline.
 */

import { Command } from "commander";
import { evalCommand } from "./commands/eval";
import { reportCommand } from "./commands/report";
import { listCommand } from "./commands/list";
import { agentCommand } from "./commands/agent";

const program = new Command();

program
  .name("mimiq")
  .description("Application-layer user simulation with replayable browser evidence")
  .version("0.3.0");

program.addCommand(evalCommand);
program.addCommand(reportCommand);
program.addCommand(listCommand);
program.addCommand(agentCommand);

program.parse();
