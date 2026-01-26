describe("Revisions Flow", () => {
  beforeEach(() => {
    // Ensure clean state handled by seed-emulator mostly, but login is key
    cy.login(); // Custom command if available, or just mock auth
  });

  it("should display pending revisions and allow navigation to details", () => {
    cy.visit("/revisions");
    cy.contains("Lista Rewizji (Do Przejrzenia)");

    cy.contains(".v-list-item", "Not approved person").click();
    cy.wait(500);
    cy.percySnapshot("Revisions List one unfolded");

    cy.contains(".v-list-group", "Not approved person").within(() => {
      cy.contains("Rewizja z").click({ force: true });
    });

    cy.url().should("include", "/entity/person/h1/rev-h1");

    cy.contains("Szczegóły Rewizji").should("be.visible");
    cy.contains("Podgląd wersji").should("be.visible");
    cy.contains("Not approved person (Updated)").should("be.visible");
  });
});
