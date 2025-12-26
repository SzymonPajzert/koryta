describe("list", () => {
  beforeEach(() => {
    cy.visit("/zrodla");
  });

  it("screenshots", () => {
    cy.wait(500); // Wait for potential animations
    cy.percySnapshot("zrodla-page");
  });
});
