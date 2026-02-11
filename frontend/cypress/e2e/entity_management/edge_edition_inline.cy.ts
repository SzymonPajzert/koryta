describe("Inline Edge Edition", () => {
  beforeEach(() => {
    cy.refreshAuth();
  });

  it("opens edge edition dialog on entity page", () => {
    cy.login();
    const name = "Test Person " + Date.now();

    // Create node via API (custom command usually)
    cy.createNode({ name, type: "person" });

    // Check if we are redirected or need to visit
    // createNode implementation typically visits the edit page or stays?
    // Let's assume we need to find it.
    cy.visit("/");
    cy.search(name);
    cy.contains(".v-list-item-title", name).click();

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
