describe("My Revisions Workflow", () => {
  beforeEach(() => {
    cy.refreshAuth();
    cy.login();
  });

  it("should allow reverting a proposed revision", () => {
    // Warmup navigation to ensure auth state is picked up
    cy.visit("/");
    cy.wait(1000);

    // 1. Create a revision (edit a node)
    cy.visit("/edit/node/1");
    cy.wait(2000);
    cy.contains("Treść i Powiązania", { timeout: 10000 }).should("be.visible");

    // Change name to trigger a revision
    const randomSuffix = Math.floor(Math.random() * 10000);
    const newName = `Jan Kowalski ${randomSuffix}`;
    cy.fillField("Nazwa", newName);

    // Submit
    cy.contains("Zapisz", { matchCase: false }).click();

    // Wait for success message or redirect (usually redirects to entity page)
    cy.url().should("include", "/entity/person/1");

    // 2. Visit Audit Page -> My Revisions
    cy.visit("/admin/audit");
    cy.url().should("include", "/admin/audit");
    cy.contains(".v-tab", "Moje Propozycje").click();

    // 3. Verify revision is visible
    cy.contains(newName).should("be.visible");

    // 4. Click revert (Wycofaj)
    // We need to find the specific item. Since we just added it, it should be there.
    // The "Wycofaj" button is inside the list item.
    cy.contains(".v-list-item", newName)
      .should("be.visible")
      .within(() => {
        cy.contains("button", "Wycofaj").click({ force: true });
      });

    // 5. Confirm dialog (browser confirm)
    // Cypress automatically accepts confirms, but we can verify it was triggered if needed.
    // The previous action triggers it.

    // 6. Verify revision is gone
    cy.contains(newName).should("not.exist");
  });
});
