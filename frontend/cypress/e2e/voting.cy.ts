describe("Voting functionality", () => {
  beforeEach(() => {
    cy.login();
    cy.visit("/entity/person/1");
    cy.contains(".v-tab", "Dyskusja").should("be.visible").click();
    cy.wait(500);

    cy.url().should("include", "/entity/person/1");
    cy.get('[data-cy="user-logged-in"]').should("exist");
  });

  it("allows voting on an entity", () => {
    cy.intercept("POST", "/api/votes/vote").as("voteRequest");

    cy.contains("Ciekawe?").should("be.visible");

    cy.contains("button", "Tak").click();

    cy.wait("@voteRequest").then((interception) => {
      expect(interception.response?.statusCode).to.equal(200);
    });

    cy.contains("button", "Tak")
      .should("have.class", "v-btn--variant-flat")
      .and("have.class", "bg-primary");

    cy.contains("button", "Tak").click();
    cy.wait("@voteRequest");

    cy.contains("button", "Tak").should("have.class", "bg-primary");

    cy.contains("button", "Nie").click();
    cy.wait("@voteRequest");

    cy.contains("button", "Gotowe").click();
    cy.wait("@voteRequest");
    cy.contains("button", "Gotowe").should("have.class", "v-btn--variant-flat");
  });
});
