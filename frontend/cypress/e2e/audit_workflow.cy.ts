describe("Admin Audit Workflow", () => {
  beforeEach(() => {
    cy.login();
  });

  it("should navigate to Audit page via toolbar button", () => {
    cy.visit("/");

    cy.contains("Audyt", { matchCase: false }).should("be.visible").click();

    cy.url().should("include", "/admin/audit");

    cy.get("h1").should("contain", "Audyt danych");
    cy.contains("Krawędzie bez źródeł").should("be.visible");
    cy.contains("Artykuły bez powiązanych krawędzi").should("be.visible");
  });

  it("should show correct data on Audit page", () => {
    cy.visit("/admin/audit");
    // Verify results or empty state
    cy.get("body").then(($body) => {
      if ($body.find(".text-success").length > 0) {
        cy.contains("Wszystkie krawędzie mają źródła!").should("exist");
      } else {
        cy.get(".v-list-item").should("exist");
      }
    });
  });
});
