describe("list", () => {
  beforeEach(() => {
    cy.visit("/pomoc");
  });

  it("screenshots", () => {
    cy.wait(500); // Wait for potential animations
    cy.percySnapshot("pomoc-page");
  });
});
