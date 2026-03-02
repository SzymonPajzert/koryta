describe("Inline Edge Edition", () => {
  beforeEach(() => {
    cy.refreshAuth();
  });

  it("opens edge edition dialog on entity page", () => {
    cy.login();
    const name = "Test Person " + Date.now();

    // Create node via API (custom command usually)
    cy.createNode({ name, type: "person" });

    // Navigate directly to the entity page
    cy.url().then((url) => {
      const id = url.split("/").pop();
      cy.visit(`/entity/person/${id}`);
    });

    // Now on entity page
    cy.url().should("include", "/entity/person/");

    // Quick Add button should be visible
    cy.contains("Szybkie dodawanie").should("be.visible");

    // Click a button, e.g. "Dodaj gdzie ... pracuje"
    // The button text depends on useEdgeTypes. "Dodaj gdzie [name] pracuje"
    cy.get('button:contains("pracuje")').click();

    // Dialog should open
    cy.contains("Dodaj nowe powiązanie").should("be.visible");

    // Close it
    cy.get("button[title='Anuluj']").click();
    cy.contains("Dodaj nowe powiązanie").should("not.exist");
  });
});
