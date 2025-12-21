describe("Entity Page Data", () => {
  it("Displays content for Person 1 (Jan Kowalski / Politician from PO)", () => {
    cy.visit("/entity/person/1");
    cy.contains("Jan Kowalski").should("exist");
    cy.contains("Politician from PO").should("be.visible");

    cy.get(".v-card-title").should("contain", "Jan Kowalski");
    cy.contains("Orlen").should("be.visible");
    cy.contains("Anna Nowak").should("be.visible");
  });

  it("Displays connected entities with names", () => {
    cy.visit("/entity/person/1");
    cy.get(".v-card").should("have.length.gt", 1);
    cy.contains("Orlen").should("be.visible");
    cy.contains("Anna Nowak").should("be.visible");
  });
});
