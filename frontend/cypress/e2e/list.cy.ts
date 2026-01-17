describe("list", () => {
  beforeEach(() => {
    cy.visit("/lista");
  });

  it("screenshots", () => {
    cy.matchImageSnapshot("list-page");
  });
});
