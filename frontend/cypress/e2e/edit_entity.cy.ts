describe("Entity Editing", () => {
  beforeEach(() => {
    cy.task("log", "Starting test: " + Cypress.currentTest.title);
    cy.refreshAuth();
    cy.on("window:console", (msg) => {
      cy.task("log", `Browser console: ${JSON.stringify(msg)}`);
    });
  });

  it("redirects to login when not authenticated", () => {
    cy.task("log", "Visiting /edit/node/1");
    cy.visit("/edit/node/1");
    cy.url().should("include", "/login");
  });

  it.skip("allows creating and editing an entity", () => {
    // 1. Login
    cy.login();

    // Stub alert
    const onAlert = cy.stub();
    cy.on("window:alert", onAlert);

    // 2. Go to /edit/node/new
    cy.visit("/edit/node/new");

    // Verify we are on create page
    cy.contains("h1", "Utwórz");

    cy.wait(500); // Wait for potential animations
    cy.percySnapshot("create-entity-page");

    // 3. Create new entity
    cy.contains("label", "Nazwa")
      .parent()
      .find("input")
      .type("Test Person")
      .should("have.value", "Test Person");

    cy.contains("label", "Treść (Markdown)")
      .parent()
      .find("textarea")
      .click()
      .type("Some test content");

    cy.wait(500); // Wait for v-model update
    cy.task("log", "Clicking submit button");

    cy.wait(1000);

    cy.contains("Zapisz zmianę").click({ force: true });

    // Verify redirection
    cy.url({ timeout: 10000 }).should("not.include", "/new");
    cy.contains("h1", "Edytuj");

    // 4. Update the entity
    cy.contains("label", "Nazwa")
      .parent()
      .find("input")
      .should("have.value", "Test Person") // Wait for data to load
      .clear()
      .type("Test Person Updated");

    cy.contains("Zapisz zmianę").click();

    // For update, it DOES alert "Zapisano!"
    cy.wrap(onAlert).should("be.calledWith", "Zapisano!");

    // 5. Verify update by reloading
    cy.reload();
    cy.contains("label", "Nazwa")
      .parent()
      .find("input")
      .should("have.value", "Test Person Updated");
  });

  it("should prepopulate fields when editing an existing entity", () => {
    // 1. Login
    cy.login();

    // 2. Visit /entity/person/1
    cy.visit("/entity/person/1");

    // 3. Click "Zaproponuj zmianę"
    cy.contains("Zaproponuj zmianę").click();

    // 4. Verify URL
    cy.url().should("include", "/edit/node/1");

    // 5. Verify inputs
    // Name: "Jan Kowalski"
    cy.contains("label", "Nazwa")
      .parent()
      .find("input")
      .should("have.value", "Jan Kowalski");

    // Type: "Osoba" (value 'person')
    // Vuetify selects are a bit complex, we check the displayed text in the parent container
    cy.contains("label", "Typ").parents(".v-input").should("contain", "Osoba");

    // Parties: "PO"
    // Check if the chip exists
    cy.contains("label", "Partia")
      .parents(".v-input")
      .find(".v-chip")
      .should("contain", "PO");

    // Content: "Politician from PO"
    cy.contains("label", "Treść (Markdown)")
      .parent()
      .find("textarea")
      .should("have.value", "Politician from PO");
  });
});
