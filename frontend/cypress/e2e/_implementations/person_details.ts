describe("Person Details Editing", () => {
  beforeEach(() => {
    cy.viewport(1280, 800);
    cy.login();
  });

  it("should allow adding birth date and external links when creating a person", () => {
    cy.visit("/edit/node/new?type=person");

    cy.fillField(/^Nazwa$/, "New Person with Details");

    // Fill new fields
    cy.get('input[type="date"]').type("1990-01-01");
    cy.fillField("Link do Wikipedii", "https://pl.wikipedia.org/wiki/Test");
    cy.fillField("Link do Rejestr.io", "https://rejestr.io/osoba/1111/test");

    // Intercept creation
    cy.intercept("POST", "/api/nodes/create", (req) => {
      expect(req.body.birthDate).to.equal("1990-01-01");
      expect(req.body.wikipedia).to.equal("https://pl.wikipedia.org/wiki/Test");
      expect(req.body.rejestrIo).to.equal("https://rejestr.io/osoba/1111/test");
      req.reply({
        id: "new-person-id",
      });
    }).as("createNode");

    cy.contains("Zapisz zmianę").click();
    cy.wait("@createNode");
  });
});
