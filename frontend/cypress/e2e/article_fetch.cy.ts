describe("Article Title Fetching", () => {
  beforeEach(() => {
    cy.refreshAuth();
  });

  it("automatically fetches title when source URL is entered for an article", () => {
    cy.login();

    cy.intercept("POST", "**/getPageTitle", {
      body: { result: { title: "Test Article Title" } },
    }).as("getPageTitle");

    cy.visit("/edit/node/new?type=article");

    cy.fillField("URL Źródła", "https://example.com/article");

    cy.wait("@getPageTitle");
    cy.verifyField("Nazwa", "Test Article Title");
  });
});
