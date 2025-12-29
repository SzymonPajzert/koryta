describe("Edit Edge Revision", () => {
  beforeEach(() => {
    cy.task("log", "Starting test: " + Cypress.currentTest.title);
    // Clear indexedDB to avoid stale auth state
    cy.window().then((win) => {
      return new Cypress.Promise((resolve) => {
        const req = win.indexedDB.deleteDatabase("firebaseLocalStorageDb");
        req.onsuccess = resolve;
        req.onerror = resolve;
        req.onblocked = resolve;
      });
    });
  });

  it("allows modifying an existing edge and saves a revision", () => {
    // 1. Login
    cy.login();

    // 2. Go to edit page for Jan Kowalski (node 1)
    cy.visit("/edit/node/1");
    cy.contains("Treść i Powiązania").should("be.visible");

    // 3. Find an existing edge (Anna Nowak) and click edit
    cy.contains("Powiązania").should("be.visible");
    cy.contains(".v-list-item", "Anna Nowak")
      .find("button.v-btn--icon")
      .click();

    // 4. Verify form populated
    cy.contains("h4", "Edytuj powiązanie").should("be.visible");

    // 5. Modify name and text
    cy.contains("label", "Nazwa relacji")
      .parent()
      .find("input")
      .clear()
      .type("Updated Relation Name");

    cy.contains("label", "Opis relacji")
      .parent()
      .find("input")
      .clear()
      .type("Updated Relation Description");

    // 6. Save
    cy.contains("button", "Zapisz zmiany").click();

    // 7. Verify success alert (assuming standard alert behavior is mocked or visible)
    cy.on("window:alert", (str) => {
      expect(str).to.equal("Zapisano propozycję zmiany!");
    });

    // 8. Verify form reset to add mode
    cy.contains("h4", "Dodaj nowe powiązanie").should("be.visible");
  });
});
