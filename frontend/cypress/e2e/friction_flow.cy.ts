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

    // 1. Login with seeded user
    cy.visit("/login");
    cy.get('input[type="email"]').type("user@koryta.pl");
    cy.get('input[type="password"]').type("password123");
    cy.get('button[type="submit"]').click();

    // Wait for login/redirect
    cy.url().should("not.include", "/login");

    // 2. Verify "Dodaj" button exists
    cy.get("header").contains("Dodaj").should("exist");

    // 3. Create Person via the new button or direct link
    // Let's use the shortcut we added to default.vue if screen is small or just direct link for stability
    cy.visit("/edit/node/new?type=person");
    
    // Fill Person Form
    // Try to find the input for name. Based on snippet it is FormAlreadyExisting inside.
    // We should look for a label "Nazwa" or similar.
    cy.contains("label", "Nazwa").parent().find("input").type(personName);
    cy.get("textarea").type("Some biographical content.");
    cy.contains("button", "Zapisz zmianę").click();

    // Verify redirect to the edit page for the new node
    cy.url().should("include", "/edit/node/");
    // Optionally go to the public page to verify
    cy.contains("Anuluj").click(); // "Anuluj" goes to entity page if not new
    cy.url().should("include", "/entity/person/");
    cy.contains(personName).should("be.visible");

    // 4. Create Company
    cy.visit("/edit/node/new?type=place");
    // Ensure we are in "Place" mode. Use robust Vuetify selection.
    // Click the select to open options
    cy.contains("label", "Typ").parent().click();
    // Wait for the overlay and click "Firma"
    // Vuetify renders options in .v-overlay-container at the root
    cy.get(".v-overlay").contains("Firma").click();
    
    // Verify selection (optional but good for debugging)
    // The select should now show "Firma"
    cy.contains("label", "Typ").parents(".v-select").contains("Firma").should("exist");

    cy.contains("label", "Nazwa").parent().find("input").type(companyName);
    
    // Intercept the create request to verify payload
    cy.intercept("POST", "/api/nodes/create").as("createNode");

    // Select Type if necessary, but we passed ?type=place so it should be pre-filled
    cy.contains("button", "Zapisz zmianę").click();

    cy.wait("@createNode").then((interception) => {
      expect(interception.request.body.type).to.equal("place");
      expect(interception.request.body.name).to.equal(companyName);
    });

    // Verify redirect to edit page
    cy.url().should("include", "/edit/node/");
    
    // Wait for data to load and verify it's a Company
    // This ensures we don't click Anuluj before the type is fetched
    cy.contains(".v-select .v-select__selection-text", "Firma").should("exist");

    // Go to public page
    cy.contains("Anuluj").click();
    cy.url().should("include", "/entity/place/");
    cy.contains(companyName).should("be.visible");

    // 5. Verify Company is visible in Search (The main fix)
    // We need to wait a bit for any indexing? Or just backend refresh.
    // Clear search first
    cy.get("header").find("input").clear().type(companyName);
    // Should see it in results
    cy.contains(".v-list-item-title", companyName).should("exist");

    // 6. Link Person to Company
    // Go back to person
    cy.visit("/lista"); // navigate via list or search
    cy.get("input[label='Szukaj osoby albo miejsca']").clear().type(personName);
    cy.contains(".v-list-item-title", personName).click();

    // Click "Suggest Change" or "Edit"
    cy.contains("Zaproponuj zmianę").click();

    // Add "Employed" edge
    // "Dodaj gdzie [Name] pracuje"
    cy.contains(`Dodaj gdzie ${personName} pracuje`).click();

    // In the edge form, search for the company
    // This is the EntityPicker inside EditEdge
    cy.contains("label", "Wyszukaj firmę").parent().find("input").type(companyName);
    
    // Select the company from dropdown
    cy.contains(".v-list-item-title", companyName).click();

    // Save Edge
    cy.contains("button", "Dodaj powiązanie").click();

    // Verify the edge appears on person profile
    cy.contains(companyName).should("exist");
  });
});
