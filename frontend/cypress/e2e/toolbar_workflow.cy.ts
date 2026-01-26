describe("User Toolbar and Edit Workflow", () => {
  beforeEach(() => {
    cy.refreshAuth();
    cy.visit("/");
  });

  it("shows toolbar only when logged in", () => {
    cy.contains("button", "Dodaj nowe").should("not.exist");

    cy.login();
    cy.contains("button", "Dodaj nowe").should("be.visible");

    cy.percySnapshot("toolbar-logged-in");
  });

  it("pre-selects Article type when clicking Dodaj artykuł", () => {
    cy.login();
    cy.contains("button", "Dodaj nowe").click();
    cy.contains("button", "Dodaj artykuł").click();

    cy.url().should("include", "/edit/node/new");
    cy.url().should("include", "type=article");

    cy.verifyLabelExists("URL Źródła");
    cy.verifyLabelExists("Krótka nazwa");
    cy.verifyLabelDoesNotExist("Partia");
  });

  it("pre-selects Person type when clicking Dodaj osobę", () => {
    cy.login();
    cy.visit("/");
    cy.contains("button", "Dodaj nowe").click();
    cy.contains("button", "Dodaj osobę").click();

    cy.url().should("include", "type=person");
    cy.verifyLabelExists("Partia");
    cy.verifyLabelDoesNotExist("URL Źródła");
  });

  it("shows revisions list", () => {
    cy.login();
    cy.visit("/");
    cy.contains("button", "Lista rewizji").click();
    cy.url().should("include", "/revisions");
    cy.contains("Lista Rewizji").should("be.visible");

    // Check if there is at least one item and click it
    // Note: This depends on seeded data having pending revisions or created nodes.
    // In previous steps we didn't explicitly create a pending node in the test flow that guarantees appearance here unless seeded data has it.
    // Assuming seeded data or previously created node exists.
    cy.get(".v-list-item").first().click();

    // Wait for unfolding
    cy.wait(500);

    // Click the revision link
    cy.contains("Rewizja z").click();

    cy.url().should("include", "/entity/");
  });
});
