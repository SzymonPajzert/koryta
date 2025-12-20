describe("graph", () => {
  Cypress.on("uncaught:exception", (err, runnable) => {
    // returning false here prevents Cypress from
    // failing the test
    return false;
  });

  beforeEach(() => {
    cy.visit("/graf");
  });

  // TODO
  // it("displays a lot of nodes", () => {
  //   cy.get("g > text").should("have.length.greaterThan", 100);
  //   cy.get("g > text").contains("Rząd").should("exist");
  // });

  context("shows dialog for each node", () => {
    beforeEach(() => {
      // Clear filters or set default
      cy.visit("/graf");
    });

    it("normally doesn't see a dialog", () => {
      cy.get(".v-overlay__content").should("not.exist");
    });

    // TODO
    // it("shows dialog on person", () => {
    //   cy.get("g > text")
    //     .contains("Jan Kowalski")
    //     .should("exist")
    //     .click();
    //   cy.get(".v-overlay__content").should("exist");
    // });
    // it("shows dialog on place", () => {
    //   cy.get("g > text").contains("Orlen").click();
    //   cy.get(".v-overlay__content").should("exist");
    // });
  });
});
