describe("Article Title Fetching", () => {
  beforeEach(() => {
    cy.refreshAuth();
  });

  it("automatically fetches title when source URL is entered for an article", () => {
    cy.login();

    // Intercept the Cloud Function call
    // Firebase Cloud Functions v2 emulator URL format
    cy.intercept("POST", "**/getPageTitle", {
      body: { result: { title: "Test Article Title" } },
    }).as("getPageTitle");

    // 1. Go to create page with article type
    cy.visit("/edit/node/new?type=article");

    // 2. Enter URL
    cy.contains("label", "URL Źródła")
      .parent()
      .find("input")
      .type("https://example.com/article");

    // 3. Wait for intercept and check if name is populated
    cy.wait("@getPageTitle");
    cy.contains("label", "Nazwa")
      .parent()
      .find("input")
      .should("have.value", "Test Article Title");
  });
});
