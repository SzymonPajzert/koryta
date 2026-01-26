describe("graph", () => {
  Cypress.on("uncaught:exception", () => {
    // returning false here prevents Cypress from
    // failing the test
    return false;
  });

  beforeEach(() => {
    cy.visit("/graf");
  });

  context("shows dialog for each node", () => {
    beforeEach(() => {
      // Clear filters or set default
      cy.visit("/graf");
    });

    it("normally doesn't see a dialog", () => {
      cy.get(".v-overlay__content").should("not.exist");
    });
  });
});
