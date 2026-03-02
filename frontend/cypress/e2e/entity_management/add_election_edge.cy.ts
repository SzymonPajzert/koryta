/// <reference types="cypress" />

describe("Election Edge Flow", () => {
  beforeEach(() => {
    // We login in beforeEach so we're considered authenticated.
    cy.login();

    // Visit the person edit page where we can add edges
    // ID 1 is "Jan Kowalski" from the emulator seed
    cy.visit("/edit/node/1");

    // Wait for the page to load
    cy.contains("h1", "Edytuj").should("be.visible");
    cy.contains("Jan Kowalski").should("be.visible");
  });

  it("should open the form and allow filling the election details", () => {
    // Open the edge creation form by clicking the specific button for Jan Kowalski
    cy.contains("Dodaj wybory, w których brał udział Jan Kowalski").click();

    // Now verify the specific election form fields are present and can be interacted with

    // 1. Target Region (v-autocomplete via pickEntity command)
    // "Województwo Pomorskie" is ID teryt22 in the seed
    cy.pickEntity("Województwo Pomorskie", "entity-picker-target");
    // Ensure overlay is gone by clicking something neutral
    cy.get("h1").click({ force: true });
    cy.wait(500);

    // 2. Party Form (selectVuetifyOption)
    cy.selectVuetifyOption("Partia polityczna", "PO");

    // 3. Committee (v-text-field)
    cy.get('[data-testid="edge-committee-field"]').type(
      "KKW Koalicja Obywatelska",
    );

    // Use the overlay directly to ensure exact match for "Sejm" vs "Sejmik"
    cy.contains("label", "Stanowisko")
      .parents(".v-input")
      .as("stanowiskoInput");
    cy.get("@stanowiskoInput").click();
    cy.get(".v-overlay")
      .should("be.visible")
      .contains(/^Sejm$/)
      .click();
    cy.wait(500);

    // 5. Term (selectVuetifyOption)
    cy.selectVuetifyOption("Kadencja", "2024-2029");
    cy.wait(500);

    // 6. Elected (Checkbox)
    cy.get('[data-testid="edge-elected-checkbox"] input').check({
      force: true,
    });

    // 7. By-election (Checkbox)
    cy.get('[data-testid="edge-by-election-checkbox"] input').check({
      force: true,
    });

    // Validation of field values before submission
    cy.get('[data-testid="edge-committee-field"] input').should(
      "have.value",
      "KKW Koalicja Obywatelska",
    );
    cy.verifyFieldContent("Partia polityczna", "PO");
    cy.verifyFieldContent("Stanowisko", "Sejm");
    cy.verifyFieldContent("Kadencja", "2024-2029");
    cy.get('[data-testid="edge-elected-checkbox"] input').should("be.checked");
    cy.get('[data-testid="edge-by-election-checkbox"] input').should(
      "be.checked",
    );

    // Submit the edge
    cy.get('[data-testid="submit-edge-button"]').click();

    // Verify it appears in the list
    cy.wait(1000);
    cy.contains("Województwo Pomorskie").should("be.visible");
    cy.contains("Kandydował/a w").should("be.visible");
    cy.contains("PO").should("be.visible");
    cy.contains("Sejm").should("be.visible");
    cy.contains("2024-2029").should("be.visible");
  });
});
