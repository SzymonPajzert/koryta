describe("Comments and Discussions", () => {
  beforeEach(() => {
    cy.login();
  });

  it("allows posting a comment on an entity page", () => {
    cy.visit("/entity/person/1");

    const commentText = `Test comment ${Date.now()}`;
    cy.postComment(commentText);

    cy.contains(commentText).should("be.visible");
    cy.contains("Normal User").should("be.visible");
  });

  describe("allow replying", () => {
    const checkReply = (commentText: string, replyText: string) => {
      cy.wait(1000);
      cy.reload();

      cy.contains(replyText, { timeout: 15000 }).should("be.visible");
      cy.contains(".comment-item", commentText)
        .contains(replyText)
        .should("be.visible");
    };

    it("allows replying to a comment", () => {
      cy.visit("/entity/person/1");

      cy.postComment("Parent comment");
      cy.contains("Parent comment").should("be.visible");

      const replyText = `Reply ${Date.now()}`;
      cy.replyToComment("Parent comment", replyText);
      checkReply("Parent comment", replyText);
    });

    it("allows posting a lead in leads page and replying to it", () => {
      cy.visit("/leads");

      const leadText = `Lead ${Date.now()}`;
      cy.postComment(leadText);
      cy.contains(leadText).should("be.visible");

      const replyText = `Reply to Lead ${Date.now()}`;
      cy.replyToComment(leadText, replyText);
      checkReply(leadText, replyText);
    });
  });
});
