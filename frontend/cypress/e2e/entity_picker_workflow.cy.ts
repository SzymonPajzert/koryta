describe("Entity Picker Workflow", () => {
  beforeEach(() => {
    // Clear indexedDB to avoid stale auth state
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

  const generateName = (prefix: string) => `${prefix}_${Date.now()}`;

  it("should list unapproved nodes when logged in", () => {
    const hiddenNodeName = generateName("HiddenNode");

    // 1. Create a "hidden" node (unapproved/private)
    cy.visit("/edit/node/new?type=person");
    cy.contains("label", "Nazwa").parent().find("input").type(hiddenNodeName);

    cy.contains("button", "Zapisz zmianę").click();
    // Wait for save and redirect
    cy.url({ timeout: 10000 }).should("include", "/edit/node/");

    // 2. Go to create another node to use EntityPicker
    const sourceNodeName = generateName("SourceNode");
    cy.visit("/edit/node/new?type=place");
    cy.contains("label", "Nazwa").parent().find("input").type(sourceNodeName);

    // Select type 'Company' for 'place' - this might be auto-selected by query param but let's be sure
    // Assuming query param ?type=place sets it to Company/place.

    cy.contains("button", "Zapisz zmianę").click();
    cy.url({ timeout: 10000 }).should("include", "/edit/node/");

    // 3. In the Source node edit page, use EntityPicker to find HiddenNode
    // Click button to show form
    cy.contains("button", "zna").click();

    cy.get('[data-testid="entity-picker-input"]').first().click();
    cy.get('[data-testid="entity-picker-input"]').first().type(hiddenNodeName);

    // Check if the item appears in the dropdown list
    cy.contains(".v-list-item-title", hiddenNodeName).should("exist");
  });

  it("should create new entity inline and select it", () => {
    const sourceNodeName = generateName("SourceForNew");
    cy.visit("/edit/node/new?type=person");
    cy.contains("label", "Nazwa").parent().find("input").type(sourceNodeName);
    cy.contains("button", "Zapisz zmianę").click();
    cy.url({ timeout: 10000 }).should("include", "/edit/node/");

    const newTargetName = generateName("NewTarget");

    // Click button to show form (since SourceForNew is a person)
    // Matches "Dodaj osobę, którą ... zna"
    cy.contains("button", "zna").click();

    // Type non-existent name
    cy.get('[data-testid="entity-picker-input"]').first().click();
    cy.get('[data-testid="entity-picker-input"]').first().type(newTargetName);

    // Wait for "Add ..." option and click it
    cy.contains(`Dodaj "${newTargetName}"`).should("be.visible").click();

    // Verify that the new item is selected in the input
    // The v-autocomplete typically displays the selection in the input or as a chip
    // Depending on implementation, checking the value might be different.
    // Given return-object and item-title="name", the input text should be the name.
    cy.get('[data-testid="entity-picker-input"]')
      .find("input")
      .first()
      .should("have.value", newTargetName);
  });
});
