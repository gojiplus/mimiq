import type { SetupMimiqTasksOptions } from "../types";

export function setupMimiqTasks(
  on: Cypress.PluginEvents,
  options: SetupMimiqTasksOptions,
): void {
  const { runtime } = options;

  on("task", {
    async "mimiq:startRun"(input) {
      return runtime.startRun(input);
    },

    async "mimiq:advanceRun"(input) {
      return runtime.advanceRun(input);
    },

    async "mimiq:evaluateRun"(input) {
      return runtime.evaluateRun(input);
    },

    async "mimiq:getTrace"(input) {
      return runtime.getTrace(input);
    },

    async "mimiq:cleanupRun"(input) {
      await runtime.cleanupRun(input);
      return null;
    },

    async "mimiq:getReport"(input) {
      return runtime.getReport(input);
    },

    async "mimiq:getAggregateReport"() {
      return runtime.getAggregateReport({});
    },
  });
}
