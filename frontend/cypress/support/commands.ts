/// <reference types="cypress" />
import { addMatchImageSnapshotCommand } from "@simonsmith/cypress-image-snapshot/command";

addMatchImageSnapshotCommand();

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cypress {
    interface Chainable {
      login(email?: string, password?: string): Chainable<void>;
      logout(): Chainable<void>;
      refreshAuth(): Chainable<void>;
      matchImageSnapshot(name?: string, options?: unknown): Chainable<void>;
    }
  }
}

export {};

Cypress.Commands.add(
  "login",
  (email = "user@koryta.pl", password = "password123") => {
    cy.session(
      [email, password],
      () => {
        cy.visit("/login");
        cy.clearLocalStorage();
        cy.clearCookies();

        cy.get('input[type="email"]').should("be.visible").type(email);
        cy.get('input[type="password"]').should("be.visible").type(password);
        cy.get('button[type="submit"]').should("be.visible").click();

        cy.url().should("not.contain", "/login");
        // Verify login success by checking for a logout button or similar authenticated state
        cy.contains("button", "Wyloguj się teraz", { timeout: 10000 }).should(
          "exist",
        );
      },
      {
        validate: () => {
          cy.visit("/");
          cy.contains("button", "Wyloguj się teraz").should("exist");
        },
      },
    );
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
