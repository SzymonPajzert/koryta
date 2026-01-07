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
    cy.get('[data-testid="entity-picker-input"]').first().click();
    cy.get('[data-testid="entity-picker-input"]').first().type(hiddenNodeName);

    // Check if the item appears in the dropdown list
    cy.contains(".v-list-item-title", hiddenNodeName).should("exist");
  });

  it("should open new tab with correct params when adding new entity", () => {
    const sourceNodeName = generateName("SourceForNew");
    cy.visit("/edit/node/new?type=person");
    cy.contains("label", "Nazwa").parent().find("input").type(sourceNodeName);
    cy.contains("button", "Zapisz zmianę").click();
    cy.url({ timeout: 10000 }).should("include", "/edit/node/");

    const newTargetName = generateName("NewTarget");

    // Setup stub for window.open
    cy.window().then((win) => {
      cy.stub(win, "open").as("windowOpen");
    });

    // Type non-existent name
    cy.get('[data-testid="entity-picker-input"]').first().click();
    cy.get('[data-testid="entity-picker-input"]').first().type(newTargetName);

    // Wait for "Add ..." option
    cy.contains(`Dodaj "${newTargetName}"`).should("be.visible").click();

    // Assert window.open was called
    cy.get("@windowOpen").should("be.calledWithMatch", (url: string) => {
      // The exact URL might depend on base URL, but window.open usually gets relative or absolute.
      // We check for presence of query params
      return (
        url.includes(`/edit/node/new`) &&
        url.includes(`type=person`) &&
        url.includes(`name=${newTargetName}`)
      );
    });
  });
});
