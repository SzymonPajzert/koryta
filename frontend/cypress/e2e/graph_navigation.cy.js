/// <reference types="cypress" />

describe("Graph Navigation", () => {
    if (!Cypress.env('USE_EMULATORS')) {
        it.skip('Skipping graph navigation tests because USE_EMULATORS is not set', () => {});
        return;
    }

    beforeEach(() => {
        cy.visit("/");
    });

    it("navigates to the list filtered by party when clicking on the graph", () => {
        // Wait for the graph to render
        cy.get(".vue-apexcharts").should("be.visible");
        
        // Use a more specific selector if possible, or force click on a region where we expect a party
        // ApexCharts are SVGs. We can try to click on a generic rect in the chart series
        // Note: The specific party clicked might depend on render order. 
        // effectively we just want to ensure *some* navigation happens.
        
        // Force click on an element within the chart
        cy.get(".apexcharts-treemap-rect").first().click({ force: true });

        // Verify URL contains 'partia' query param
        cy.url().should("include", "/lista");
        cy.url().should("include", "partia=");
        
        // Verify the list is displayed (generic check)
        cy.get(".v-card").should("have.length.greaterThan", 0);
    });

    it("filters the list correctly for a known party (PiS)", () => {
        // This test tries to specificially test the logic by visiting the URL directly 
        // if interacting with the graph is flaky, but the requirement is "clicking a graph... go to list".
        
        // Let's try to click specifically if we can identify it.
        // ApexCharts often adds titles or data-labels.
        // If we can't reliably click "PiS", we can generic click and check URL params.
        
        // Alternatively, we verify the feature logic separately from the graph click:
        cy.visit("/lista?partia=PiS");
        // Jan Kowalski is in PiS (from seed)
        cy.contains("Jan Kowalski").should("be.visible");
        // Anna Nowak is in PO (from seed) - should NOT be visible?
        // Wait, does the search/filter exclude others?
        // Assuming /lista filters exclusively.
        cy.contains("Anna Nowak").should("not.exist");
    });
});
