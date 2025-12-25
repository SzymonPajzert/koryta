describe("New Node Navigation", () => {
  beforeEach(() => {
    cy.refreshAuth();
  });

  it("navigates to the new node edit page after creation", () => {
    // 1. Login
    cy.login();

    // 2. Go to Create New Node page
    cy.visit("/edit/node/new");
    cy.contains("h1", "Utwórz").should("be.visible");
    cy.get('button[value="comments"]').should("be.disabled");
    cy.contains("h3", "Powiązania").should("not.exist");

    // 3. Fill in data
    const newName = "Test Person " + Date.now();
    cy.contains("label", "Nazwa").parent().find("input").type(newName);
    // Use the MD editor (v-textarea)
    cy.contains("label", "Treść (Markdown)")
      .parent()
      .find("textarea")
      .type("This is a test person content.");

    // 4. Save
    cy.contains("button", "Zapisz zmianę").click();

    // 5. Verify navigation to a node ID
    cy.url().should("match", /\/edit\/node\/[a-zA-Z0-9_-]+$/);
    cy.url().should("not.contain", "/new");

    cy.contains("h1", "Edytuj").should("be.visible");
    cy.get('button[value="comments"]').should("be.enabled");
    cy.contains("h3", "Powiązania").should("be.visible");

    // Verify name is still there
    cy.contains("label", "Nazwa")
      .parent()
      .find("input")
      .should("have.value", newName);

    // 6. Verify we can add a connection now
    cy.contains("label", "Rodzaj relacji").parent().click();
    cy.contains("Powiązanie z").click();

    // Check if EntityPicker works on this "newly transitioned" page
    cy.contains("label", "Wyszukaj osobę")
      .parent()
      .find("input")
      .click()
      .type("Anna", { delay: 100 });
    cy.get(".v-list-item-title", { timeout: 15000 })
      .contains("Anna Nowak")
      .should("be.visible")
      .click();

    cy.contains("button", "Dodaj powiązanie").click();
    cy.contains("Anna Nowak").should("be.visible");
  });

  it("allows creating a node without content and verifies it is searchable", () => {
    // 1. Login
    cy.login();

    // 2. Go to Create New Node page
    cy.visit("/edit/node/new");

    // 3. Fill in ONLY name
    const newName = "Optional Content Node " + Date.now();
    cy.contains("label", "Nazwa").parent().find("input").type(newName);

    // 4. Save
    cy.contains("button", "Zapisz zmianę").click();

    // 5. Verify navigation to a node ID
    cy.url().should("match", /\/edit\/node\/[a-zA-Z0-9_-]+$/);
    cy.url().should("not.contain", "/new");
    cy.contains("h1", "Edytuj").should("be.visible");
    cy.contains("label", "Nazwa")
      .parent()
      .find("input")
      .should("have.value", newName);

    // 6. Go to home page and search for it
    cy.visit("/");
    cy.contains("label", "Szukaj osoby albo miejsca")
      .parent()
      .find("input")
      .type(newName);
    // Wait for debounce and search results
    cy.contains(".v-list-item-title", newName, { timeout: 10000 }).should(
      "be.visible",
    );

    // 7. Logout and verify it is HIDDEN from anonymous users
    cy.visit("/login");
    cy.contains("button", "Wyloguj się teraz").click();
    cy.visit("/");
    cy.contains("label", "Szukaj osoby albo miejsca")
      .parent()
      .find("input")
      .type(newName);
    // It should not appear in results
    cy.contains(".v-list-item-title", newName).should("not.exist");
  });
});
