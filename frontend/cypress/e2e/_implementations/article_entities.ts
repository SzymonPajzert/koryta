describe("Article Entities and Edge References", () => {
  beforeEach(() => {
    cy.login("admin@koryta.pl", "password123");
  });

  it("should display article entity page", () => {
    // Navigate to an article page (seeded data: 6)
    cy.visit("/entity/article/6");
    cy.get("h2").should("contain", "Sample Article");
    cy.get(".text-caption").should("contain", "URL:");
  });

  it("should allow adding an edge from an article page", () => {
    cy.visit("/entity/article/6");
    // Inline quick add
    cy.contains("Szybkie dodawanie").should("be.visible");
    cy.contains("Wspomniane miejsce w artykule").click();

    cy.pickEntity("Orlen", "entity-picker-target");

    cy.contains("button", "Dodaj powiązanie").click();
    cy.on("window:alert", (str) => {
      expect(str).to.equal("Dodano powiązanie!");
    });
  });

  it("should allow adding an edge with article reference from person page", () => {
    cy.visit("/entity/person/1");
    cy.contains("Zaproponuj zmianę").click();
    cy.contains("Dodaj gdzie").contains("pracuje").click();

    cy.pickEntity("Orlen", "entity-picker-target");
    cy.pickEntity("Sample Article", "entity-picker-reference");

    cy.intercept("POST", "/api/nodes/create").as("createNode");
    cy.intercept("POST", "/api/edges/create").as("createEdge");

    const alertStub = cy.stub();
    cy.on("window:alert", alertStub);

    cy.contains("button", "Dodaj powiązanie").click();

    cy.wait("@createEdge").then((interception) => {
      expect(interception.response?.statusCode).to.equal(200);
      cy.log(
        "Edge creation response:",
        JSON.stringify(interception.response?.body),
      );
    });

    cy.wrap(alertStub).should("have.been.calledWith", "Dodano powiązanie!");
  });
});
