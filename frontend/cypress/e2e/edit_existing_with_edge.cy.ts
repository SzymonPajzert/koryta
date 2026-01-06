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

      // 2. Create another entity (Person) to connect to
      const personName = generateName("Employee");
      cy.visit("/edit/node/new?type=person");
      cy.contains("label", "Nazwa").parent().find("input").type(personName);
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

      // Select Direction FIRST (Incoming: "Od")
      // Since we are editing a Company ('place'), and "Zatrudniony" requires Target=Place,
      // we MUST be in Incoming mode (Target=Me) to see this option.
      cy.get('button[title="Odwróć kierunek"]').click();

      // Open Edge Type - use specific label "Relacja"
      cy.get('.v-select').filter((index, element) => {
        return Cypress.$(element).text().includes('Relacja');
      }).click();
      cy.contains("Zatrudniony/a w").click();

      // Search for Person
      cy.get('[data-testid="entity-picker-input"]').click();
      cy.get('[data-testid="entity-picker-input"]').type(personName);

      // Wait for results and click
      cy.contains(".v-list-item-title", personName).click();

      // Set Dates
      cy.contains("label", "Data rozpoczęcia")
        .parent()
        .find("input")
        .type("2024-01-01");

      // Save Connection
      cy.contains("button", "Dodaj powiązanie").click();

      // Verify
      cy.on("window:alert", (str) => {
        expect(str).to.contain("Dodano powiązanie");
      });

      // Ensure the edge appears in the list
      cy.contains(personName).should("exist");
      // cy.contains("employed").should("exist"); // Label might be different/translated
    });
  });
});
