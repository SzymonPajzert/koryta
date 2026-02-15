describe("local graph", () => {
  it("shows local graph with current node and neighbors", () => {
    // Visit main graph first to find a valid node
    cy.visit("/graf");
    // Wait for graph to load
    cy.get("svg", { timeout: 10000 }).should("exist");
    // Find node by label and click it
    cy.contains("text", "Osoba Testowa").click({ force: true });
    cy.url().should("include", "/entity/person/");

    cy.get("svg").should("exist");
    cy.contains("Osoba Testowa").should("exist");
    // Check for a known neighbor
    cy.contains("Firma Testowa").should("exist");
  });
});
