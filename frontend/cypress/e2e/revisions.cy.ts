describe('Revisions Logic', () => {
    afterEach(() => {
        if (this.currentTest?.state === 'failed') {
            cy.screenshot();
            cy.document().then(doc => cy.log('Doc body:', doc.body.innerHTML));
        }
    });

    it('Displays data from approved revision', () => {
      // Visit the list page where Node 1 is displayed
      cy.visit('/lista?partia=PO');
  
      // Node 1 (Jan Kowalski) should be overridden by Revision 1
      // Revision 1 content: "Politician from PO"
      
      // Wait for list to load
      cy.get('.v-card').should('have.length.at.least', 1);

      // Check text content
      cy.contains('Politician from PO').should('be.visible');
    });
  
    it('Displays latest revision for logged in user', () => {
        // Mock login by visiting login page and filling form
        cy.visit('/login');
        cy.get('input[type="email"]').type('user@koryta.pl');
        cy.get('input[type="password"]').type('password123');
        cy.get('button[type="submit"]').click();

        // Wait for redirect or verified state
        cy.location('pathname').should('eq', '/profil');
        cy.wait(2000); // Ensure auth state settles and token is available

        cy.visit('/lista?partia=Konfederacja');
        
        // Node 5 (Krzysztof Wójcik)
        // Public (rev5): "Politician from Konfederacja"
        // Latest (rev6): "Politician from Konfederacja and PiS"
        
        cy.contains('Politician from Konfederacja and PiS').should('be.visible');
    });

    it('Displays approved revision for anonymous user', () => {
        cy.visit('/lista?partia=Konfederacja');
        // Should NOT see the PiS part
        cy.contains('Politician from Konfederacja').should('be.visible');
        cy.contains('Politician from Konfederacja and PiS').should('not.exist');
    });
  });
