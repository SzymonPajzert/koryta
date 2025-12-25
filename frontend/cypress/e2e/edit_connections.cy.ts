describe("Edit Node Connections", () => {
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

  it("displays existing connections and allows adding a new one with details", () => {
    // 1. Login
    cy.login();

    // 2. Go to edit page for Jan Kowalski (node 1)
    cy.visit("/edit/node/1");
    cy.contains("Treść i Powiązania").should("be.visible");

    // 3. Verify existing connections are listed
    cy.contains("Powiązania").should("be.visible");
    cy.contains("Anna Nowak").should("be.visible");

    // 4. Add a new connection to Piotr Wiśniewski (node 4)
    // Select relationship type (Polish label)
    cy.contains("label", "Rodzaj relacji").parent().click();
    cy.contains("Powiązanie z").click();

    // Verify "Typ celu" is gone (it shouldn't be visible)
    cy.contains("label", "Typ celu").should("not.exist");

    // Use EntityPicker to find Piotr Wiśniewski
    cy.contains("label", "Wyszukaj osobę")
      .parent()
      .find("input")
      .click()
      .type("Piotr", { delay: 100 });
    cy.get(".v-list-item-title", { timeout: 15000 })
      .contains("Piotr Wiśniewski")
      .should("be.visible")
      .click();

    // Fill in name and text
    cy.contains("label", "Nazwa relacji")
      .parent()
      .find("input")
      .type("Testowa nazwa");
    cy.contains("label", "Opis relacji")
      .parent()
      .find("input")
      .type("Testowy opis");

    // Click Add
    cy.contains("button", "Dodaj powiązanie").click();

    // 5. Verify the new connection appears in the list
    cy.contains("Piotr Wiśniewski").should("be.visible");
    cy.contains("Powiązanie z").should("be.visible");
    // Note: The UI currently displays edge.label || edge.type.
    // If edge.label is added, it should show up.
  });
});
