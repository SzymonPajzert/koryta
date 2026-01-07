describe("Admin Audit Workflow", () => {
  beforeEach(() => {
    cy.login("admin@koryta.pl", "password123");
  });

  it("should navigate to Audit page via toolbar button", () => {
    cy.visit("/");

    // Check if the button exists and is visible (might be 'a' tag due to 'to' prop)
    cy.contains("Audyt").should("be.visible");

    // Click the button
    cy.contains("Audyt").click();

    // Verify URL
    cy.url().should("include", "/admin/audit");

    // Verify Page Content
    cy.get("h1").should("contain", "Audyt danych");
    cy.contains("Krawędzie bez źródeł (artykułów)").should("be.visible");
    cy.contains("Artykuły bez powiązanych krawędzi").should("be.visible");
  });

  it("should show correct data on Audit page", () => {
    cy.visit("/admin/audit");
    // Based on seeded data, we expect some entries
    // Verify that list items are rendered if there are issues, or success message if not
    cy.get("body").then(($body) => {
      if ($body.find(".text-success").length > 0) {
        cy.contains("Wszystkie krawędzie mają źródła!").should("exist");
      } else {
        cy.get(".v-list-item").should("exist");
      }
    });
  });
});
