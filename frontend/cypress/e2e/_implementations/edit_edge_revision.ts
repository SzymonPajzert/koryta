describe("Edit Edge Revision", () => {
  beforeEach(() => {
    cy.refreshAuth();
  });

  it("allows modifying an existing edge and saves a revision", () => {
    cy.login();

    cy.visit("/edit/node/1");
    cy.contains("Treść i Powiązania").should("be.visible");

    cy.contains("Powiązania").should("be.visible");
    cy.contains(".v-list-item", "Anna Nowak")
      .find("button.v-btn--icon")
      .click();

    cy.contains("h4", "Edytuj powiązanie").should("be.visible");

    cy.fillField("Nazwa relacji", "Updated Relation Name");
    cy.fillField("Opis relacji", "Updated Relation Description");

    cy.contains("button", "Zapisz zmiany").click();

    cy.on("window:alert", (str) => {
      expect(str).to.equal("Zapisano propozycję zmiany!");
    });

    cy.contains("h4", "Dodaj nowe powiązanie").should("be.visible");
  });
});
