describe("list", () => {
  beforeEach(() => {
    cy.visit("/pomoc");
  });

  it("screenshots", () => {
    cy.matchImageSnapshot("pomoc-page");
  });
});
