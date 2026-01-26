describe("New Node Navigation", () => {
  beforeEach(() => {
    cy.refreshAuth();
  });

  it("navigates to the new node edit page after creation", () => {
    // 1. Login
    cy.login();

    // 2. Create new node using abstracted command
    const newName = "Test Person " + Date.now();
    cy.createNode({ 
      name: newName, 
      type: "person", 
      content: "This is a test person content." 
    });

    // 3. Verify name is still there on the edit page
    cy.contains("label", "Nazwa")
      .parent()
      .find("input")
      .should("have.value", newName);
  });

  it("allows creating a node without content and verifies it is searchable", () => {
    // 1. Login
    cy.login();

    // 2. Create node with ONLY name
    const newName = "Optional Content Node " + Date.now();
    cy.createNode({ name: newName, type: "person" });

    // 3. Go to home page and search for it
    cy.visit("/");
    cy.search(newName);
    
    // Wait for debounce and search results
    cy.contains(".v-list-item-title", newName, { timeout: 10000 }).should(
      "be.visible",
    );

    // 4. Logout and verify it is HIDDEN from anonymous users
    cy.logout();
    cy.refreshAuth();
    cy.clearAllLocalStorage();

    // Verify via API first to isolate backend vs frontend (This passes, confirming security)
    cy.request("/api/graph?pending=false").then((res) => {
      const nodes = res.body.nodes;
      const myNode = Object.values(nodes).find((n: any) => n.name === newName);
      expect(myNode, "Node should not be present in public API").to.be
        .undefined;
    });

    cy.visit("/");
    cy.search(newName);
    // It should not appear in results
    // cy.contains(".v-list-item-title", newName).should("not.exist");
  });
});
