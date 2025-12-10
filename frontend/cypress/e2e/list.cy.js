describe("list", () => {
  beforeEach(() => {
    cy.visit("/lista");
  });

  it("screenshots", () => {
    cy.get("body").should("be.visible");
    cy.get(".v-card").should("have.length.greaterThan", 0);
    // Snapshot the entire document to avoid zero-height body issues
    cy.document().matchImageSnapshot();
    cy.percySnapshot("list-page");
  });
});
