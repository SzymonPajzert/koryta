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

    // 3. Select "Powiązanie z"
    cy.contains("label", "Rodzaj relacji").parent().click();
    cy.get(".v-overlay").contains(".v-list-item", "Powiązanie z").click();

    // Verify "Typ celu" is gone (it shouldn't be visible)
    cy.contains("label", "Typ celu").should("not.exist");

    // Use EntityPicker to find Piotr Wiśniewski
    cy.contains("label", "Wyszukaj osobę")
      .parent()
      .find("input")
      .click()
      .type("Piotr", { delay: 100 });

    cy.get(".v-overlay").contains(".v-list-item", "Piotr Wiśniewski").click();

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
    cy.contains("button", "Dodaj powiązanie").should("not.be.disabled").click();

    // 5. Verify the new connection appears in the list
    cy.contains("Piotr Wiśniewski").should("be.visible");
  });

  it("updates the entity picker when switching to 'Zatrudniony/a w' (Company)", () => {
    // 1. Login
    cy.login();

    // 2. Go to edit page for Jan Kowalski (node 1)
    cy.visit("/edit/node/1");
    cy.contains("Treść i Powiązania").should("be.visible");

    // 3. Select "Zatrudniony/a w" relationship type
    cy.contains("label", "Rodzaj relacji").parent().click();
    cy.get(".v-overlay").contains(".v-list-item", "Zatrudniony/a w").click();

    // 4. Verify target type updated
    // And verify label logic just in case
    cy.contains("label", "Wyszukaj firmę").should("exist");
    cy.contains("label", "Wyszukaj osobę").should("not.exist");

    // 5. Use EntityPicker to find Orlen (node 2)
    cy.contains("label", "Wyszukaj firmę")
      .parent()
      .find("input")
      .click()
      .type("Orlen", { delay: 100 });

    cy.get(".v-overlay").contains(".v-list-item", "Orlen").click();

    // 6. Fill in details
    cy.contains("label", "Nazwa relacji")
      .parent()
      .find("input")
      .type("Zatrudnienie");

    // 7. Click Add
    cy.contains("button", "Dodaj powiązanie").should("not.be.disabled").click();

    // 8. Verify the new connection appears
    cy.contains("Orlen").should("be.visible");
  });

  it("updates the entity picker when switching to 'Wspomina firmę/urząd'", () => {
    // 1. Login
    cy.login();

    // 2. Go to edit page
    cy.visit("/edit/node/1");

    // 3. Select "Wspomina firmę/urząd"
    cy.contains("label", "Rodzaj relacji").parent().click();
    cy.get(".v-overlay").contains(".v-list-item", "Wspomina firmę").click();

    // 4. Select "Orlen"
    cy.contains("label", "Wyszukaj firmę")
      .parent()
      .find("input")
      .click()
      .type("Orlen", { delay: 100 });

    cy.get(".v-overlay").contains(".v-list-item", "Orlen").click();

    // 6. Add
    cy.contains("button", "Dodaj powiązanie").should("not.be.disabled").click();

    // 7. Verify
    cy.contains("Orlen").should("be.visible");
  });
});
