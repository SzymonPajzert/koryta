describe("User Toolbar and Edit Workflow", () => {
  beforeEach(() => {
    cy.refreshAuth();
    cy.visit("/");
  });

  it("shows toolbar only when logged in", () => {
    cy.contains("Dodaj artykuł").should("not.exist");
    // Verified that there is no toolbar when not logged in

    cy.login(); 
    cy.reload();
    cy.contains("Dodaj artykuł").should("be.visible");
  });

  it("pre-selects Article type when clicking Dodaj artykuł", () => {
    cy.login();
    cy.visit("/");
    cy.contains("Dodaj artykuł").click();
    
    cy.url().should("include", "/edit/node/new");
    cy.url().should("include", "typ=article");
    
    // Check if select has 'article'
    // Vuetify select is tricky. We check the value model if possible or the text.
    // The v-select stores value.
    // We can check if Article specific fields are visible.
    cy.contains("URL Źródła").should("exist");
    cy.contains("Krótka nazwa").should("exist");
    // Parties should be hidden
    cy.contains("Partia").should("not.exist");
  });

  it("pre-selects Person type when clicking Dodaj osobę", () => {
    cy.login();
    cy.visit("/");
    cy.contains("Dodaj osobę").click();
    
    cy.url().should("include", "typ=person");
    cy.contains("Partia").should("exist");
    cy.contains("URL Źródła").should("not.exist");
  });

  it("shows revisions list", () => {
    cy.login();
    cy.visit("/");
    cy.contains("Lista rewizji").click();
    cy.url().should("include", "/revisions");
    cy.contains("Lista Rewizji").should("be.visible");
    
    // Check if there is at least one item and click it
    // Note: This depends on seeded data having pending revisions or created nodes.
    // In previous steps we didn't explicitly create a pending node in the test flow that guarantees appearance here unless seeded data has it.
    // Assuming seeded data or previously created node exists.
    cy.get(".v-list-item").first().click();
    cy.url().should("include", "/entity/");
  });
});
