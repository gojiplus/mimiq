import type {
  AdvanceRunResponse,
  AffordanceSnapshot,
  EvaluationReport,
  RegisterMimiqCommandsOptions,
  RunTrace,
  StartRunRequest,
  VisualAssertionResult,
} from "../types";

const RUN_ID_KEY = "__mimiqCurrentRunId";
const TURN_KEY = "__mimiqTurnCount";

function getRunId(): string {
  const runId = Cypress.env(RUN_ID_KEY);
  if (!runId || typeof runId !== "string") {
    throw new Error(
      "No active mimiq run. Call cy.mimiqStartRun() before running turns.",
    );
  }
  return runId;
}

function getTurnCount(): number {
  return Number(Cypress.env(TURN_KEY) ?? 0);
}

function setTurnCount(turn: number): void {
  Cypress.env(TURN_KEY, turn);
}

export interface AccessibilityAuditOptions {
  level?: "A" | "AA" | "AAA";
}

export interface VisualCompareOptions {
  threshold?: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cypress {
    interface Chainable {
      mimiqStartRun(input: StartRunRequest): Chainable<{ runId: string }>;
      mimiqCaptureSnapshot(): Chainable<AffordanceSnapshot>;
      mimiqRunTurn(): Chainable<AdvanceRunResponse>;
      mimiqRunToCompletion(options?: { maxTurns?: number }): Chainable<void>;
      mimiqEvaluate(): Chainable<EvaluationReport>;
      mimiqGetTrace(): Chainable<RunTrace>;
      mimiqCleanupRun(): Chainable<void>;
      mimiqGetReport(): Chainable<string>;
      mimiqGetAggregateReport(): Chainable<string>;
      mimiqVisualAssert(query: string): Chainable<VisualAssertionResult>;
      mimiqAccessibilityAudit(options?: AccessibilityAuditOptions): Chainable<VisualAssertionResult>;
      mimiqVisualCompare(baselineName: string, options?: VisualCompareOptions): Chainable<VisualAssertionResult>;
    }
  }
}

export function registerMimiqCommands(
  options: RegisterMimiqCommandsOptions,
): void {
  const { browserAdapter, defaults } = options;

  Cypress.Commands.add("mimiqStartRun", (input: StartRunRequest) => {
    return cy.task("mimiq:startRun", input, { log: false }).then((result) => {
      const { runId } = result as { runId: string };
      Cypress.env(RUN_ID_KEY, runId);
      setTurnCount(0);
      return { runId };
    });
  });

  Cypress.Commands.add("mimiqCaptureSnapshot", () => {
    return browserAdapter.captureSnapshot() as Cypress.Chainable<AffordanceSnapshot>;
  });

  Cypress.Commands.add("mimiqRunTurn", () => {
    const runId = getRunId();

    if (defaults?.failOnHealthCheck && browserAdapter.assertHealthy) {
      browserAdapter.assertHealthy();
    }

    return browserAdapter.captureSnapshot().then((snapshot) => {
      return cy
        .task("mimiq:advanceRun", { runId, snapshot }, { log: false })
        .then((response) => {
          const advance = response as AdvanceRunResponse;
          setTurnCount(advance.turn);

          if (advance.action.kind === "done") {
            return cy.wrap(advance);
          }

          return browserAdapter
            .executeAction(advance.action)
            .then(() =>
              browserAdapter.awaitSettled({
                timeoutMs: defaults?.settleTimeoutMs,
              }),
            )
            .then(() => advance);
        });
    }) as Cypress.Chainable<AdvanceRunResponse>;
  });

  Cypress.Commands.add(
    "mimiqRunToCompletion",
    (input?: { maxTurns?: number }) => {
      const maxTurns = input?.maxTurns ?? defaults?.maxTurns ?? 12;

      function loop(): Cypress.Chainable<void> {
        if (getTurnCount() >= maxTurns) {
          throw new Error(
            `Turn budget exceeded before completion. maxTurns=${maxTurns}`,
          );
        }

        return cy.mimiqRunTurn().then((advance) => {
          if (advance.action.kind === "done") {
            return;
          }
          return loop();
        }) as unknown as Cypress.Chainable<void>;
      }

      return loop();
    },
  );

  Cypress.Commands.add("mimiqEvaluate", () => {
    const runId = getRunId();
    return cy.task("mimiq:evaluateRun", { runId }, { log: false }).then((result) => {
      return result as EvaluationReport;
    });
  });

  Cypress.Commands.add("mimiqGetTrace", () => {
    const runId = getRunId();
    return cy.task("mimiq:getTrace", { runId }, { log: false }).then((result) => {
      return result as RunTrace;
    });
  });

  Cypress.Commands.add("mimiqCleanupRun", () => {
    const runId = getRunId();
    return cy.task("mimiq:cleanupRun", { runId }, { log: false }).then(() => {
      Cypress.env(RUN_ID_KEY, undefined);
      setTurnCount(0);
    }) as Cypress.Chainable<void>;
  });

  Cypress.Commands.add("mimiqGetReport", () => {
    const runId = getRunId();
    return cy.task("mimiq:getReport", { runId }, { log: false }) as Cypress.Chainable<string>;
  });

  Cypress.Commands.add("mimiqGetAggregateReport", () => {
    return cy.task("mimiq:getAggregateReport", {}, { log: false }) as Cypress.Chainable<string>;
  });

  Cypress.Commands.add("mimiqVisualAssert", (query: string) => {
    return cy.url().then((url) => {
      return cy.task("mimiq:visualAssert", { url, query }, { log: false }) as Cypress.Chainable<VisualAssertionResult>;
    });
  });

  Cypress.Commands.add("mimiqAccessibilityAudit", (options?: AccessibilityAuditOptions) => {
    return cy.url().then((url) => {
      return cy.task("mimiq:accessibilityAudit", { url, options }, { log: false }) as Cypress.Chainable<VisualAssertionResult>;
    });
  });

  Cypress.Commands.add("mimiqVisualCompare", (baselineName: string, options?: VisualCompareOptions) => {
    return cy.url().then((url) => {
      return cy.task("mimiq:visualCompare", { url, baselineName, options }, { log: false }) as Cypress.Chainable<VisualAssertionResult>;
    });
  });
}
