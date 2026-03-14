describe("support return flow", () => {
  afterEach(() => {
    cy.mimiqCleanupRun();
  });

  it("creates a return for an eligible order", () => {
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

  it("denies return for non-returnable items and escalates", () => {
    cy.visit("/");

    cy.mimiqStartRun({
      sceneId: "return_needs_handoff",
    });

    cy.mimiqRunToCompletion();

    cy.mimiqEvaluate().then((report) => {
      expect(report.passed).to.eq(true);
      const isEscalated = report.terminalState === "escalated_to_human";
      const isDenied = report.terminalState === "return_denied_policy";
      expect(isEscalated || isDenied).to.eq(true);
    });

    cy.mimiqGetTrace().then((trace) => {
      expect(trace.entries.some((entry) => entry.name === "lookup_order")).to.eq(true);
      expect(trace.entries.some((entry) => entry.name === "get_return_policy")).to.eq(true);
      expect(trace.entries.some((entry) => entry.name === "create_return")).to.eq(false);
    });
  });

  it("provides order tracking info", () => {
    cy.visit("/");

    cy.mimiqStartRun({
      sceneId: "track_order_via_button",
    });

    cy.mimiqRunToCompletion();

    cy.mimiqEvaluate().then((report) => {
      expect(report.passed).to.eq(true);
      expect(report.terminalState).to.eq("order_info_provided");
    });

    cy.mimiqGetTrace().then((trace) => {
      expect(trace.entries.some((entry) => entry.name === "lookup_order")).to.eq(true);
    });
  });
});
