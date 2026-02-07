describe("Admin Audit Workflow", () => {
  beforeEach(() => {
    cy.login("admin@koryta.pl", "password123");
  });

  it("should navigate to Audit page and show correct data in tabs", () => {
    cy.visit("/");

    // Ensure we are logged in visibly
    cy.contains("Wyloguj", { timeout: 15000 }).should("be.visible");

    cy.contains("Audyt", { matchCase: false, timeout: 10000 })
      .should("be.visible")
      .click();
    cy.url().should("include", "/admin/audit");
    cy.get("h1").should("contain", "Audyt danych");
    cy.contains(".v-tab", "Oczekujące Rewizje").should("be.visible");
    cy.contains(".v-tab", "Krawędzie bez źródeł").should("be.visible");
  });

  it("should show correct data on Audit page", () => {
    cy.visit("/admin/audit");

    // Wait for loading to finish
    cy.get(".v-progress-circular", { timeout: 10000 }).should("not.exist");

    // Verify results or empty state
    cy.get("body").then(($body) => {
      if ($body.find(".text-body-1:contains('Brak elementów')").length > 0) {
        cy.contains("Brak elementów").should("exist");
      } else {
        // Find inside v-window-item
        cy.get(".v-window-item--active .v-list-item").should("exist");
      }
    });

    // 4. Check My Revisions Tab
    cy.contains(".v-tab", "Moje Propozycje").click();
    cy.url().should("include", "tab=my-revisions");
    // Just verify the tab is active and page didn't crash
    cy.get(".v-window-item--active").should("exist");
  });
});
