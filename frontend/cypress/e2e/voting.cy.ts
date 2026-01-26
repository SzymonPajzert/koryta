import { testVotingBehavior } from "../support/shared/voting";

describe("Voting functionality", () => {
  beforeEach(() => {
    cy.login();
    cy.visit("/entity/person/1");
    // Switch to Discussion tab to see the widget
    cy.contains(".v-tab", "Dyskusja").should("be.visible").click();
    cy.wait(500);

    // Verify we are on the page and authenticated
    cy.url({ timeout: 10000 }).should("include", "/entity/person/1");
    cy.get('[data-cy="user-logged-in"]', { timeout: 10000 }).should("exist");
  });

  it("allows voting on an entity", () => {
    cy.intercept("POST", "/api/votes/vote").as("voteRequest");

    // Wait for auth to propagate and widget to check
    cy.get('[data-cy="user-logged-in"]', { timeout: 10000 }).should("exist");

    // Run shared logic
    testVotingBehavior();
  });
});
