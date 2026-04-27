describe("/entity/destination/id", () => {
  it("shows results for /entity/region/teryt1465", () => {
    cy.visit("/entity/region/teryt1465");
    cy.contains("Część regionu").should("be.visible");
    cy.contains("Regiony").should("be.visible");
    cy.contains("Spółki zależne").should("be.visible");
  });
});
