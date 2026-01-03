describe("list", () => {
  beforeEach(() => {
    cy.visit("/zrodla");
  });

  it("screenshots", () => {
    cy.percySnapshot("zrodla-page");
  });
});
