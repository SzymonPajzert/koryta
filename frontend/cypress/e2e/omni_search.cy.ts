/// <reference types="cypress" />

describe("OmniSearch", () => {
  it("allows searching for parties", () => {
    cy.visit("/");

    // Wait for the main page content to ensure app is hydrated
    cy.get(".v-main").should("be.visible");

    // Use abstracted search command
    cy.search("PO");

    // The menu should appear with suggestions.
    // We expect "PO" as a title and "Partia" as a subtitle.
    cy.get(".v-overlay__content").should("be.visible");

    cy.contains(".v-list-item-title", "PO").should("be.visible");
    cy.contains(".v-list-item-subtitle", "Partia").should("be.visible");

    // Click the item
    cy.contains(".v-list-item-title", "PO").click();

    // Verify user is redirected to /lista with query param
    cy.url().should("include", "/lista");
    cy.url().should("include", "partia=PO");
  });

  it("should dedup companies", () => {
    cy.visit("/");

    // Wait for the main page content to ensure app is hydrated
    cy.get(".v-main").should("be.visible");

    // Use abstracted search command
    cy.search("Orl");

    // The menu should appear with suggestions.
    cy.get(".v-overlay__content").should("be.visible");

    // We expect "Orlen" to appear only once.
    cy.get(".v-list-item-title")
      .filter(':contains("Orlen")')
      .should("have.length", 1);
  });
});
