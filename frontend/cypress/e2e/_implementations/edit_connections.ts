describe("Edit Node Connections", () => {
  beforeEach(() => {
    cy.refreshAuth();
  });

  it("allows adding and removing a connection", () => {
    cy.login();

    const personName = `Person ${Date.now()}`;
    cy.createNode({ name: personName, type: "person" });

    let personId: string;
    cy.url().then((url) => {
      personId = url.split("/").pop() as string;
    });

    cy.contains("Powiązania").should("be.visible");
    cy.get(".v-btn").contains("zna").click();

    const targetName = `Friend ${Date.now()}`;
    cy.createNode({ name: targetName, type: "person" });

    // Switch back to original person
    cy.then(() => {
      cy.visit(`/entity/person/${personId}`);
    });
    cy.contains("Zaproponuj zmianę").click();

    cy.get(".v-btn").contains("zna").click();
    cy.pickEntity(targetName);
    let alertFired1 = false;
    cy.on("window:alert", (str) => {
      if (str.includes("Powiązanie dodane!")) alertFired1 = true;
    });

    cy.contains("button", "Dodaj powiązanie").click();

    cy.wrap(null).should(() => {
      expect(alertFired1).to.be.true;
    });
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

    let alertFired2 = false;
    cy.on("window:alert", (str) => {
      if (str.includes("Powiązanie dodane!")) alertFired2 = true;
    });

    cy.contains("button", "Dodaj powiązanie").click();

    cy.wrap(null).should(() => {
      expect(alertFired2).to.be.true;
    });
  });

  // TODO reenable - I don't think this test has good assumptions now
  it.skip("should edit an existing entity and add a new connection with direction (Firm/Subsidiary)", () => {
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
        expect(str).to.equal("Zapisano!");
      });

      // Ensure the edge appears in the list
      cy.contains(subsidiaryName).should("exist");
    });
  });
});
