describe("graph", () => {
  Cypress.on("uncaught:exception", (err, runnable) => {
    // returning false here prevents Cypress from
    // failing the test
    return false;
  });

  it("displays a lot of nodes", () => {
    cy.visit("/zobacz/graf");
    cy.get("g > text").should("have.length.greaterThan", 100);
    cy.get("g > text").contains("Rząd").should("exist");
  });

  describe("NFOŚiGW", () => {
    it("shows subgraph on button", () => {
      cy.visit("/zobacz/graf/");
      cy.get("i.mdi-menu-down").click();
      cy.get("div.v-list-item").contains("NFOŚiGW").click();

      cy.get("g > text").contains("NFOŚiGW").should("exist");
      cy.get("g > text").contains("Ewa Patalas").should("exist");
      cy.get("g > text").contains("Waldemar Miśko").should("exist");
      cy.get("g > text").contains("Jerzy Kaczmarek").should("exist");
      cy.get("g > text").contains("WFOŚiGW Kraków").should("exist");
      cy.get("g > text").contains("Marcin Zamaro").should("exist");
    });

    it("shows subgraph by URL", () => {
      cy.visit("/zobacz/graf/-OTP5Zwp5n3Z1I6Fu5B6");

      cy.get("g > text").contains("Waldemar Miśko").should("exist");
      cy.get("g > text").contains("Jerzy Kaczmarek").should("exist");
      cy.get("g > text").contains("WFOŚiGW Kraków").should("exist");
    });
  });

  describe("Miasto Kraków", () => {
    it("shows subgraph on button", () => {
      cy.visit("/zobacz/graf/");
      cy.get("i.mdi-menu-down").click();
      cy.get("div.v-list-item").contains("Miasto Kraków").click();

      cy.get("g > text").contains("Aleksander Miszalski").should("exist");
      cy.get("g > text").contains("NFOŚiGW wesprze budowę kanalizacji w Krakowie ").should("exist");
      cy.get("g > text").contains("Emilia Wasilewska").should("not.exist");
    });
  });

  // TODO AMW nie ma PKP
  // TODO Województwo Mazowieckie - nie ma PKP

});
