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

  it("should filter out empty regions and companies in the Graph view", () => {
    // Ensure graph loads
    cy.get("svg").should("exist");

    // The graph renders nodes as text elements or similar.
    // We check if the text for empty entities is absent.
    cy.contains("Województwo Puste").should("not.exist");
    cy.contains("Firma Pusta").should("not.exist");
  });

  it("should show valid chain of connected entities in the Graph view", () => {
    // Ensure graph loads
    cy.get("svg").should("exist");

    // Verify positive cases are present in the graph
    cy.contains("Osoba Testowa").should("exist");
    cy.contains("Firma Testowa").should("exist");
    cy.contains("Województwo Testowe").should("exist");
    cy.contains("Powiat Testowy").should("exist");
  });
});
