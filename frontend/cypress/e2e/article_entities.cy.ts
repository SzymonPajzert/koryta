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

    // Click the button for the relation
    cy.contains("Wspomniane miejsce w artykule").click();

    // Use pickEntity (Target is default)
    cy.pickEntity("Orlen", "entity-picker-source");

    // Since we have both, we use the IDs.
    cy.pickEntity("Orlen", "entity-picker-target");

    cy.get("button[type='submit']").contains("Dodaj powiązanie").click();

    cy.on("window:alert", (str) => {
      expect(str).to.equal("Dodano powiązanie");
    });
  });

  it("should allow adding an edge with article reference from person page", () => {
    cy.visit("/entity/person/1");
    cy.contains("Zaproponuj zmianę").click();

    // Select relation
    cy.selectVuetifyOption("Relacja", "Zatrudniony/a w");

    // Picker target
    cy.pickEntity("Orlen", "entity-picker-target");

    // Picker reference
    cy.pickEntity("Sample Article", "entity-picker-reference");

    cy.get("button[type='submit']").contains("Dodaj powiązanie").click();

    cy.on("window:alert", (str) => {
      expect(str).to.equal("Dodano powiązanie");
    });
  });

  it("should show audit page with inconsistencies", () => {
    cy.visit("/admin/audit");
    cy.get("h1").should("contain", "Audyt danych");
    // Depending on seeded data, check for lists
    cy.get(".v-card").should("have.length", 2);
  });
});
