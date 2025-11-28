describe("graph", () => {
  Cypress.on("uncaught:exception", (err, runnable) => {
    // returning false here prevents Cypress from
    // failing the test
    return false;
  });

  beforeEach(() => {
    cy.visit("/graf");
  });

  it("displays a lot of nodes", () => {
    cy.get("g > text").should("have.length.greaterThan", 100);
    cy.get("g > text").contains("Rząd").should("exist");
  });

  context("shows dialog for each node", () => {
    beforeEach(() => {
      cy.filterPlace("Miasto Krak"); // TODO support polish letters
    });

    it("normally doesn't see a dialog", () => {
      cy.get(".v-overlay__content").should("not.exist");
    });

    it("shows dialog on person", () => {
      cy.get("g > text")
        .contains("Aleksander Miszalski")
        .should("exist")
        .click();
      cy.get(".v-overlay__content").should("exist");
    });

    it("shows dialog on company", () => {
      cy.get("g > text").contains("NFOŚiGW").click();
      cy.get(".v-overlay__content").should("exist");
    });

    it("shows dialog on article", () => {
      cy.get("g > text")
        .contains("NFOŚiGW wesprze budowę kanalizacji w Krakowie ")
        .click();
      cy.get(".v-overlay__content").should("exist");
    });
  });

  context("NFOŚiGW", () => {
    it("shows subgraph on button", () => {
      cy.filterPlace("NFOŚiGW");

      cy.get("g > text").contains("NFOŚiGW").should("exist");
      cy.get("g > text").contains("Ewa Patalas").should("exist");
      cy.get("g > text").contains("Waldemar Miśko").should("exist");
      cy.get("g > text").contains("Jerzy Kaczmarek").should("exist");
      cy.get("g > text").contains("WFOŚiGW Kraków").should("exist");
      cy.get("g > text").contains("Marcin Zamaro").should("exist");
    });

    it("shows subgraph by URL", () => {
      cy.visit("/graf?miejsce=-OTP5Zwp5n3Z1I6Fu5B6");

      cy.get("g > text").contains("Waldemar Miśko").should("exist");
      cy.get("g > text").contains("Jerzy Kaczmarek").should("exist");
      cy.get("g > text").contains("WFOŚiGW Kraków").should("exist");
    });
  });

  context("Miasto Kraków", () => {
    it("shows subgraph on button", () => {
      cy.filterPlace("Miasto Kraków");

      cy.get("g > text").contains("Aleksander Miszalski").should("exist");
      cy.get("g > text")
        .contains("NFOŚiGW wesprze budowę kanalizacji w Krakowie ")
        .should("exist");
      cy.get("g > text").contains("Emilia Wasilewska").should("not.exist");
    });
  });

  describe("Miasto Warszawa", () => {
    beforeEach(() => {
      cy.filterPlace("Miasto Warszawa");
    });

    it("pokazuje tylko interesującą część Polimex-Mostostal", () => {
      cy.get("g > text").contains("Wojciech Bartelski").should("exist");
      cy.get("g > text").contains("Polimex-Mostostal").should("exist");
      cy.get("g > text")
        .contains("Władze Polimex-Mostostal")
        .should("not.exist");
    });
  });

  context("Wodny Park Warszawianka", () => {
    it("shows subgraph on button", () => {
      cy.filterPlace("Wodny Park Warszawianka");

      cy.get("g > text").contains("Dariusz Pastor").should("exist");
      cy.get("g > text").contains("Ursus (Warszawa)").should("exist");
    });
  });

  // TODO AMW nie ma PKP
  // TODO Województwo Mazowieckie - nie ma PKP
});
