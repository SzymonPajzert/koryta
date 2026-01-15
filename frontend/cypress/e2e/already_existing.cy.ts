describe("Already Existing Suggestions", () => {
  beforeEach(() => {
    cy.viewport(1280, 800);
    cy.login();
  });

  it("shows suggestions for similar names and navigates to existing page", () => {
    // 1. Visit create page
    cy.visit("/edit/node/new");
    cy.wait(3000); // Give plenty of time for initialization

    // 2. Try adding a person (similar to "Jan Kowalski")
    cy.get('[data-testid="already-existing-input"]').type("Jan", {
      force: true,
    });

    // Check if suggestions list appears
    cy.get('[data-testid="similar-suggestions"]', { timeout: 15000 }).should(
      "be.visible",
    );
    cy.contains("Jan Kowalski").should("be.visible");

    // 3. Try adding a person with a second name added
    cy.get('[data-testid="already-existing-input"]')
      .clear({ force: true })
      .type("Jan Marian", { force: true });

    cy.get('[data-testid="similar-suggestions"]', { timeout: 15000 }).should(
      "be.visible",
    );
    cy.contains("Jan Kowalski").should("be.visible");

    // 4. User is able to click the listing and go to the existing page
    cy.contains("Jan Kowalski").click();

    // Verify navigation to existing node (Jan Kowalski has id 1)
    cy.url({ timeout: 10000 }).should("include", "/edit/node/1");
    cy.contains("h1", "Edytuj");
    cy.get('[data-testid="already-existing-input"]').should(
      "have.value",
      "Jan Kowalski",
    );
  });
});
