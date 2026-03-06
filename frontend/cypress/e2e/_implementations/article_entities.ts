describe("Article Entities and Edge References", () => {
  beforeEach(() => {
    cy.login("admin@koryta.pl", "password123");
  });

  it("should display article entity page", () => {
    cy.visit("/entity/article/1");
    cy.contains("Sample Article", { timeout: 10000 }).should("be.visible");
    cy.contains("Treść artykułu").should("be.visible");
  });

  it("should allow adding an edge from an article page", () => {
    cy.visit("/entity/article/1");
    cy.contains("Zaproponuj zmianę").should("be.visible").click();
    cy.contains("Szybkie dodawanie", { timeout: 15000 }).should("be.visible");

    cy.get('[data-testid="edge-picker-owns"]', { timeout: 15000 })
      .should("be.visible")
      .scrollIntoView()
      .click({ force: true });

    cy.pickEntity("Orlen", "entity-picker-target");

    cy.contains("Dodaj powiązanie").should("be.visible").click();

    cy.window().then((win) => {
      win.addEventListener("alert", (text) => {
        expect(text).to.contains("Dodano powiązanie");
      });
    });

    cy.wait(2000);
  });

  it("should allow adding an edge with article reference from person page", () => {
    cy.login("admin@koryta.pl", "password123");
    cy.visit("/entity/person/1");
    cy.url().should("include", "/entity/person/1");
    cy.contains("Jan Kowalski").should("be.visible");
    cy.contains("WYLOGUJ").should("be.visible");

    cy.contains("Zaproponuj zmianę").should("be.visible").click();

    cy.contains("Szybkie dodawanie", { timeout: 15000 }).should("be.visible");

    cy.get('[data-testid="edge-picker-employed"]', { timeout: 15000 })
      .should("be.visible")
      .scrollIntoView()
      .click({ force: true });

    cy.pickEntity("Orlen", "entity-picker-target");

    cy.get('[data-testid="entity-picker-reference"]', { timeout: 15000 })
      .should("be.visible")
      .scrollIntoView();

    cy.pickEntity("Sample Article", "entity-picker-reference");

    cy.contains("Dodaj powiązanie").should("be.visible").click();

    cy.window().then((win) => {
      win.addEventListener("alert", (text) => {
        expect(text).to.contains("Dodano powiązanie");
      });
    });
  });
});
