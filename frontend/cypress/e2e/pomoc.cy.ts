describe("list", () => {
  beforeEach(() => {
    cy.visit("/pomoc");
  });

  it("screenshots", () => {
    cy.percySnapshot("pomoc-page");
  });
});
