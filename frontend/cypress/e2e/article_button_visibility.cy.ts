describe("Quick Add Article Button Visibility", () => {
  it("should show 'Dodaj artykuł' button on person page", () => {
    cy.visit("/entity/person/1");
    cy.contains("Jan Kowalski").should("be.visible");
    cy.contains("Dodaj artykuł").should("be.visible");
    cy.percySnapshot("Person Page with Add Article Button");
  });

  it("should NOT show 'Dodaj artykuł' button on article page", () => {
    cy.visit("/entity/article/6");
    cy.contains("Sample Article").should("be.visible");
    cy.contains("Dodaj artykuł").should("not.exist");
    cy.percySnapshot("Article Page without Add Article Button");
  });
});
