/// <reference types="cypress" />

declare global {
  namespace Cypress {
    interface Chainable {
      login(email?: string, password?: string): Chainable<void>;
    }
  }
}

export {};

Cypress.Commands.add("login", (email = "user@koryta.pl", password = "password123") => {
  cy.visit("/login");
  
  // Clear possible stale state
  cy.clearLocalStorage();
  cy.clearCookies();
  cy.reload();

  // Wait for the form to hydrate and appear
  cy.get('input[type="email"]', { timeout: 20000 }).should('be.visible').type(email);
  cy.get('input[type="password"]').should('be.visible').type(password);
  cy.get('button[type="submit"]').should('be.visible').click();
  
  // Wait for navigation away from login (to home or redirect)
  cy.url({ timeout: 20000 }).should("not.contain", "/login");
  
  // Extra wait for auth state to settle in the app
  cy.wait(1000);
});
