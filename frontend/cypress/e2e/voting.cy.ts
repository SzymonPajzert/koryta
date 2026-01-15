describe("Voting functionality", () => {
  beforeEach(() => {
    cy.login();
    cy.visit("/entity/person/1");
    // Switch to Discussion tab to see the widget
    cy.contains(".v-tab", "Dyskusja").should("be.visible").click();

    // Verify we are on the page and authenticated
    cy.url({ timeout: 10000 }).should("include", "/entity/person/1");
    cy.get('[data-cy="user-logged-in"]', { timeout: 10000 }).should("exist");
  });

  it("allows voting on an entity", () => {
    cy.intercept("POST", "/api/votes/vote").as("voteRequest");

    // Wait for auth to propagate and widget to check
    cy.get('[data-cy="user-logged-in"]', { timeout: 10000 }).should("exist");
    cy.contains("Ciekawe?").should("be.visible");

    // Click "Tak" for Interesting
    cy.contains("button", "Tak").click();

    // Verify request
    cy.wait("@voteRequest").then((interception) => {
      expect(interception.response?.statusCode).to.equal(200);
    });

    // Expect "Tak" button to be active
    // This confirms the vote was registered and UI updated (either from optimistic or real update)
    cy.contains("button", "Tak")
      .should("have.class", "v-btn--variant-flat")
      .and("have.class", "bg-primary");

    // Click "Tak" again to verify additive voting (backend integration mostly)
    cy.contains("button", "Tak").click();
    cy.wait("@voteRequest");

    // Verify it is still active
    cy.contains("button", "Tak").should("have.class", "bg-primary");

    // Click "Nie" for Interesting
    cy.contains("button", "Nie").click();
    cy.wait("@voteRequest");

    // Click "Gotowe" for Quality
    cy.contains("button", "Gotowe").click();
    cy.wait("@voteRequest");
    cy.contains("button", "Gotowe").should("have.class", "v-btn--variant-flat");
  });
});
