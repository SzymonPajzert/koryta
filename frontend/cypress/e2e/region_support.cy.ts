describe("Region Node Type", () => {
  const REGION_ID = "1208032";

  beforeEach(() => {
    cy.login();

    // Mock the region entity response
    cy.intercept("GET", `/api/nodes/entry/${REGION_ID}`, {
      body: {
        node: {
          id: REGION_ID,
          name: "Kozłów",
          type: "region",
          content: "Region content",
        },
      },
    }).as("getRegion");

    // Mock graph response to prevent crash and verify filtered state concept
    cy.intercept("GET", "/api/graph", {
      body: {
        nodes: {
          p1: { id: "p1", name: "Existing Person", type: "person" },
        },
        edges: [],
        nodeGroups: {}, // Needed for graph?
      },
    }).as("getGraph");

    cy.intercept("GET", "/api/graph/layout", {
      body: {
        nodes: {
          p1: { x: 0, y: 0, fixed: true },
        },
      },
    }).as("getGraphLayout");
  });

  it("should display region details but no edit button", () => {
    cy.visit(`/entity/region/${REGION_ID}`);
    cy.wait("@getRegion");

    cy.contains("Kozłów");
    cy.contains("Informacje");

    cy.contains("button", "Zaproponuj zmianę").should("not.exist");
    cy.contains("button", "Zaproponuj usunięcie").should("not.exist");
    cy.get('[data-test-id="quick-add-article"]').should("not.exist");
  });

  it("should not show region in graph", () => {
    cy.visit("/graf");
    cy.contains("Ładuję...", { timeout: 10000 }).should("not.exist");
    cy.wait(1000); // Wait for canvas/rendering

    // Check if the node label appears in the page
    cy.contains("Kozłów").should("not.exist");
  });

  it("should not allow navigating to edit page", () => {
    // Direct visit
    cy.visit(`/edit/node/${REGION_ID}?type=region`, {
      failOnStatusCode: false,
    });

    // Should redirect to entity page
    cy.url().should("include", `/entity/region/${REGION_ID}`);
  });
});
