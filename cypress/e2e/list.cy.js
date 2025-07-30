describe("list", () => {
  beforeEach(() => {
    cy.visit("/lista");
  });

  it("screenshots", () => {
    cy.wait(1500).get("body").matchImageSnapshot();
  });
});
