describe("Revisions Flow", () => {
  beforeEach(() => {
    // Ensure clean state handled by seed-emulator mostly, but login is key
    cy.login(); // Custom command if available, or just mock auth
  });

  it("should display pending revisions and allow navigation to details", () => {
    // Visit revisions page
    cy.visit("/revisions");
    cy.contains("Lista Rewizji (Do Przejrzenia)");

    // Find the list item for "Not approved person" and click it to unfold
    // We target the text and force checking bubbling to the activator
    cy.contains(".v-list-item", "Not approved person").click();
    // Wait for unfolding
    cy.wait(500);
    cy.percySnapshot("Revisions List one unfolded");

    // Look for the specific revision link associated with this person
    // Scope search to the group containing "Not approved person"
    cy.contains(".v-list-group", "Not approved person").within(() => {
      cy.contains("Rewizja z").click({ force: true });
    });

    // Verify redirection to details page for h1
    cy.url().should("include", "/entity/person/h1/rev-h1");

    // Verify details page content
    cy.contains("Szczegóły Rewizji").should("be.visible");
    cy.contains("Podgląd wersji").should("be.visible");
    cy.contains("Not approved person (Updated)").should("be.visible");
  });
});
