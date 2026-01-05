import { getAuthToken } from "../../support/auth";

describe("Revisions Flow", () => {
  beforeEach(() => {
    // Ensure clean state handled by seed-emulator mostly, but login is key
    cy.login(); // Custom command if available, or just mock auth
  });

  it("should display pending revisions and allow navigation to details", () => {
    // Visit revisions page
    cy.visit("/revisions");
    cy.contains("Lista Rewizji (Do Przejrzenia)");

    // Verify that we have the "Not approved person" in the list
    cy.contains("Not approved person").should("be.visible");

    // Find the list item for "Not approved person" and click its parent v-list-item to unfold
    cy.contains("Not approved person")
      .parents(".v-list-item")
      .click({ force: true });

    // Wait for unfolding
    cy.wait(500);

    // Look for the specific revision link associated with this person
    // We can assume it's visible now.
    cy.contains("Rewizja z").should("be.visible");

    // Click the revision link (it should be the one under the person)
    // We can scope it if needed, but if only one is open, global contains works.
    cy.contains("Rewizja z").click();

    // Verify redirection to details page for h1
    cy.url().should("include", "/entity/person/h1/rev-h1");

    // Verify details page content
    cy.contains("Szczegóły Rewizji").should("be.visible");
    cy.contains("Dane rewizji").should("be.visible");
    cy.contains("Not approved person (Updated)").should("be.visible");
  });
});
