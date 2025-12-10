describe("list", () => {
  beforeEach(() => {
    cy.visit("/zrodla");
  });

  it("screenshots", () => {
    cy.get("body").should("be.visible");
    // Snapshot the entire document to avoid zero-height body issues
    cy.document().matchImageSnapshot();
    cy.percySnapshot("zrodla-page");
  });
});
