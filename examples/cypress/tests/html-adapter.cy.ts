describe("HTML-based simulation", () => {
  afterEach(() => {
    cy.mimiqCleanupRun();
  });

  it("completes return flow using HTML adapter", () => {
    cy.visit("/");

    cy.mimiqStartRun({
      sceneId: "return_eligible_backpack",
    });

    cy.mimiqRunToCompletion();

    cy.mimiqEvaluate().then((report) => {
      expect(report.passed).to.eq(true);
      expect(report.terminalState).to.eq("return_created");
    });

    cy.mimiqGetTrace().then((trace) => {
      expect(trace.entries.some((entry) => entry.name === "lookup_order")).to.eq(true);
      expect(trace.entries.some((entry) => entry.name === "create_return")).to.eq(true);
    });
  });

  it("handles complex conversation using HTML adapter", () => {
    cy.visit("/");

    cy.mimiqStartRun({
      sceneId: "return_needs_handoff",
    });

    cy.mimiqRunToCompletion();

    cy.mimiqEvaluate().then((report) => {
      expect(report.passed).to.eq(true);
    });
  });
});
