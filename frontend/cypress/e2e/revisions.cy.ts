describe("Revisions Logic", () => {
  beforeEach(() => {
    cy.window().then((win) => {
      return new Cypress.Promise((resolve) => {
        const req = win.indexedDB.deleteDatabase("firebaseLocalStorageDb");
        req.onsuccess = resolve;
        req.onerror = resolve;
        req.onblocked = resolve;
      });
    });
  });

  afterEach(() => {
    if (this.currentTest?.state === "failed") {
      cy.screenshot();
    }
  });

  describe("Krzysztof Wójcik", () => {
    it("Displays approved revision for anonymous user", () => {
      // Warm up
      cy.visit("/");
      cy.visit("/entity/person/5");

      // Should NOT see the PiS part
      cy.contains("Politician from Konfederacja").should("be.visible");
      cy.contains("Politician from Konfederacja and PiS").should("not.exist");

      cy.percySnapshot("approved-revision");
    });

    it("Displays latest revision for logged in user", () => {
      cy.login();

      cy.visit("/entity/person/5");

      // Node 5 (Krzysztof Wójcik)
      // Public (rev5): "Politician from Konfederacja"
      // Latest (rev6): "Politician from Konfederacja and PiS"

      cy.contains("Politician from Konfederacja and PiS").should("be.visible");

      cy.percySnapshot("latest-revision");
    });
  });

  describe("New node added", () => {
    it("shows correct number of people", () => {
      const expectedPeople = 4;

      cy.request("/api/nodes/person").then((response) => {
        expect(Object.values(response.body["entities"])).to.have.lengthOf(expectedPeople);
      });

      cy.visit("/");
      cy.contains(`Lista wszystkich ${expectedPeople}`);
    });
  })
});
