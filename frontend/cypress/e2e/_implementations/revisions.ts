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
        const visibleEntities = Object.values(response.body["entities"]).filter(
          (e: any) => e.visibility !== false,
        );
        expect(visibleEntities).to.have.lengthOf(expectedPeople);
      });

      cy.visit("/");
      cy.contains(`Łącznie ${expectedPeople}`);
    });
  });

  describe("Krzysztof Wójcik", () => {
    it("Displays approved revision for anonymous user", () => {
      cy.logout();
      cy.visit("/entity/person/5");

      cy.contains("Politician from Konfederacja").should("be.visible");
      cy.contains("Politician from Konfederacja and PiS").should("not.exist");

      cy.percySnapshot("approved-revision");
    });

    it("Displays latest revision for logged in user", () => {
      cy.login();
      cy.visit("/entity/person/5");

      cy.percySnapshot("latest-revision");
      cy.contains("Politician from Konfederacja and PiS").should("be.visible");
    });
  });
});
