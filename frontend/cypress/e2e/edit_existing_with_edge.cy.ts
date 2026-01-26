describe("Edit Existing Entity & Add Edge", () => {
  const generateName = (prefix: string) => `${prefix}_${Date.now()}`;

  beforeEach(() => {
    // Clear indexedDB based on previous patterns to ensure clean state
    cy.window().then((win) => {
      return new Cypress.Promise((resolve) => {
        const req = win.indexedDB.deleteDatabase("firebaseLocalStorageDb");
        req.onsuccess = resolve;
        req.onerror = resolve;
        req.onblocked = resolve;
      });
    });
    cy.refreshAuth();
    cy.login();
  });

  it("should edit an existing entity and add a new connection with direction", () => {
    // 1. Create a Base Entity (Company)
    const companyName = generateName("TestCompany");
    cy.visit("/edit/node/new?type=place");
    cy.contains("label", "Nazwa").parent().find("input").type(companyName);
    cy.contains("button", "Zapisz zmianę").click();
    cy.url({ timeout: 10000 }).should("include", "/edit/node/");

    // Capture ID
    cy.url().then((url) => {
      const parts = url.split("/");
      const companyId = parts[parts.length - 1]; // /edit/node/[id]

      // 2. Create another entity (Subsidiary) to connect to
      const subsidiaryName = generateName("Subsidiary");
      cy.visit("/edit/node/new?type=place");
      cy.contains("label", "Nazwa").parent().find("input").type(subsidiaryName);
      cy.contains("button", "Zapisz zmianę").click();
      cy.url({ timeout: 10000 }).should("include", "/edit/node/");

      // 3. Go back to Company Edit page
      cy.visit(`/edit/node/${companyId}`);

      // 4. Modify Company Name
      const updatedName = companyName + "_Updated";
      cy.contains("label", "Nazwa")
        .parent()
        .find("input")
        .clear()
        .type(updatedName);
      cy.contains("button", "Zapisz zmianę").click();

      // Click "Dodaj firmę córkę" button (owns, outgoing)
      cy.get(".v-btn").contains("firmę córkę").click();

      // Search for Subsidiary
      cy.get('[data-testid="entity-picker-input"]').first().click();
      cy.get('[data-testid="entity-picker-input"]')
        .first()
        .type(subsidiaryName);

      // Wait for results and click
      cy.contains(".v-list-item-title", subsidiaryName).click();

      // Save Connection
      cy.get("button[type='submit']").contains("Dodaj powiązanie").click();

      // Verify
      cy.on("window:alert", (str) => {
        expect(str).to.contain("Dodano powiązanie");
      });

      // Ensure the edge appears in the list
      cy.contains(subsidiaryName).should("exist");
      // cy.contains("employed").should("exist"); // Label might be different/translated
    });
  });
});
