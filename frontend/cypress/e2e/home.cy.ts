/// <reference types="cypress" />

describe("home", () => {
  beforeEach(() => {
    cy.visit("/");
  });

  it("displays four clickable cards", () => {
    cy.get(".v-card").should("have.length", 8);
    cy.percySnapshot("home-page");
  });

  it("displays dashboard", () => {
    cy.percySnapshot("home-dashboard");
  });

  it("shows list when clicking the first card - chart", () => {
    cy.contains(".v-card", "Lista wszystkich").click();
    cy.url().should("include", "/lista");
  });

  // TODO
  // it("shows graph when clicking the second card", () => {
  //   cy.contains(".v-card", "Zobacz jak PSL").click();
  //   cy.url().should("include", "/graf");
  //   cy.get("g > text").should("have.length.greaterThan", 10);
  // });
  // TODO
  // it("shows graph when clicking the third card", () => {
  //   cy.contains(".v-card", "Albo PL2050").click();
  //   cy.url().should("include", "/graf");
  //   cy.get("g > text").should("have.length.greaterThan", 10);
  // });

  it("shows pomoc when clicking the fourth card", () => {
    cy.contains(".v-card", "Dodaj osoby").click();
    cy.url().should("include", "/pomoc");
  });
});
