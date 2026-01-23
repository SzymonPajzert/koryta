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
    // Ensure data loaded (Buttons should contain Jan Kowalski)
    cy.contains("button", "Jan Kowalski").should("exist");

    // 3. Verify existing connections are listed
    cy.contains("Powiązania").should("be.visible");
    cy.contains("Anna Nowak").should("be.visible");

    // 3. Select "Powiązanie z"
    // Click button directly (matching "zna")
    cy.get(".v-btn").contains("zna").click();

    // Verify "Typ celu" is gone (old UI artifact checks)
    cy.contains("label", "Typ celu").should("not.exist");

    // Use EntityPicker to find Piotr Wiśniewski
    cy.contains("label", "Wyszukaj osobę")
      .parent()
      .find("input")
      .click()
      .type("Piotr", { delay: 100 });

    cy.get(".v-overlay")
      .contains(".v-list-item-title", "Piotr Wiśniewski")
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
    cy.get("button[type='submit']")
      .contains("Dodaj powiązanie")
      .should("not.be.disabled")
      .click();

    // 5. Verify the new connection appears in the list
    cy.contains("Piotr Wiśniewski").should("be.visible");
  });

  it("updates the entity picker when switching to 'Zatrudniony/a w' (Company)", () => {
    // 1. Login
    cy.login();

    // 2. Go to edit page for Jan Kowalski (node 1)
    cy.visit("/edit/node/1");
    cy.contains("button", "Jan Kowalski").should("exist");

    // 3. Select "Zatrudniony/a w" relationship type
    // Matches "Dodaj gdzie ... pracuje"
    cy.get(".v-btn").contains("pracuje").click();

    // 4. Verify target type updated
    cy.contains("label", "Wyszukaj firmę").should("exist");
    cy.contains("label", "Wyszukaj osobę").should("not.exist");

    // 5. Use EntityPicker to find Orlen (node 2)
    cy.contains("label", "Wyszukaj firmę")
      .parent()
      .find("input")
      .click()
      .type("Orlen", { delay: 100 });

    cy.get(".v-overlay").contains("Orlen").click();

    // 6. Fill in details
    cy.contains("label", "Nazwa relacji")
      .parent()
      .find("input")
      .type("Zatrudnienie");

    // 7. Click Add
    cy.get("button[type='submit']")
      .contains("Dodaj powiązanie")
      .should("not.be.disabled")
      .click();

    // 8. Verify the new connection appears
    cy.contains("Orlen").should("be.visible");
  });
});
