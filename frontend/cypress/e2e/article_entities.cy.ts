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
    cy.contains("Zaproponuj zmianę").click();
    cy.contains("Wspomniane miejsce w artykule").click();
    cy.pickEntity("Orlen", "entity-picker-source");
    cy.pickEntity("Orlen", "entity-picker-target");

    cy.contains("button", "Dodaj powiązanie").click();
    cy.on("window:alert", (str) => {
      expect(str).to.equal("Dodano powiązanie");
    });
  });

  it("should allow adding an edge with article reference from person page", () => {
    cy.visit("/entity/person/1");
    cy.contains("Zaproponuj zmianę").click();

    cy.selectVuetifyOption("Relacja", "Zatrudniony/a w");
    cy.pickEntity("Orlen", "entity-picker-target");
    cy.pickEntity("Sample Article", "entity-picker-reference");

    cy.contains("button", "Dodaj powiązanie").click();
    cy.on("window:alert", (str) => {
      expect(str).to.equal("Dodano powiązanie");
    });
  });
});
