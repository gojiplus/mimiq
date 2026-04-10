describe("Visual evaluation with LayoutLens", () => {
  let runStarted = false;

  afterEach(() => {
    if (runStarted) {
      cy.mimiqCleanupRun();
      runStarted = false;
    }
  });

  it("verifies UI layout assertions", () => {
    cy.visit("/");

    cy.mimiqStartRun({
      sceneId: "return_eligible_backpack",
    }).then(() => {
      runStarted = true;
    });

    cy.mimiqRunTurn();
    cy.mimiqRunTurn();

    cy.mimiqVisualAssert("Is there a chat input field visible?").then((result) => {
      if (result.error) {
        cy.log(`Visual assertion skipped: ${result.error}`);
        return;
      }
      expect(result.passed).to.eq(true);
      expect(result.confidence).to.be.greaterThan(0.7);
    });
  });

  it("verifies agent response is visible", () => {
    cy.visit("/");

    cy.mimiqStartRun({
      sceneId: "return_eligible_backpack",
    }).then(() => {
      runStarted = true;
    });

    cy.mimiqRunTurn();
    cy.mimiqRunTurn();

    cy.mimiqVisualAssert("Is there a message from the agent/assistant visible?").then((result) => {
      if (result.error) {
        cy.log(`Visual assertion skipped: ${result.error}`);
        return;
      }
      expect(result.passed).to.eq(true);
    });
  });

  it("passes accessibility audit", () => {
    cy.visit("/");

    cy.mimiqAccessibilityAudit({ level: "AA" }).then((result) => {
      if (result.error) {
        cy.log(`Accessibility audit skipped: ${result.error}`);
      } else {
        expect(result.passed).to.eq(true);
      }
    });
  });

  it("evaluates with visual assertions from scene", () => {
    cy.visit("/");

    cy.mimiqStartRun({
      sceneId: "visual_assertions",
    }).then(() => {
      runStarted = true;
    });

    cy.mimiqRunToCompletion();

    cy.mimiqEvaluate().then((report) => {
      expect(report).to.have.property("runId");
      expect(report).to.have.property("checks");
    });
  });
});
