/// <reference types="cypress" />

describe("Emulator Verification", () => {
    if (!Cypress.env('USE_EMULATORS')) {
        it.skip('Skipping emulator tests because USE_EMULATORS is not set', () => {});
        return;
    }

    it("displays seeded data on the list page", () => {
        cy.visit("/lista");
        // Verify that "Test Node 1" (seeded data) is present
        cy.contains("Test Node 1").should("be.visible");
        // Verify that "Test Node 2" (seeded data) is present
        cy.contains("Test Node 2").should("be.visible");
    });

    it("can navigate to a seeded person details", () => {
        cy.visit("/lista");
        cy.contains("Test Node 1").click();
        cy.url().should("include", "/entity/person/1");
        cy.contains("A test person").should("be.visible");
    });
});
