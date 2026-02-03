/// <reference types="cypress" />

describe("OmniSearch", () => {
  beforeEach(() => {
    cy.intercept("GET", "/api/graph*").as("getGraph");
    cy.visit("/");
  });

  it("allows searching for parties", () => {
    // Wait for the main page content to ensure app is hydrated
    cy.get(".v-main").should("be.visible");

    // Use abstracted search command
    cy.search("PO");

    // The menu should appear with suggestions.
    // We expect "PO" as a title and "Partia" as a subtitle.
    cy.get(".v-overlay-container .v-overlay:visible")
      .should("exist")
      .last()
      .within(() => {
        cy.contains(".v-list-item-title", "PO").should("be.visible");
        cy.contains(".v-list-item-subtitle", "Partia").should("be.visible");

        // Click the item
        cy.contains(".v-list-item-title", "PO").click();
      });

    // Verify user is redirected to /lista with query param
    cy.url().should("include", "/lista");
    cy.url().should("include", "partia=PO");
  });

  it("should filter out regions and companies without people in OmniSearch", () => {
    // Force focus to trigger refresh() if needed
    cy.get("header input").focus().clear().type("Puste");

    // Wait for the overlay to appear instead of a network request
    cy.get(".v-overlay-container .v-overlay:visible", {
      timeout: 10000,
    }).should("exist");

    cy.contains("Województwo Puste").should("not.exist");
    cy.contains("Firma Pusta").should("not.exist");
  });

  it("should show valid chain of connected entities in OmniSearch", () => {
    cy.search("Testowa");

    // Use v-overlay__content which is the actual container for the list items
    cy.get(".v-overlay__content")
      .filter(":visible")
      .should("be.visible")
      .within(() => {
        cy.contains(".v-list-item-title", "Osoba Testowa").should("exist");
        cy.contains(".v-list-item-title", "Firma Testowa").should("exist");
      });

    cy.search("Testowe");
    // wait for list update - graph isn't re-fetched if cached but filtering happens
    cy.wait(500);

    cy.get(".v-overlay__content")
      .filter(":visible")
      .should("be.visible")
      .within(() => {
        cy.contains(".v-list-item-title", "Województwo Testowe").should(
          "exist",
        );
      });

    cy.search("Powiat Testowy");
    cy.wait(500);

    cy.get(".v-overlay__content")
      .filter(":visible")
      .should("be.visible")
      .within(() => {
        cy.contains(".v-list-item-title", "Powiat Testowy").should("exist");
      });
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

  describe("Places Navigation", () => {
    it("navigates to entity page when clicking a company result", () => {
      cy.search("Orlen");
  
      cy.get(".v-overlay__content")
          .should("be.visible")
          .contains(".v-list-item-title", /^Orlen$/)
          .click();
  
      // Verify URL change
      cy.url().should("include", "/entity/place/");
    });
    
    it("navigates to list view when clicking 'Lista' button on entity page", () => {
        cy.search("Orlen");
        cy.get(".v-overlay__content")
            .should("be.visible")
            .contains(".v-list-item-title", /^Orlen$/)
            .click();
        
        cy.url().should("include", "/entity/place/");
  
        // Check for 'Lista' button
        cy.contains("a, button", "Lista").should("be.visible").click();
        cy.url().should("include", "/lista");
        cy.url().should("include", "miejsce=");
    });
  
      it("navigates to graph view when clicking 'Graf' button on entity page", () => {
        cy.search("Orlen");
        cy.get(".v-overlay__content")
            .should("be.visible")
            .contains(".v-list-item-title", /^Orlen$/)
            .click();
        
        cy.url().should("include", "/entity/place/");
  
        // Check for 'Graf' button
        cy.contains("a, button", "Graf").should("be.visible").click();
        cy.url().should("include", "/graf");
        cy.url().should("include", "miejsce=");
    });
  });
});
