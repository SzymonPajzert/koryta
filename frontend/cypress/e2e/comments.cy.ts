describe("Comments and Discussions", () => {
  beforeEach(() => {
    cy.login();
  });

  it("allows posting a comment on an entity page", () => {
    cy.visit("/entity/person/1");

    // Check tabs
    cy.contains(".v-tab", "Dyskusja").should("be.visible").click();

    // Check empty state or existing comments
    cy.contains("Dodaj komentarz").should("be.visible");

    // Open form
    cy.contains("Dodaj komentarz").click();

    // Type comment
    const commentText = `Test comment ${Date.now()}`;
    cy.get("[data-test='comment-input']")
      .should("be.visible")
      .type(commentText);

    // Submit
    cy.contains(".comments-section button", "Wyślij").click();

    // Verify comment appears
    cy.contains(commentText).should("be.visible");
  });

  it("allows replying to a comment", () => {
    cy.visit("/entity/person/1");
    cy.contains(".v-tab", "Dyskusja").click();

    // Assumes there is at least one comment from previous test or seed
    cy.contains("Dodaj komentarz").click();
    cy.get("[data-test='comment-input']").first().type("Parent comment");
    cy.contains(".comments-section button", "Wyślij").click();

    cy.contains("Parent comment").should("be.visible");

    // Click reply on the comment
    cy.contains(".comment-item", "Parent comment")
      .find("button")
      .contains("Odpowiedz")
      .click();

    // Type reply
    const replyText = `Reply ${Date.now()}`;
    // Respond in the nested form
    cy.contains(".comment-item", "Parent comment")
      .find("[data-test='comment-input']")
      .type(replyText);

    // Verify content is typed
    cy.contains(".comment-item", "Parent comment")
      .find("[data-test='comment-input'] textarea")
      .should("have.value", replyText);

    // Submit reply
    cy.contains(".comment-item", "Parent comment")
      .find(".comment-form button")
      .contains("Wyślij")
      .click({ force: true });

    // Check Status or existence
    // The form closes on success, so we just wait a bit or assume success if next steps pass.

    // Wait for network/processing
    cy.wait(3000);
    cy.reload();
    cy.contains(".v-tab", "Dyskusja").click();

    // Verify persistence
    cy.contains(replyText, { timeout: 15000 }).should("be.visible");

    // Check if it is nested inside the parent
    cy.contains(".comment-item", "Parent comment")
      .contains(replyText)
      .should("be.visible");
  });

  it("allows posting a lead in leads page", () => {
    cy.visit("/leads");

    cy.contains("Leads / Wolne wątki");
    cy.contains("Dodaj komentarz").click();

    const leadText = `Lead ${Date.now()}`;
    cy.get("[data-test='comment-input']").type(leadText);
    cy.contains(".comments-section button", "Wyślij").click();

    cy.contains(leadText).should("be.visible");
  });
});
