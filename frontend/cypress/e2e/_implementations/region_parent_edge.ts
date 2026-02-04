describe("Region Parent Edge", () => {
  const COMPANY_ID = "company-123";
  const EXISTING_REGION_ID = "region-1";
  const NEW_REGION_NAME = "New Region Test";

  beforeEach(() => {
    cy.login();

    // Mock company page
    cy.intercept("GET", `/api/nodes/entry/${COMPANY_ID}`, {
      body: {
        node: {
          id: COMPANY_ID,
          name: "Test Company",
          type: "place",
        },
      },
    }).as("getCompany");

    // Mock search for "region" type nodes (which might map to generic node search or specific type)
    // The component uses `/api/nodes/${props.entity}`
    // If props.entity is "region", it calls `/api/nodes/region`
    cy.intercept("GET", "/api/nodes/region*", (req) => {
      req.reply({
        body: {
          entities: {
            [EXISTING_REGION_ID]: {
              id: EXISTING_REGION_ID,
              name: "Existing Region",
              type: "region",
            },
          },
        },
      });
    }).as("getRegions");

    // Mock edges
    cy.intercept("GET", "/api/edges*", { body: [] }).as("getEdges");

    // Mock revisions check
    cy.intercept("GET", "/api/revisions*", { body: [] }).as("getRevisions");

    // Mock create node
    cy.intercept("POST", "/api/nodes/create", (req) => {
      expect(req.body).to.include({
        type: "region",
        name: NEW_REGION_NAME,
      });
      req.reply({
        body: { id: "new-region-99" },
      });
    }).as("createRegion");

    // Mock create edge
    cy.intercept("POST", "/api/edges/create", (req) => {
      expect(req.body).to.include({
        source: "new-region-99",
        target: COMPANY_ID,
        type: "owns",
      });
      req.reply({ body: undefined });
    }).as("createEdge");
  });

  it("should open region parent form and indicate searching for object/region", () => {
    cy.visit(`/entity/place/${COMPANY_ID}`);
    cy.wait("@getCompany");

    // Click the button
    cy.contains("button", "Dodaj region zarządzający firmą").click();

    // Verification of correct mode by checking the label
    // The current fix sets label to "Wyszukaj obiekt" because it falls into 'else' of (person? place?)
    cy.contains("label", "Wyszukaj region").should("exist");

    // Check that we are in the form
    cy.get("input").should("exist");
  });

  it("should allow creating a new region and adding it as parent", () => {
    cy.visit(`/entity/place/${COMPANY_ID}`);
    cy.contains("button", "Dodaj region zarządzający firmą").click();

    // Type new region name
    // Use accessible label look up or just general input interaction since specific testid might be buried
    cy.contains("label", "Wyszukaj region")
      .parent()
      .find("input")
      .type(NEW_REGION_NAME);

    // Wait for debounce/search
    cy.wait("@getRegions");

    // Click "Add... to database"
    cy.contains("div", `Dodaj "${NEW_REGION_NAME}" do bazy.`).click();

    // Wait for creation
    cy.wait("@createRegion");

    // Verifying chip creation - use broader selector
    cy.contains(NEW_REGION_NAME).should("exist");

    cy.contains("button", "Dodaj powiązanie").click();

    cy.wait("@createEdge");

    // Should show success message or clear form
    cy.on("window:alert", (str) => {
      expect(str).to.equal("Dodano powiązanie");
    });
  });
});
