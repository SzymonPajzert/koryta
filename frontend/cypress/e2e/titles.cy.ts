describe("Page Titles", () => {
  it("checks index page title", () => {
    cy.visit("/");
    cy.title().should(
      "eq",
      "koryta.pl - największy, bezpartyjny agregator koryciarstwa",
    );
  });

  it("checks /lista page title", () => {
    cy.visit("/lista");
    // filterName returns empty string, so "Lista"
    cy.title().should("eq", "Lista - koryta.pl");
  });

  it("checks /lista filtered for PO people title", () => {
    cy.visit("/lista?partia=PO");
    // filterName returns "PO"
    cy.title().should("eq", "Lista PO - koryta.pl");
  });

  it("checks /graf page title", () => {
    cy.visit("/graf");
    cy.title().should("eq", "Graf - koryta.pl");
  });

  it("checks /login page title", () => {
    cy.visit("/login");
    cy.title().should("eq", "Logowanie - koryta.pl");
  });

  it("checks /crawler page title", () => {
    cy.visit("/crawler");
    cy.title().should("eq", "Crawler - koryta.pl");
  });

  it("checks /zrodla page title", () => {
    cy.visit("/zrodla");
    cy.title().should("eq", "Źródła strony - koryta.pl");
  });

  it("checks /pomoc/statystyki page title", () => {
    cy.visit("/pomoc/statystyki");
    cy.title().should("eq", "Statystyki - koryta.pl");
  });

  describe("Authenticated Pages", () => {
    beforeEach(() => {
      cy.login();
    });

    it("checks /profil page title", () => {
      cy.visit("/profil");
      cy.title().should("eq", "Profil - koryta.pl");
    });

    it("checks /revisions page title", () => {
      cy.visit("/revisions");
      cy.title().should("eq", "Lista rewizji - koryta.pl");
    });

    it("checks /edit/node/new page title", () => {
      cy.visit("/edit/node/new");
      cy.title().should("eq", "Utwórz - koryta.pl");
    });

    it("checks /edit/node/5 page title", () => {
      cy.visit("/edit/node/5");
      cy.title().should("eq", "Edytuj - koryta.pl");
    });
  });

  describe("Admin Pages", () => {
    beforeEach(() => {
      cy.login("admin@koryta.pl", "password123");
    });

    it("checks /admin/firmy page title", () => {
      cy.visit("/admin/firmy");
      cy.title().should("eq", "Firmy - koryta.pl");
    });
  });

  describe("Dynamic Entity Pages", () => {
    it("checks /entity/person/5 page title", () => {
      cy.visit("/entity/person/5");
      // Node 5 is Krzysztof Wójcik (from seed data)
      cy.title().should("contain", "Krzysztof Wójcik");
      cy.title().should("contain", "- koryta.pl");
    });
  });
});
