/// <reference types="cypress" />

declare global {
  namespace Cypress {
    interface Chainable {
      login(email?: string, password?: string): Chainable<void>;
      logout(): Chainable<void>;
      refreshAuth(): Chainable<void>;
      waitForImages(): Chainable<void>;
      waitForFonts(): Chainable<void>;
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

Cypress.Commands.add("waitForImages", () => {
  cy.log("Waiting for images to load");
  // 1. Regular img tags
  cy.get("body").then(($body) => {
    const images = $body.find("img");
    if (images.length > 0) {
      cy.wrap(images, { log: false }).each(($img) => {
        cy.wrap($img, { log: false }).should("have.prop", "complete", true);
        cy.wrap($img, { log: false })
          .should("have.prop", "naturalWidth")
          .and("be.gt", 0);
      });
    }

    // 2. Vuetify v-img components
    const vImages = $body.find(".v-img");
    if (vImages.length > 0) {
      cy.wrap(vImages, { log: false }).each(($vImg) => {
        cy.wrap($vImg, { log: false }).should(
          "not.have.class",
          "v-img--loading",
        );
      });
    }

    // 3. ApexCharts stability
    const apexCharts = $body.find(".apexcharts-canvas");
    if (apexCharts.length > 0) {
      cy.wrap(apexCharts, { log: false }).each(($chart) => {
        cy.wrap($chart, { log: false }).find("svg").should("exist");
      });
    }
  });
});

// Wait for fonts to ensure text is rendered correctly
Cypress.Commands.add("waitForFonts", () => {
  cy.document({ log: false }).then((doc) => {
    return doc.fonts.ready;
  });
});

// Overwrite percySnapshot to ensure stability
Cypress.Commands.overwrite("percySnapshot", (originalFn, ...args) => {
  cy.waitForFonts();
  cy.waitForImages();
  cy.wait(3000);
  cy.screenshot(args[0])
  return originalFn(...args);
});
