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
      createNode(node: { name: string; type: "person" | "place"; content?: string }): Chainable<void>;
      /**
       * Selects an option from a Vuetify v-select.
       * @param label The label of the select input
       * @param optionText The text of the option to select
       */
      selectVuetifyOption(label: string, optionText: string): Chainable<void>;
      /**
       * Selects an entity in the EntityPicker component.
       * @param name The name of the entity to search for and select.
       */
      pickEntity(name: string): Chainable<void>;
    }
  }
}

export {};

Cypress.Commands.add(
  "login",
  (email = "user@koryta.pl", password = "password123") => {
    cy.visit("/login");

    // Clear possible stale state
    cy.clearLocalStorage();
    cy.clearCookies();
    cy.reload();
    cy.wait(2000); // Wait for hydration and potential redirects

    // Check if we were redirected away from login (implies already logged in)
    cy.url().then((url) => {
      if (!url.includes("/login")) {
        cy.log("Redirected away from login, assuming already logged in.");
        return;
      }

      cy.get("body").then(($body) => {
        // More robust check for "Wyloguj się teraz" button using standard selector if possible, or keep text but ensure context
        if ($body.find("button:contains('Wyloguj się teraz')").length > 0) {
          cy.log("Already logged in (button found), skipping login sequence.");
          return;
        }

        // Proceed to login
        cy.get('input[type="email"]', { timeout: 20000 })
          .should("be.visible")
          .type(email);
        cy.get('input[type="password"]').should("be.visible").type(password);
        // Use type="submit" to avoid clicking Google Login button
        cy.get('button[type="submit"]').should("be.visible").click();

        // Wait for navigation away from login (to home or redirect)
        cy.url({ timeout: 20000 }).should("not.contain", "/login");
        cy.wait(1000);
      });
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

  // Fill Name
  cy.contains("label", "Nazwa").parent().find("input").should("be.visible").type(name);

  if (content) {
    cy.get("textarea").type(content);
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

Cypress.Commands.add("selectVuetifyOption", (label: string, optionText: string) => {
  cy.log(`Selecting ${optionText} for ${label}`);
  // Find the v-select by label and click it
  cy.contains("label", label).parent().should("be.visible").click();
  // Find the option in the overlay (Vuetify mounts overlays at root)
  cy.get(".v-overlay").should("be.visible").contains(optionText).click();
});
