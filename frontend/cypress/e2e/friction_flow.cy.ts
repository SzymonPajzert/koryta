describe("UI Friction Flow", () => {
  beforeEach(() => {
    // Clear auth state to start clean
    cy.clearLocalStorage();
    cy.clearCookies();
    // Assuming you have a way to reset DB or use a seeded environment, but for now we'll rely on unique names
  });

  it("should allow a logged-in user to create a person and a company, then link them", () => {
    const timestamp = Date.now();
    const personName = `Test Person ${timestamp}`;
    const companyName = `Test Company ${timestamp}`;

    cy.login();
    cy.contains("button", "Dodaj").should("exist");

    // 3. Create Person
    cy.createNode({ 
        name: personName, 
        type: "person", 
        content: "Some biographical content." 
    });

    // Optionally go to the public page to verify
    cy.contains("Anuluj").click(); // "Anuluj" goes to entity page if not new
    cy.url().should("include", "/entity/person/");
    cy.contains(personName).should("be.visible");

    // 4. Create Company
    // Intercept the create request to verify payload
    cy.intercept("POST", "/api/nodes/create").as("createNodeReq");

    cy.createNode({
        name: companyName,
        type: "place"
    });

    cy.wait("@createNodeReq").then((interception) => {
      expect(interception.request.body.type).to.equal("place");
      expect(interception.request.body.name).to.equal(companyName);
    });

    // Go to public page
    cy.contains("Anuluj").click();
    cy.url().should("include", "/entity/place/");
    cy.contains(companyName).should("be.visible");

    // 5. Verify Company is visible in Search
    cy.search(companyName);

    // Should see it in results
    cy.contains(".v-list-item-title", companyName).should("exist");

    // 6. Link Person to Company
    // Search for person to navigate back
    cy.visit("/");
    cy.search(personName);
    cy.contains(".v-list-item-title", personName).click();

    // Click "Suggest Change" or "Edit"
    cy.contains("Zaproponuj zmianę").click();

    // Add "Employed" edge
    // "Dodaj gdzie [Name] pracuje"
    cy.contains(`Dodaj gdzie ${personName} pracuje`).click();

    // In the edge form, search for the company
    cy.pickEntity(companyName);

    // Save Edge
    cy.contains("button", "Dodaj powiązanie").click();

    // Verify the edge appears on person profile
    cy.contains(companyName).should("exist");
  });
});
