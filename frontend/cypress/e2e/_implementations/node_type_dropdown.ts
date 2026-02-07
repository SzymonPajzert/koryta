describe("Node Type Dropdown", () => {
  beforeEach(() => {
    cy.refreshAuth();
    cy.login();
  });

  it("should display 'Firma' when type is 'place'", () => {
    cy.visit("/edit/node/new?type=place");
    cy.verifyFieldContent("Typ", "Firma");
  });
});
