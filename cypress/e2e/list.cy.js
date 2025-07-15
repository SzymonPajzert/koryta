describe("list", () => {
  beforeEach(() => {
    cy.visit('/zobacz/lista')
  })

  it("screenshots", () => {
    cy.wait(1500).get("body").matchImageSnapshot();
  });
});
