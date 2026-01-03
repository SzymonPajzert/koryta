describe("list", () => {
  beforeEach(() => {
    cy.visit("/lista");
  });

  it("screenshots", () => {
    cy.percySnapshot("list-page");
  });
});
