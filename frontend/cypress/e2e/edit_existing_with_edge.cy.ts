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
    cy.createNode({ name: companyName, type: "place" });

    // Capture ID from URL to return later if needed, though we can just navigate via URL parts
    cy.url().then((url) => {
      const parts = url.split("/");
      const companyId = parts[parts.length - 1];

      // 2. Create another entity (Subsidiary) to connect to
      const subsidiaryName = generateName("Subsidiary");
      cy.createNode({ name: subsidiaryName, type: "place" });

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

      // Search for Subsidiary using abstracted command
      cy.pickEntity(subsidiaryName);

      // Save Connection
      cy.get("button[type='submit']").contains("Dodaj powiązanie").click();

      // Verify
      cy.on("window:alert", (str) => {
        expect(str).to.contain("Dodano powiązanie");
      });

      // Ensure the edge appears in the list
      cy.contains(subsidiaryName).should("exist");
    });
  });
});
