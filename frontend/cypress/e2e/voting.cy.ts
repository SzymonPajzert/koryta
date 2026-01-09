describe("Voting functionality", () => {
  beforeEach(() => {
    // Check if already logged in by visiting the entity page and checking for login indication
    cy.visit("/entity/person/1");
    cy.wait(1000); // Wait for initial load

    cy.get("body").then(($body) => {
      if ($body.find('[data-cy="user-logged-in"]').length > 0) {
        cy.log("Already logged in");
      } else {
        // Not logged in, perform login
        cy.visit("/login");
        cy.get('input[type="email"]', { timeout: 10000 }).type(
          "user@koryta.pl",
        );
        cy.get('input[type="password"]').type("password123");
        cy.get('button[type="submit"]').click();
        cy.wait(2000);
        cy.visit("/entity/person/1");
      }
    });

    // Verify we are on the page and authenticated
    cy.url({ timeout: 10000 }).should("include", "/entity/person/1");
    cy.get('[data-cy="user-logged-in"]', { timeout: 10000 }).should("exist");
  });

  it("allows voting on an entity", () => {
    cy.intercept("POST", "/api/votes/vote").as("voteRequest");

    // Visit Jan Kowalski
    // Already visited in beforeEach

    // Check if widget exists
    cy.contains("Ciekawe?").should("be.visible");
    cy.contains("Jakość").should("be.visible");

    // Wait for auth to propagate
    cy.get('[data-cy="user-logged-in"]', { timeout: 10000 }).should("exist");

    // Click "Tak" for Interesting
    cy.contains("button", "Tak").click();

    // Verify request
    cy.wait("@voteRequest").then((interception) => {
      expect(interception.response?.statusCode).to.equal(200);
    });

    // Check if score updated to 1
    // New UI shows score in a disabled button in the middle
    cy.contains("div", "Ciekawe?")
      .parent()
      .find("button:disabled")
      .should("contain", "1");

    // Expect "Tak" button to be active (primary color means flat variant here)
    cy.contains("button", "Tak")
      .should("have.class", "v-btn--variant-flat")
      .and("have.class", "bg-primary");

    // Click "Tak" again to verify additive voting
    cy.contains("button", "Tak").click();
    cy.wait("@voteRequest");

    // Check if score updated to 2
    cy.contains("div", "Ciekawe?")
      .parent()
      .find("button:disabled")
      .should("contain", "2");

    // Click "Nie" for Interesting (should decrease by 1)
    cy.contains("button", "Nie").click();
    cy.wait("@voteRequest");
    
    // Score should go back to 1 (2 - 1 = 1)
    cy.contains("div", "Ciekawe?")
      .parent()
      .find("button:disabled")
      .should("contain", "1");

    // Click "Gotowe" for Quality
    cy.contains("button", "Gotowe").click();
    cy.contains("button", "Gotowe").should("have.class", "v-btn--variant-flat");
  });
});
