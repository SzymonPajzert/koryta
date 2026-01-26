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
    cy.createNode({ name: hiddenNodeName, type: "person" });

    // 2. Create another node to use EntityPicker
    const sourceNodeName = generateName("SourceNode");
    cy.createNode({ name: sourceNodeName, type: "place" });

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
    cy.createNode({ name: sourceNodeName, type: "person" });

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
    cy.get('[data-testid="entity-picker-input"]')
      .find("input")
      .first()
      .should("have.value", newTargetName);
  });
});
