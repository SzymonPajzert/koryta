const isCI = Cypress.env("CI");

describe("Revisions Logic", () => {
  beforeEach(() => {
    cy.refreshAuth();
  });

  afterEach(() => {
    if (this.currentTest?.state === "failed") {
      cy.screenshot();
    }
  });

  describe("New node added", () => {
    beforeEach(() => {
      cy.refreshAuth();
    });
    it("shows correct number of people", () => {
      const expectedPeople = 5;

      cy.logout();

      cy.request("/api/nodes/person").then((response) => {
        expect(Object.values(response.body["entities"])).to.have.lengthOf(
          expectedPeople,
        );
      });

      cy.visit("/");
      cy.contains(`Lista wszystkich ${expectedPeople}`);
    });
  });

  (isCI ? describe.skip : describe)("Krzysztof Wójcik", () => {
    it("Displays approved revision for anonymous user", () => {
      cy.logout();
      // Warm up
      cy.visit("/");
      cy.visit("/entity/person/5");

      // Should NOT see the PiS part
      cy.contains("Politician from Konfederacja").should("be.visible");
      cy.contains("Politician from Konfederacja and PiS").should("not.exist");

      cy.wait(500); // Wait for potential animations
      cy.percySnapshot("approved-revision");
    });

    it("Displays latest revision for logged in user", () => {
      cy.login();

      cy.visit("/entity/person/5");

      // Node 5 (Krzysztof Wójcik)
      // Public (rev5): "Politician from Konfederacja"
      // Latest (rev6): "Politician from Konfederacja and PiS"

      cy.wait(500); // Wait for potential animations
      cy.percySnapshot("latest-revision");

      cy.contains("Politician from Konfederacja and PiS").should("be.visible");
    });
  });
});
