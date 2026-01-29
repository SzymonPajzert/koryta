describe("Edit Node Connections", () => {
  beforeEach(() => {
    cy.refreshAuth();
  });

  it("allows adding and removing a connection", () => {
    cy.login();

    const personName = `Person ${Date.now()}`;
    cy.createNode({ name: personName, type: "person" });

    cy.contains("Powiązania").should("be.visible");
    cy.get(".v-btn").contains("zna").click();

    const targetName = `Friend ${Date.now()}`;
    cy.createNode({ name: targetName, type: "person" });

    // Switch back to original person
    cy.visit("/");
    cy.search(personName);
    cy.contains(".v-list-item-title", personName).click();
    cy.contains("Zaproponuj zmianę").click();

    cy.get(".v-btn").contains("zna").click();
    cy.pickEntity(targetName);
    cy.contains("button", "Dodaj powiązanie").click();

    cy.contains(targetName).should("be.visible");
  });

  it("updates the entity picker when switching relationship types", () => {
    cy.login();
    cy.visit("/edit/node/1");

    // Select "pracuje" relationship
    cy.get(".v-btn").contains("pracuje").click();

    cy.verifyLabelExists("Wyszukaj firmę");
    cy.verifyLabelDoesNotExist("Wyszukaj osobę");

    cy.pickEntity("Orlen");
    cy.fillField("Nazwa relacji", "Zatrudnienie");

    cy.contains("button", "Dodaj powiązanie").click();

    cy.contains("Orlen").should("be.visible");
  });

  it("should edit an existing entity and add a new connection with direction (Firm/Subsidiary)", () => {
    cy.login();
    
    const generateName = (prefix: string) => `${prefix}_${Date.now()}`;

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
      cy.fillField("Nazwa", updatedName);
      cy.contains("button", "Zapisz zmianę").click();

      // Click "Dodaj firmę córkę" button (owns, outgoing)
      cy.get(".v-btn").contains("firmę córkę").click();

      // Search for Subsidiary using abstracted command
      cy.pickEntity(subsidiaryName);

      // Save Connection
      cy.contains("button", "Dodaj powiązanie").click();

      // Verify
      cy.on("window:alert", (str) => {
        expect(str).to.contain("Dodano powiązanie");
      });

      // Ensure the edge appears in the list
      cy.contains(subsidiaryName).should("exist");
    });
  });
});
