describe("list", () => {
  beforeEach(() => {
    cy.visit("/zrodla");
  });

  it("screenshots", () => {
    cy.matchImageSnapshot("zrodla-page");
  });
});
