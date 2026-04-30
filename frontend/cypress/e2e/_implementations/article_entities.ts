describe("Article Entities and Edge References", () => {
  beforeEach(() => {
    cy.login("admin@koryta.pl", "password123");
  });

  it("should display article entity page", () => {
    cy.visit("/entity/article/6");
    cy.contains("Sample Article", { timeout: 10000 }).should("be.visible");
  });

  it("should allow adding an edge from an article page", () => {
    cy.visit("/entity/article/6");
    cy.contains("Szybkie dodawanie", { timeout: 15000 }).should("be.visible");

    // Add a mentions edge from article to person
    cy.get("[data-testid=edge-picker-mentioned_person]").click();

    cy.pickEntity("Jan Kowalski", "entity-picker-target");

    cy.contains("button", "Dodaj powiązanie").should("be.visible").click();

    cy.on("window:alert", (str) => {
      expect(str).to.include("Dodano");
    });
  });

  it("should allow adding an edge with article reference from person page", () => {
    cy.visit("/entity/person/1");

    // We can add an edge using Szybkie dodawanie directly from the view page!
    cy.contains("Szybkie dodawanie", { timeout: 15000 }).should("be.visible");

    // Click "Dodaj gdzie Jan Kowalski pracuje"
    cy.get('[data-testid="edge-picker-employed"]', { timeout: 15000 })
      .should("be.visible")
      .scrollIntoView()
      .click({ force: true });

    // Pick target: Orlen
    cy.pickEntity("Orlen", "entity-picker-target");

    // Now pick reference: Sample Article
    cy.get('[data-testid="entity-picker-reference"]', { timeout: 15000 })
      .should("be.visible")
      .scrollIntoView();
    cy.pickEntity("Sample Article", "entity-picker-reference");

    cy.contains("button", "Dodaj powiązanie").should("be.visible").click();

    cy.on("window:alert", (str) => {
      expect(str).to.include("Dodano powiązanie!");
    });
  });
});
