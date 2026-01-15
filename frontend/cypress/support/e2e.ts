import "./commands";

// Hide noisy Firestore long-polling requests from Cypress logs
beforeEach(() => {
  cy.intercept(
    {
      url: "**/google.firestore.v1.Firestore/Listen/**",
    },
    { log: false },
  );
});
