describe("Revisions Logic", () => {
  afterEach(() => {
    if (this.currentTest?.state === "failed") {
      cy.screenshot();
    }
  });

  it("Displays data from approved revision", () => {
    // Visit the list page where Node 1 is displayed
    cy.visit("/lista?partia=PO");

    // Node 1 (Jan Kowalski) should be overridden by Revision 1
    // Revision 1 content: "Politician from PO"

    // Wait for list to load
    cy.get(".v-card").should("have.length.at.least", 1);

    // Check text content
    cy.contains("Politician from PO").should("be.visible");
  });

  it("Displays approved revision for anonymous user", () => {
    cy.visit("/entity/person/5");
    // Should NOT see the PiS part
    cy.contains("Politician from Konfederacja").should("be.visible");
    cy.contains("Politician from Konfederacja and PiS").should("not.exist");

    cy.percySnapshot("approved-revision");
  });

  it.skip("Displays latest revision for logged in user", () => {
    cy.login();

    cy.visit("/entity/person/5");

    // Node 5 (Krzysztof Wójcik)
    // Public (rev5): "Politician from Konfederacja"
    // Latest (rev6): "Politician from Konfederacja and PiS"

    cy.contains("Politician from Konfederacja and PiS").should("be.visible");

    cy.percySnapshot("latest-revision");
  });
});
