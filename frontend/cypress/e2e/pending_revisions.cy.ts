describe("Pending Revisions", () => {
    beforeEach(() => {
        cy.task("log", "Starting test: " + Cypress.currentTest.title);
        // Clear indexedDB to avoid stale auth state
        cy.window().then((win) => {
            return new Cypress.Promise((resolve) => {
                const req = win.indexedDB.deleteDatabase("firebaseLocalStorageDb");
                req.onsuccess = resolve;
                req.onerror = resolve;
                req.onblocked = resolve;
            });
        });
        cy.login();
    });

    it("lists pending edge revisions (newly created edges) and resolves names", () => {
        // 1. Visit Jan Kowalski (node 1) edit page
        cy.visit("/edit/node/1");
        // Wait for page load
        cy.contains("Treść i Powiązania", { timeout: 10000 }).should("be.visible");

        // 2. Add new connection to Piotr Wiśniewski
        cy.contains("label", "Rodzaj relacji").parent().click();
        cy.get(".v-overlay").contains(".v-list-item", "Powiązanie z").click();

        cy.contains("label", "Wyszukaj osobę")
            .parent()
            .find("input")
            .click()
            .type("Piotr", { delay: 100 });
      
        cy.get(".v-overlay").contains(".v-list-item", "Piotr Wiśniewski").click();

        cy.contains("label", "Nazwa relacji")
            .parent()
            .find("input")
            .type("Connection Pending Verification");

        cy.contains("button", "Dodaj powiązanie").click();
        
        // Alerts might appear, we can check for item in list
        cy.contains("Piotr Wiśniewski").should("be.visible");
        cy.contains("Connection Pending Verification").should("be.visible");

        // 3. Visit Revisions
        cy.visit("/revisions");
        
        // Debug API directly to see if backend is returning what we expect
        cy.request("/api/edges/pending").then((resp) => {
            cy.log("Pending Edges Response:", JSON.stringify(resp.body));
            // Check if our edge is there
            const edges = Object.values(resp.body);
            const myEdge = edges.find(e => (e as any).source === "1" || (e as any).source_name === "Jan Kowalski");
            if (myEdge) {
                cy.log("Found edge:", JSON.stringify(myEdge));
                expect((myEdge as any).source_name).to.equal("Jan Kowalski");
                // Check target name if resolved
            } else {
                cy.log("Edge NOT found in API response");
            }
        });
        
        // Wait for loading
        cy.contains("Ładowanie...").should("not.exist");
        
        // Debug
        cy.get('body').then(($body) => {
            cy.log('Body content:', $body.text());
        });

        // 4. Verify it appears
        // Search more loosely for the row
        cy.contains(".v-list-item", "connection")
             .should("contain", "Jan Kowalski")
             .should("contain", "Piotr Wiśniewski")
             .click(); // 5. Click
        
        // 6. Verify we navigate to the entity page
        cy.url().should("include", "/entity/connection/");
        
        cy.get("body").should("be.visible");
    });
});
