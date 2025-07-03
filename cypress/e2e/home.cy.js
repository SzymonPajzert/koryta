/// <reference types="cypress" />

describe("home", () => {
  beforeEach(() => {
    cy.visit("/");
  });

  it("displays three clickable cards", () => {
    cy.get(".v-card").should("have.length", 2);
    cy.get("img")
      .should("be.visible")
      .and("have.prop", "naturalWidth")
      .should("be.greaterThan", 0);
    cy.wait(1500)
      .get(".vue-apexcharts")
      .matchImageSnapshot("loaded-graph", { padding: 50 });

    cy.get(".v-card").first().contains("Zobacz listę");
    cy.get(".v-card").eq(1).contains("Dodaj osoby");
    // See https://github.com/jaredpalmer/cypress-image-snapshot?tab=readme-ov-file#usage
    // E.g. --env updateSnapshots=true
    cy.wait(1500).get("body").matchImageSnapshot();
  });
});
