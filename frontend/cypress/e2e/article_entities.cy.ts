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
    
    // Fill source
    cy.get('[label="Wyszukaj źródło"]').type("Jan Kowalski");
    cy.contains("Jan Kowalski").click();
    
    // Fill target
    cy.get('[label="Wyszukaj firmę"]').type("Orlen");
    cy.contains("Orlen").click();
    
    // Select relation
    cy.get(".v-select").click();
    cy.contains("Zatrudniony/a w").click();
    
    cy.contains("Dodaj powiązanie").click();
    
    cy.on("window:alert", (str) => {
      expect(str).to.equal("Dodano powiązanie");
    });
  });

  it("should allow adding an edge with article reference from person page", () => {
    cy.visit("/entity/person/1");
    cy.contains("Zaproponuj zmianę").click();
    
    // Picker target
    cy.get('[label="Wyszukaj firmę"]').type("Orlen");
    cy.contains("Orlen").click();
    
    // Picker article reference
    cy.get('[label="Źródło informacji (artykuł)"]').type("Sample Article");
    cy.contains("Sample Article").click();
    
    cy.contains("Dodaj powiązanie").click();
    
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
