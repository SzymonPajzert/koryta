/// <reference types="cypress" />

describe("OmniSearch", () => {
  beforeEach(() => {
    cy.visit("/");
  });

  it("allows searching for parties", () => {
    // Wait for the main page content to ensure app is hydrated
    cy.get(".v-main").should("be.visible");

    // Click the search input to focus it
    // The label is "Szukaj osoby albo miejsca"
    // Vuetify renders the label. We can find the input associated with it or just click the label which usually focuses the input.
    cy.contains("label", "Szukaj osoby albo miejsca")
      .parent()
      .find("input")
      .type("PO");

    // The menu should appear with suggestions.
    // We expect "PO" as a title and "Partia" as a subtitle.
    // Since it's a v-autocomplete, it opens a v-menu/v-overlay.
    cy.get(".v-overlay__content").should("be.visible");

    cy.contains(".v-list-item-title", "PO").should("be.visible");
    cy.contains(".v-list-item-subtitle", "Partia").should("be.visible");

    // Click the item
    cy.contains(".v-list-item-title", "PO").click();

    // Verify user is redirected to /lista with query param
    cy.url().should("include", "/lista");
    cy.url().should("include", "partia=PO");
  });
});
