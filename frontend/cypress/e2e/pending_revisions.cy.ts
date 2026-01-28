describe("Pending Revisions", () => {
  beforeEach(() => {
    cy.login();
  });

  it("lists pending edge revisions (newly created edges) and resolves names", () => {
    // Warmup
    cy.visit("/");
    cy.wait(1000);

    // 1. Visit Jan Kowalski (node 1) edit page
    cy.visit("/edit/node/1");
    cy.url().should("include", "/edit/node/1");
    cy.wait(2000);
    // Wait for page load
    cy.contains("Treść i Powiązania", { timeout: 10000 }).should("be.visible");

    // Click "Powiązanie z" button directly (matching "Dodaj osobę, którą")
    cy.contains("button", "Dodaj osobę, którą").click();

    // Use pickEntity
    cy.pickEntity("Piotr Wiśniewski");

    cy.fillField("Nazwa relacji", "znajomi");
    cy.contains("button", "Dodaj powiązanie").click();

    cy.contains("Piotr Wiśniewski").should("be.visible");
    cy.contains("znajomi").should("be.visible");

    cy.visit("/entity/person/1");
    cy.contains("Piotr Wiśniewski").should("be.visible");
    cy.contains("znajomi").should("be.visible");

    // 3. Visit Revisions
    cy.visit("/admin/audit?tab=pending");

    cy.request("/api/edges/pending").then((resp) => {
      const edges = Object.values(resp.body);
      const myEdge = edges.find(
        (e) =>
          (e as { source: string }).source === "1" ||
          (e as { source_name: string }).source_name === "Jan Kowalski",
      );
      if (myEdge) {
        expect((myEdge as { source_name: string }).source_name).to.equal(
          "Jan Kowalski",
        );
      }
    });

    // Wait for loading
    cy.get(".v-progress-circular").should("not.exist");

    // 5. Expand the group
    cy.contains(".v-list-group", "connection", { timeout: 15000 })
      .should("contain", "Jan Kowalski")
      .should("contain", "Piotr Wiśniewski")
      .as("group");

    cy.get("@group").click();

    // Click the actual revision - wait for it to be visible after expansion
    cy.get("@group").within(() => {
      cy.contains("Rewizja z", { timeout: 10000 }).should("be.visible").click();
    });

    // 6. Verify we navigate to the entity page (with revision ID)
    cy.url().should("include", "/entity/connection/");

    cy.get("body").should("be.visible");
  });
});
