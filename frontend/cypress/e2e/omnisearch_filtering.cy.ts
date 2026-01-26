describe("OmniSearch and Graph Filtering", () => {
  beforeEach(() => {
    cy.login(); // Or setup necessary state
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
    cy.intercept("GET", "/api/graph*").as("getGraph");

    cy.search("Testowa");
    cy.wait("@getGraph");

    cy.contains("Osoba Testowa").should("be.visible");
    cy.contains("Firma Testowa").should("be.visible");

    cy.search("Testowe");
    cy.contains("Województwo Testowe").should("be.visible");

    cy.search("Powiat Testowy");
    cy.contains("Powiat Testowy").should("be.visible");
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
