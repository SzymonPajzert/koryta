describe('Entity Editing', () => {
  const testEmail = `test${Date.now()}@example.com`;
  const testPassword = 'password123';

  beforeEach(() => {
    cy.task('log', 'Starting test: ' + Cypress.currentTest.title);
    cy.window().then((win) => {
      return new Cypress.Promise((resolve, reject) => {
        const req = win.indexedDB.deleteDatabase('firebaseLocalStorageDb');
        req.onsuccess = resolve;
        req.onerror = resolve; // Ignore errors
        req.onblocked = resolve;
      });
    });
    cy.on('window:console', (msg) => {
      cy.task('log', `Browser console: ${JSON.stringify(msg)}`);
    });
  });

  it('redirects to login when not authenticated', () => {
    cy.task('log', 'Visiting /edit');
    cy.visit('/edit');
    cy.url().should('include', '/login');
  });

  it('allows registering, creating and editing an entity', () => {
    // 1. Register
    cy.visit('/login');
    cy.contains('Nie masz konta? Zarejestruj się').click();
    cy.get('input[type="email"]').type(testEmail);
    cy.get('input[type="password"]').type(testPassword);
    cy.contains('button', 'Stwórz konto').click();
    
    // Should redirect to home or previous page, but we want to go to /edit
    // Wait for redirect
    cy.url().should('not.include', '/login');
    
    // 2. Go to /edit
    cy.visit('/edit');
    cy.contains('Edycja encji');

    // 3. Create new entity
    cy.contains('Dodaj nową').click();
    cy.contains('Nowa encja');
    
    // Check connectivity
    cy.request('http://localhost:8080').then((resp) => {
      cy.task('log', 'Firestore emulator reachable: ' + resp.status);
    });
    cy.get('#debug-connectivity', { timeout: 10000 }).should('not.contain', 'Checking...');
    cy.contains('Connected: false');

    // Select type Person (default)
    // Fill name

    // Actually, let's be more specific if possible, but Vuetify inputs are tricky.
    // Using contains for label is safer.
    cy.contains('label', 'Nazwa').parent().find('input').type('Test Person').should('have.value', 'Test Person');
    
    cy.task('log', 'Clicking submit button');
    cy.window().then(win => win.console.log('Test log from window'));
    cy.contains('Zapisz').click({ force: true });
    
    // Verify save started
    cy.get('#debug-saving').should('exist');

    // Verify success message
    cy.contains('Zapisano pomyślnie');
    
    // 4. Verify in list
    cy.visit('/edit');
    cy.contains('Test Person');
    
    // 5. Edit
    cy.contains('tr', 'Test Person').find('button').click();
    cy.contains('Edycja encji');
    cy.get('input[value="Test Person"]').clear().type('Test Person Updated');
    cy.contains('Zapisz').click();
    cy.contains('Zapisano pomyślnie');
    
    // 6. Verify update
    cy.visit('/edit');
    cy.contains('Test Person Updated');
  });
});
