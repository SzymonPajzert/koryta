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

  it("Navigates to connected entity page when link is clicked", () => {
    cy.visit("/entity/person/1");
    cy.contains("Orlen").click();
    cy.url().should("include", "/entity/place/");
    cy.get('a[href^="/edit/node/2"]').should("exist");
  });
});
