describe("Person Entity Wikipedia Link", () => {
  beforeEach(() => {
    cy.login(); // Assuming a custom login command exists
  });

  it("should create a new person with a Wikipedia link and display it", () => {
    const personName = "Test Wiki Person " + Date.now();
    const wikiLink =
      "https://pl.wikipedia.org/wiki/" + personName.replace(/ /g, "_");

    // Navigate to create new person page
    cy.visit("/edit/node/new?type=person");
    cy.fillField("Nazwa", personName);
    cy.fillField("Link do Wikipedii", wikiLink);
    cy.contains("Zapisz zmianę").click();

    // Verify redirection to edit page first
    cy.url().should("include", "/edit/node/");

    // Navigate directly to the entity page
    cy.url().then((url) => {
      const id = url.split("/").pop();
      cy.visit(`/entity/person/${id}`);
    });

    cy.url().should("include", "/entity/person/");
    cy.contains(personName).should("be.visible");

    // Check the expected elements are visible
    cy.contains("Wikipedia:").should("be.visible");
    cy.contains("a", wikiLink).should("have.attr", "href", wikiLink);
  });
});
