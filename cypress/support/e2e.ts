// ***********************************************************
// This example support/e2e.ts is processed and
// loaded automatically before your test files.
//
// This is a great place to put global configuration and
// behavior that modifies Cypress.
//
// You can change the location of this file or turn off
// automatically serving support files with the
// 'supportFile' configuration option.
//
// You can read more here:
// https://on.cypress.io/configuration
// ***********************************************************

// Import commands.js using ES2015 syntax:
import "./commands";

if (!Cypress.env("CI")) {
  // Overwrite the command to do nothing but log a message
  Cypress.Commands.overwrite("matchImageSnapshot", () => {
    cy.log(
      "Skipping image snapshot in local environment. This test will only run in CI.",
    );
  });
}
