describe("list", () => {
  beforeEach(() => {
    cy.visit("/pomoc");
  });

  it("screenshots", () => {
    cy.wait(1500).get("body").matchImageSnapshot();
  });
});
