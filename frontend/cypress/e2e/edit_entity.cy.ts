describe("Entity Editing", () => {
  beforeEach(() => {
    cy.viewport(1280, 800);
    cy.task("log", "Starting test: " + Cypress.currentTest.title);
    cy.logout();
    cy.on("window:console", (msg) => {
      cy.task("log", `Browser console: ${JSON.stringify(msg)}`);
    });
  });

  it.skip("redirects to login when not authenticated", () => {
    cy.task("log", "Visiting /edit/node/1");
    cy.visit("/edit/node/1");
    cy.url().should("include", "/login");
  });

  it("allows creating and editing an entity", () => {
    cy.login();

    // Stub alert
    const onAlert = cy.stub();
    cy.on("window:alert", onAlert);

    cy.createNode({
      name: "Test Person",
      type: "person",
      content: "Some test content",
    });

    cy.contains("h1", "Edytuj");

    cy.verifyField(/^Nazwa$/, "Test Person");
    cy.fillField(/^Nazwa$/, "Test Person Updated");

    cy.contains("Zapisz zmianę").click();

    cy.wrap(onAlert).should("be.calledWith", "Zapisano!");

    cy.reload();
    cy.verifyField(/^Nazwa$/, "Test Person Updated");
  });

  it("should prepopulate fields when editing an existing entity", () => {
    cy.login();

    cy.visit("/entity/person/1");

    cy.contains("Zaproponuj zmianę").click({ force: true });

    cy.url().should("include", "/edit/node/1");

    cy.verifyField(/^Nazwa$/, "Jan Kowalski");
    cy.verifyFieldContent("Typ", "Osoba");
    cy.verifyFieldContent("Partia", "PO");

    cy.verifyField("Treść (Markdown)", "Politician from PO", "textarea");
  });
});
