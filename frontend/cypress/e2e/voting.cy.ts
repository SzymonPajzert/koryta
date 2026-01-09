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

    // Check if score updated (assuming it was 0 initially)
    // We look for the "Wynik" text in the first section (Interesting)
    cy.contains("Ciekawe?").parent().find(".text-caption").contains("Wynik: 1");

    // Expect button to be active (primary color means flat variant here)
    cy.contains("button", "Tak")
      .should("have.class", "v-btn--variant-flat")
      .and("have.class", "bg-primary"); // Vuetify uses bg-primary for flat buttons with color="primary"

    // Click "Nie" for Interesting
    cy.contains("button", "Nie").click();
    cy.contains("button", "Nie").should("have.class", "v-btn--variant-flat");
    cy.contains("button", "Tak").should(
      "have.class",
      "v-btn--variant-outlined",
    );

    // Click "Gotowe" for Quality
    cy.contains("button", "Gotowe").click();
    cy.contains("button", "Gotowe").should("have.class", "v-btn--variant-flat");
  });
});
