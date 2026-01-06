describe("Node Type Dropdown", () => {
  beforeEach(() => {
    cy.refreshAuth();
    cy.login();
  });

  it("should display 'Firma' when type is 'place'", () => {
    cy.visit("/edit/node/new?type=place");

    // The v-select should show the title corresponding to the value 'place'
    // If it works correctly, it should show "Firma".
    // If it fails (current state), it shows "place" or is empty.

    // Vuetify v-select renders the selection in .v-select__selection
    cy.get(".v-select__selection-text").first().should("contain", "Firma");
  });
});
