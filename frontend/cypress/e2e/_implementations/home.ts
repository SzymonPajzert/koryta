/// <reference types="cypress" />

describe("home", () => {
  beforeEach(() => {
    cy.visit("/");
  });

  it("displays four clickable cards", () => {
    cy.get(".v-card").should("have.length.at.least", 4);
    cy.wait(500); // Wait for potential animations
    cy.percySnapshot("home-page");
  });

  it("displays dashboard", () => {
    cy.wait(500); // Wait for potential animations
    cy.percySnapshot("home-dashboard");
  });

  it("shows list when clicking the first card - chart", () => {
    cy.contains(".v-card", "Łącznie").click();
    cy.url().should("include", "/lista");
  });

  it("shows correct number of people", () => {
    const expectedPeople = 5;

    cy.request("/api/nodes/person").then((response) => {
      expect(Object.values(response.body["entities"])).to.have.lengthOf(
        expectedPeople,
      );
    });

    cy.contains(`Łącznie ${expectedPeople}`);
  });

  it("shows pomoc when clicking the card with 'Dodaj osoby'", () => {
    cy.contains("Dodaj osoby")
      .closest(".v-card")
      .should("have.attr", "href", "/pomoc")
      .click({ force: true });
    cy.url().should("include", "/pomoc");
  });

  // TODO reenable
  it.skip("does not have horizontal overflow on mobile", () => {
    cy.viewport(380, 600);
    cy.visit("/");

    // Ensure content is loaded - increase timeout for seeding/emulators
    cy.get(".v-card", { timeout: 10000 }).should("have.length.at.least", 4);

    // Wait for charts/layout to settle
    cy.wait(2000);

    cy.window().then((win) => {
      const viewportWidth = win.innerWidth;
      const scrollWidth = win.document.documentElement.scrollWidth;
      const bodyScrollWidth = win.document.body.scrollWidth;

      cy.log(
        `Viewport: ${viewportWidth}, ScrollWidth: ${scrollWidth}, BodyScrollWidth: ${bodyScrollWidth}`,
      );

      // Main check
      expect(
        scrollWidth,
        `Document scrollWidth (${scrollWidth}) exceeds viewport (${viewportWidth})`,
      ).to.be.at.most(viewportWidth + 1);
      expect(
        bodyScrollWidth,
        `Body scrollWidth (${bodyScrollWidth}) exceeds viewport (${viewportWidth})`,
      ).to.be.at.most(viewportWidth + 1);

      // Card-specific check
      cy.get(".v-card").each(($card) => {
        const rect = $card[0].getBoundingClientRect();
        expect(
          rect.width,
          `Card width (${Math.round(rect.width)}) should be smaller than viewport (${viewportWidth})`,
        ).to.be.at.most(viewportWidth);
        expect(
          rect.right,
          `Card right edge (${Math.round(rect.right)}) should be within viewport (${viewportWidth})`,
        ).to.be.at.most(viewportWidth + 1);
      });
    });
  });
});
