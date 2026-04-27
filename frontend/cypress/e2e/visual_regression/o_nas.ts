/// <reference types="cypress" />

describe("O Nas", () => {
  beforeEach(() => {
    cy.visit("/o-nas");
  });
  it("displays page", () => {
    cy.wait(500); // Wait for potential animations
    cy.percySnapshot("o-nas");
  });
});
