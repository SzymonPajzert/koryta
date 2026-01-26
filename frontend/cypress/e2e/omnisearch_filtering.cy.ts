describe("OmniSearch and Graph Filtering", () => {
  beforeEach(() => {
    cy.visit("/");
  });

  it("should filter out regions and companies without people in OmniSearch", () => {
    cy.intercept("GET", "/api/graph*").as("getGraph");

    cy.search("Puste");
    cy.wait("@getGraph");

    cy.contains("Województwo Puste").should("not.exist");
    cy.contains("Firma Pusta").should("not.exist");
  });

  it("should show valid chain of connected entities in OmniSearch", () => {
  it("should show valid chain of connected entities in OmniSearch", () => {
    cy.search("Testowa");
    
    cy.get(".v-overlay").filter(":visible").should("be.visible").within(() => {
      cy.contains(".v-list-item-title", "Osoba Testowa").should("exist");
      cy.contains(".v-list-item-title", "Firma Testowa").should("exist");
    });

    cy.search("Testowe");
    // wait for list update - graph isn't re-fetched if cached but filtering happens
    cy.wait(500); 

    cy.get(".v-overlay").filter(":visible").should("be.visible").within(() => {
        cy.contains(".v-list-item-title", "Województwo Testowe").should("exist");
    });

    cy.search("Powiat Testowy");
    cy.wait(500);

    cy.get(".v-overlay").filter(":visible").should("be.visible").within(() => {
        cy.contains(".v-list-item-title", "Powiat Testowy").should("exist");
    });
  });
  });

  it("should filter out empty regions and companies in the Graph view", () => {
    cy.visit("/graf");

    // Ensure graph loads
    cy.get("svg").should("exist");

    // The graph renders nodes as text elements or similar.
    // We check if the text for empty entities is absent.
    cy.contains("Województwo Puste").should("not.exist");
    cy.contains("Firma Pusta").should("not.exist");
  });

  it("should show valid chain of connected entities in the Graph view", () => {
    cy.visit("/graf");

    // Ensure graph loads
    cy.get("svg").should("exist");

    // Verify positive cases are present in the graph
    cy.contains("Osoba Testowa").should("exist");
    cy.contains("Firma Testowa").should("exist");
    cy.contains("Województwo Testowe").should("exist");
    cy.contains("Powiat Testowy").should("exist");
  });
});
