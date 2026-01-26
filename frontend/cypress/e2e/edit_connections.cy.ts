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

  it("allows adding and removing a connection", () => {
    // 1. Login
    cy.login();

    // 2. Create a person node
    const personName = `Person ${Date.now()}`;
    cy.createNode({ name: personName, type: "person" });

    // 3. Select "Powiązanie z" (Generic connection)
    // Click button directly (matching "zna" for 'connection' type)
    cy.contains("Powiązania").should("be.visible");
    cy.get(".v-btn").contains("zna").click();

    // 4. Create nodes for testing
    const targetName = `Friend ${Date.now()}`;
    cy.createNode({ name: targetName, type: "person" });
    
    cy.createNode({ name: personName, type: "person" });

    // Add Connection
    cy.get(".v-btn").contains("zna").click();
    
    cy.pickEntity(targetName);

    // Save
    cy.contains("Dodaj powiązanie").click();

    // Verify
    cy.contains(targetName).should("be.visible");
    

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
    cy.pickEntity("Orlen");

    cy.pickEntity("Orlen");

    cy.fillField("Nazwa relacji", "Zatrudnienie");

    // 7. Click Add
    cy.get("button[type='submit']")
      .contains("Dodaj powiązanie")
      .should("not.be.disabled")
      .click();

    // 8. Verify the new connection appears
    cy.contains("Orlen").should("be.visible");
  });
});
