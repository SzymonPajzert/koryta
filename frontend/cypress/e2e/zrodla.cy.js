describe("list", () => {
  beforeEach(() => {
    cy.visit("/zrodla");
  });

  it("screenshots", () => {
    cy.wait(1500).get("body").matchImageSnapshot();
    cy.percySnapshot("zrodla-page");
  });
});
