describe("Employment Edges", () => {
  beforeEach(() => {
    // 1. Setup authed state
    cy.login();

    // 2. Ensure we have a person to test on.
    cy.visit("/");
    // Wait for hydration
    cy.get(".v-application").should("be.visible");
  });

  it("adds a current employment (no end date) and displays it with green highlight", () => {
    // 1. Create Company first (Target)
    const companyName = `Company ${Date.now()}`;
    cy.createNode({ name: companyName, type: "place" });

    // 2. Create Person (Source)
    const uniqueName = `Employee ${Date.now()}`;
    cy.createNode({ name: uniqueName, type: "person" });

    // 3. Add Employment
    // Matches "Dodaj gdzie ... pracuje"
    cy.contains("button", "pracuje").click();

    // Search for the company we just created
    cy.pickEntity(companyName);

    // Fill start date
    cy.contains("label", "Data rozpoczęcia")
      .parent()
      .find("input")
      .type("2023-01-01");

    // Ensure End Date is empty
    cy.contains("label", "Data zakończenia")
      .parent()
      .find("input")
      .should("have.value", "");

    // Submit
    cy.contains("Dodaj powiązanie").click();
    
    // Verify payload
    cy.wait("@createEdge").then((interception) => {
       expect(interception.request.body.start_date).to.equal("2023-01-01");
       expect(interception.request.body.end_date).to.be.empty;
       expect(interception.request.body.type).to.equal("employed");
    });
    
    // Go to View Page to verify the visual highlight
    cy.contains("Anuluj").click();
    
    // Force reload to ensure fresh data from backend
    cy.reload();

    // Verify
    // The company name should be visible in a card
    cy.contains(companyName)
      .parents(".v-card")
      .should("have.class", "bg-green-lighten-5");

    // Verify Green Highlight
    // The company name should be visible in a card
    cy.contains(companyName)
      .parents(".v-card")
      .should("have.class", "bg-green-lighten-5");

    // Verify Text using "obecnie" for current job
    cy.contains(companyName).parents(".v-card").should("contain", "obecnie");
  });
});
