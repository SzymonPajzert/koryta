/// <reference types="cypress" />

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cypress {
    interface Chainable {
      login(email?: string, password?: string): Chainable<void>;
      logout(): Chainable<void>;
      refreshAuth(): Chainable<void>;
      search(query: string): Chainable<void>;
      /**
       * Creates a new node using the UI.
       * Handles navigation, type selection (robustly), form filling, and save verification.
       */
      createNode(node: {
        name: string;
        type: "person" | "place";
        content?: string;
      }): Chainable<void>;
      /**
       * Selects an option from a Vuetify v-select.
       * @param label The label of the select input
       * @param optionText The text of the option to select
       */
      selectVuetifyOption(label: string, optionText: string): Chainable<void>;
      /**
       * Selects an entity in the EntityPicker component.
       * @param name The name of the entity to search for and select.
       * @param testId Optional data-testid of the picker (source/target/reference).
       */
      pickEntity(name: string, testId?: string): Chainable<void>;
      /**
       * Posts a comment in the comments section.
       */
      postComment(text: string): Chainable<void>;
      /**
       * Replies to a specific comment.
       */
      replyToComment(parentText: string, replyText: string): Chainable<void>;
      /**
       * Verifies a label exists on the page.
       */
      verifyLabelExists(label: string | RegExp): Chainable<void>;
      /**
       * Verifies a label does not exist on the page.
       */
      verifyLabelDoesNotExist(label: string | RegExp): Chainable<void>;
      /**
       * Fills a form field by its label.
       */
      fillField(
        label: string | RegExp,
        value: string,
        options?: { clear?: boolean },
      ): Chainable<void>;

      verifyField(label: string | RegExp, value: string): Chainable<void>;

      /**
       * Verifies a field contains specific content (useful for chips, selects, etc.)
       */
      verifyFieldContent(
        label: string | RegExp,
        content: string,
      ): Chainable<void>;
    }
  }
}

export {};

Cypress.Commands.add("verifyFieldContent", (label, content) => {
  cy.log(`Verifying field ${label} contains ${content}`);
  cy.contains("label", label).parents(".v-input").should("contain", content);
});

Cypress.Commands.add("fillField", (label, value, options = { clear: true }) => {
  cy.log(`Filling field ${label} with ${value}`);
  cy.contains("label", label).parents(".v-input").first().as("fieldContainer");
  if (options.clear) {
    cy.get("@fieldContainer")
      .find("input, textarea")
      .filter(":visible")
      .first()
      .clear();
  }
  cy.get("@fieldContainer")
    .find("input, textarea")
    .filter(":visible")
    .first()
    .type(value);
});

Cypress.Commands.add("verifyField", (label, value, type = "input") => {
  cy.log(`Verifying field ${label} has value ${value}`);
  cy.contains("label", label)
    .parents(".v-input")
    .first()
    .find(type)
    .first()
    .should("have.value", value);
});

Cypress.Commands.add(
  "login",
  (email = "user@koryta.pl", password = "password123") => {
    cy.visit("/login");
    cy.wait(1000); // Wait for potential auth initialization

    cy.get("body").then(($body) => {
      // If we see the logout button, we're already logged in
      if ($body.find('button:contains("Wyloguj się teraz")').length > 0) {
        cy.log("Already logged in (button found), skipping login sequence.");
        cy.visit("/");
      } else {
        // Proceed to login
        cy.get('input[type="email"]', { timeout: 20000 })
          .should("be.visible")
          .type(email);
        cy.get('input[type="password"]').should("be.visible").type(password);
        cy.get('button[type="submit"]').should("be.visible").click();

        // Check if we are still on login page
        cy.wait(1000);
        cy.location("pathname").then((path) => {
          if (path.includes("/login")) {
            cy.log(
              "Still on login page, assuming user missing. Registering...",
            );
            cy.get("body").then(($b) => {
              const registerBtn = $b.find(
                'a:contains("Zarejestruj"), button:contains("Zarejestruj"), a:contains("Stwórz konto")',
              );
              if (registerBtn.length) {
                cy.wrap(registerBtn).click();
                cy.get('input[type="email"]').clear().type(email);
                cy.get('input[type="password"]').clear().type(password);
                cy.get(
                  'button:contains("Stwórz konto"), button:contains("Zarejestruj")',
                ).click();
              }
            });
          }
        });
      }

      // Final verification: we are not on the login page anymore
      cy.url({ timeout: 20000 }).should("not.contain", "/login");
    });
  },
);

Cypress.Commands.add("logout", () => {
  cy.visit("/login");

  cy.get("body").then(($body) => {
    if ($body.find("button:contains('Zaloguj się')").length > 0) {
      cy.log("Already logged out, no action needed.");
      return;
    }

    if ($body.find("button:contains('Wyloguj się teraz')").length > 0) {
      cy.log("Logging out by clicking 'Wyloguj się teraz' button.");
      cy.contains("button", "Wyloguj się teraz").click();
      // Wait for the logout to complete (UI update)
      cy.contains("button", "Zaloguj się", { timeout: 10000 }).should(
        "be.visible",
      );
    } else {
      cy.log("Neither login nor logout button found - weird state.");
    }
  });

  cy.url().should("include", "/login");
});

Cypress.Commands.add("refreshAuth", () => {
  // Clear indexedDB to avoid stale auth state
  cy.window().then((win) => {
    return new Cypress.Promise((resolve) => {
      const req = win.indexedDB.deleteDatabase("firebaseLocalStorageDb");
      req.onsuccess = resolve;
      req.onerror = resolve;
      req.onblocked = resolve;
    });
  });
});

Cypress.Commands.add("search", (query: string) => {
  // Abstracting the header search input selection
  const searchInput = cy.get("header").find("input");

  searchInput.then(($input) => {
    if ($input.val()) {
      cy.wrap($input).clear();
    }
    cy.wrap($input).type(query);
  });

  // Verify that the input has the value (optional but good sanity check)
  cy.get("header").find("input").should("have.value", query);
});

Cypress.Commands.add("createNode", ({ name, type, content }) => {
  cy.log(`Creating node: ${name} (${type})`);
  cy.visit(`/edit/node/new?type=${type}`);

  // Wait for page load
  cy.contains("h1", "Utwórz").should("be.visible");

  // Enforce type selection to prevent state leaks or default mismatches
  const typeLabel = type === "person" ? "Osoba" : "Firma";

  // Use our new helper
  cy.selectVuetifyOption("Typ", typeLabel);

  cy.fillField("Nazwa", name);

  if (content) {
    cy.fillField("Treść (Markdown)", content);
  }

  // Submit
  cy.contains("button", "Zapisz zmianę").should("be.visible").click();

  // Verify Redirect
  cy.url().should("include", "/edit/node/");

  // Verify Data Integrity (Wait for correct type to load)
  cy.contains(".v-select .v-select__selection-text", typeLabel).should("exist");
});

Cypress.Commands.add(
  "pickEntity",
  (name: string, testId: string = "entity-picker-target") => {
    cy.log(`Picking entity: ${name} using ${testId}`);
    // Target the input inside the specific entity picker
    cy.get(`[data-testid="${testId}"] input`)
      .click()
      .clear()
      .type(name, { delay: 100 });

    // Wait for overlay item
    cy.get(".v-overlay").should("be.visible").contains(name).click();
  },
);

Cypress.Commands.add(
  "selectVuetifyOption",
  (label: string, optionText: string) => {
    cy.log(`Selecting ${optionText} for ${label}`);
    // Find the v-select by label and click it
    cy.contains("label", label)
      .parents(".v-input")
      .first()
      .should("be.visible")
      .click();
    // Find the option in the overlay (Vuetify mounts overlays at root)
    cy.get(".v-overlay").should("be.visible").contains(optionText).click();
  },
);

Cypress.Commands.add("postComment", (text) => {
  cy.get(".comments-section", { timeout: 10000 }).then(($section) => {
    if ($section.find("textarea:visible").length === 0) {
      cy.wrap($section).contains("button", "Dodaj komentarz").click();
    }
  });
  // Fresh lookup to handle re-renders/detachment
  // Filter for visible and pick the first to avoid measuring textareas
  cy.get(".comments-section")
    .find("textarea")
    .filter(":visible")
    .first()
    .should("be.visible")
    .type(text);
  cy.get(".comments-section").contains("button", "Wyślij").click();
});

Cypress.Commands.add("replyToComment", (parentText, replyText) => {
  cy.contains(".comment-item", parentText)
    .first()
    .contains("button", "Odpowiedz")
    .click();
  // Fresh lookup
  cy.contains(".comment-item", parentText)
    .first()
    .find("textarea")
    .filter(":visible")
    .first()
    .should("be.visible")
    .type(replyText);
  cy.contains(".comment-item", parentText)
    .first()
    .contains("button", "Wyślij")
    .click();
});

Cypress.Commands.add("verifyLabelExists", (label) => {
  cy.contains("label", label).should("exist");
});

Cypress.Commands.add("verifyLabelDoesNotExist", (label) => {
  cy.contains("label", label).should("not.exist");
});
