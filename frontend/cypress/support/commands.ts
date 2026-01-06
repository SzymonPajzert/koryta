/// <reference types="cypress" />

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cypress {
    interface Chainable {
      login(email?: string, password?: string): Chainable<void>;
      logout(): Chainable<void>;
      refreshAuth(): Chainable<void>;
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
        if ($body.find("button:contains('Wyloguj się teraz')").length > 0) {
          cy.log("Already logged in (button found), skipping login sequence.");
          return;
        }

        // Proceed to login
        cy.get('input[type="email"]', { timeout: 20000 })
          .should("be.visible")
          .type(email);
        cy.get('input[type="password"]').should("be.visible").type(password);
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
