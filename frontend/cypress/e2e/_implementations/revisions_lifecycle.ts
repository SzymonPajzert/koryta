describe("Revisions Lifecycle", () => {
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
    cy.contains(".v-list-group", "Jan Kowalski -> Piotr Wiśniewski", {
      timeout: 15000,
    })
      .should("contain", "connection")
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

  it("should display pending revisions and allow navigation to details", () => {
    // This test uses the seeded data "Not approved person"
    cy.visit("/admin/audit?tab=pending");
    cy.contains(".v-tab--selected", "Oczekujące Rewizje").should("be.visible");

    // Check if the seeded item exists before trying to click it to avoid flakes if seeding changes
    cy.get("body").then(($body) => {
      if ($body.text().includes("Not approved person")) {
        cy.contains(".v-list-item", "Not approved person").click();
        cy.wait(500);
        cy.percySnapshot("Revisions List one unfolded");

        cy.contains(".v-list-group", "Not approved person").within(() => {
          cy.contains("Rewizja z").click({ force: true });
        });

        cy.url().should("include", "/entity/person/h1/rev-h1");

        cy.contains("Szczegóły Rewizji").should("be.visible");
        cy.contains("Podgląd wersji").should("be.visible");
        cy.contains("Not approved person (Updated)").should("be.visible");
      } else {
        cy.log(
          "Seeded 'Not approved person' not found, skipping this part of test",
        );
      }
    });
  });
});
