/// <reference types="cypress" />

declare global {
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

    // Wait for the form to hydrate and appear
    cy.get('input[type="email"]', { timeout: 20000 })
      .should("be.visible")
      .type(email);
    cy.get('input[type="password"]').should("be.visible").type(password);
    cy.get('button[type="submit"]').should("be.visible").click();

    // Wait for navigation away from login (to home or redirect)
    cy.url({ timeout: 20000 }).should("not.contain", "/login");

    // Extra wait for auth state to settle in the app
    cy.wait(1000);
  },
);

Cypress.Commands.add("logout", () => {
  cy.visit("/login");

  cy.contains("button", "Zaloguj się").then(($btn) => {
    if ($btn.is(":visible")) {
      cy.log("Already logged out, no action needed.");
      return;
    }
    cy.log("Logging out by clicking 'Wyloguj się teraz' button.");
    cy.contains("button", "Wyloguj się teraz").click();
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
