describe("Edit Edge Revision", () => {
  beforeEach(() => {
    cy.refreshAuth();
  });

  it.skip("allows modifying an existing edge and saves a revision", () => {
    cy.login();

    // 1. Setup: Create 2 persons and link them
    const personName = "Person " + Date.now();
    const targetName = "Target " + Date.now();

    cy.createNode({ name: personName, type: "person" });
    cy.createNode({ name: targetName, type: "person" });

    // Link them (Person knows Target)
    cy.visit("/");
    cy.search(personName);
    cy.contains(".v-list-item-title", personName).click();
    cy.url().then((url) => {
      const id = url.split("/").pop();
      cy.visit(`/edit/node/${id}`);
    });

    cy.contains("Treść i Powiązania", { timeout: 15000 }).should("be.visible");

    // Add connection
    cy.contains(".v-btn", "zna").click();

    cy.pickEntity(targetName);
    cy.wait(500);

    cy.get("[data-testid=submit-edge-button]").click();

    // Wait for the edge to appear
    cy.contains(".v-list-item", targetName, { timeout: 15000 }).should(
      "be.visible",
    );

    // 2. Now edit this edge
    cy.log("Now editing the edge...");
    cy.contains(".v-list-item", targetName)
      .find(".mdi-pencil")
      .closest("button")
      .click({ force: true });

    cy.contains("h4", "Edytuj powiązanie", { timeout: 10000 }).should(
      "be.visible",
    );

    cy.get("[data-testid=edge-name-field] input")
      .clear()
      .type("Updated Relation Name");
    // Description might not have testid, use label
    cy.fillField("Opis relacji", "Updated Relation Description");

    cy.get("[data-testid=submit-edge-button]").click();

    cy.on("window:alert", (str) => {
      expect(str).to.equal("Zapisano propozycję zmiany!");
    });

    cy.contains("h4", "Dodaj nowe powiązanie").should("be.visible");
    cy.contains("Updated Relation Name").should("be.visible");
  });
});
