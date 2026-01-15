describe("Entity Page Authentication Redirects", () => {
  it("Redirects to login when clicking 'Zaproponuj zmianę' while logged out", () => {
    // Ensure we are logged out
    cy.visit("/entity/person/1");

    // The button might take a moment to appear or be interactive
    cy.contains("Zaproponuj zmianę").click();

    // Should be redirected to login page
    cy.url().should("include", "/login");
    // Optionally check if it has a redirect query param
    // cy.url().should("include", "redirect=/edit/node/1");
  });

  it("Redirects to login when clicking 'Zaproponuj usunięcie' while logged out", () => {
    // Ensure we are logged out
    cy.visit("/entity/person/1");

    cy.contains("Zaproponuj usunięcie").click();

    // For a dialog activator, if we want it to redirect instead of opening dialog
    cy.url().should("include", "/login");
  });

  it("Redirects to login when clicking 'Dodaj artykuł' while logged out", () => {
    // Ensure we are logged out
    cy.visit("/entity/person/1");

    cy.contains("Dodaj artykuł").click();

    cy.url().should("include", "/login");
  });
});
