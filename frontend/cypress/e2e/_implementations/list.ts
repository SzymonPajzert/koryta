describe("list", () => {
  beforeEach(() => {
    cy.visit("/lista");
  });

  it("screenshots", () => {
    cy.wait(500); // Wait for potential animations
    cy.percySnapshot("list-page");
  });
});
