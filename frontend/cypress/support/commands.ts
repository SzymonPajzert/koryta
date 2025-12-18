// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference types="cypress" />

Cypress.Commands.add("filterPlace", (name: string) => {
  cy.get(".v-autocomplete input").click().clear().type(name).wait(500);
  cy.get(".v-list-item-title").contains(name).parents(".v-list-item").should("be.visible").click({ force: true });
});

declare global {
  namespace Cypress {
    interface Chainable {
      filterPlace(name: string): Chainable<Element>;
    }
  }
}

export {};
