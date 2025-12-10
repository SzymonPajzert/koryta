/// <reference types="cypress" />

describe("Emulator Verification", () => {
    if (!Cypress.env('USE_EMULATORS')) {
        it.skip('Skipping emulator tests because USE_EMULATORS is not set', () => {});
        return;
    }

    it("displays seeded data on the list page", () => {
        cy.visit("/lista");
        // Wait for list items to appear to ensure data is loaded
        cy.get(".v-list-item", { timeout: 10000 }).should("exist");
        // Verify that "Jan Kowalski" (seeded data) is present
        cy.contains("Jan Kowalski").should("be.visible");
        // Verify that "Anna Nowak" (seeded data) is present
        cy.contains("Anna Nowak").should("be.visible");
    });

    it("can navigate to a seeded person details", () => {
        cy.visit("/lista");
        cy.contains("Jan Kowalski").click();
        cy.url().should("include", "/entity/person/1");
        cy.contains("A politician").should("be.visible");
    });
});
