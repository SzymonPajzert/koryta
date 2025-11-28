/// <reference types="cypress" />

describe("home", () => {
  beforeEach(() => {
    cy.visit("/");
  });

  it("displays four clickable cards", () => {
    cy.get(".v-card").should("have.length", 8);

    // See https://github.com/jaredpalmer/cypress-image-snapshot?tab=readme-ov-file#usage
    // E.g. --env updateSnapshots=true
    cy.wait(1500).get("body").matchImageSnapshot();
    cy.percySnapshot("home-page");
  });

  it("displays image with a pig", () => {
    cy.get("img")
      .should("be.visible")
      .and("have.prop", "naturalWidth")
      .should("be.greaterThan", 0);
  });

  it("displays dashboard", () => {
    cy.wait(2000)
      .get(".vue-apexcharts")
      .matchImageSnapshot("loaded-graph", { padding: 50 });
    cy.percySnapshot("home-dashboard");
  });

  it("shows list when clicking the first card - chart", () => {
    cy.contains(".v-card", "Lista wszystkich").click();
    cy.url().should("include", "/lista");
  });

  it("shows graph when clicking the second card", () => {
    cy.contains(".v-card", "Zobacz jak PSL").click();
    cy.url().should("include", "/graf");
    cy.get("g > text").should("have.length.greaterThan", 10);
  });

  it("shows graph when clicking the third card", () => {
    cy.contains(".v-card", "Albo PL2050").click();
    cy.url().should("include", "/graf");
    cy.get("g > text").should("have.length.greaterThan", 10);
  });

  it("shows pomoc when clicking the fourth card", () => {
    cy.contains(".v-card", "Dodaj osoby").click();
    cy.url().should("include", "/pomoc");
  });
});
