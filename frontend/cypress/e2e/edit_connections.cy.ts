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
});
