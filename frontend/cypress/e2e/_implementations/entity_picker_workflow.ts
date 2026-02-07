describe("Entity Picker Workflow", () => {
  beforeEach(() => {
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
    cy.createNode({ name: sourceNodeName, type: "person" });

    // 3. In the Source node edit page, use EntityPicker to find HiddenNode
    // Click button to show form
    cy.contains("button", "zna").click();

    // Use pickEntity command which handles the internal logic
    cy.get('[data-testid="entity-picker-target"] input')
      .first()
      .click()
      .type(hiddenNodeName);
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
    cy.get('[data-testid="entity-picker-target"] input')
      .first()
      .click()
      .type(newTargetName);

    // Wait for "Dodaj ..." option and click it
    // Note: EntityPicker uses Polish text "Dodaj ..."
    cy.get(".v-overlay")
      .contains(`Dodaj "${newTargetName}"`)
      .should("be.visible")
      .click();

    // Verify that the new item is selected in the input
    cy.get('[data-testid="entity-picker-target"] input')
      .first()
      .should("have.value", newTargetName);
  });
});
