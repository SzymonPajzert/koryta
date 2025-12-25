describe("User Toolbar and Edit Workflow", () => {
  beforeEach(() => {
    // Seed data or mock auth if possible. 
    // Assuming development environment with emulators.
    cy.refreshAuth();
    cy.visit("/");
  });

  it("shows toolbar only when logged in", () => {
    // Initially not logged in (assuming)
    cy.get("v-toolbar").should("not.exist");

    // Login (using a helper if available, or manual)
    // For now assuming we can simply bypass or use a test login
    // Leveraging existing auth patterns or just checking conditional rendering if we can mock state.
    // Since this is E2E, we need real login.
    // If login is complex, we might skip this part or assume seeded user.
    // Let's assume we can login with a test user.
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
  });
});
