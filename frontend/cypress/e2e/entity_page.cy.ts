describe('Entity Page Data', () => {
  it('Displays content for Person 1 (Jan Kowalski / Politician from PO)', () => {
    // Visit the entity page for Node 1
    cy.visit('/entity/person/1');

    // Wait for loading ensuring page structure ok
    cy.get('.v-main').should('exist');

    // Expect to see the name (either from Node or Revision)
    // Jan Kowalski is the node name. Revision might change it, but let's check basic presence.
    cy.contains('Jan Kowalski').should('exist'); // Or whatever the name is supposed to be

    // Expect to see content from the revision
    // Based on previous task, Node 1 is linked to a revision with text "Politician from PO"
    cy.contains('Politician from PO').should('be.visible');
  });
});
