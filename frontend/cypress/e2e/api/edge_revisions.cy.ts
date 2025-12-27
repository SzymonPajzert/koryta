describe("Edge API", () => {
  let authToken: string;

  beforeEach(() => {
    // Login via UI
    cy.login();

    // Get token from IndexedDB
    cy.window().then((win) => {
      return new Cypress.Promise((resolve, reject) => {
        const req = win.indexedDB.open("firebaseLocalStorageDb");
        req.onsuccess = (e) => {
          const db = (e.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains("firebaseLocalStorage")) {
            // might not be ready yet or empty
            resolve(null);
            return;
          }
          const transaction = db.transaction(["firebaseLocalStorage"], "readonly");
          const objectStore = transaction.objectStore("firebaseLocalStorage");
          const getAllRequest = objectStore.getAll();
          getAllRequest.onsuccess = () => {
            const users = getAllRequest.result;
            if (users && users.length > 0) {
              // The object structure in firebaseLocalStorage usually has the user data in 'value' property
              const user = users[0].value; 
              // Verify structure just in case
              if (user && user.stsTokenManager && user.stsTokenManager.accessToken) {
                 resolve(user.stsTokenManager.accessToken);
              } else {
                 // Try looking at the object directly if it's not wrapped in 'value' (depends on version)
                 // But typically it is.
                 resolve(users[0].stsTokenManager?.accessToken);
              }
            } else {
              resolve(null);
            }
          };
          getAllRequest.onerror = () => reject("Failed to read from DB");
        };
        req.onerror = () => reject("Failed to open DB");
      });
    }).then((token) => {
      authToken = token as string;
    });
  });

  it("creates an edge with revision", () => {
    // Ensure we have a token
    expect(authToken).to.be.ok;

    const edgeData = {
      source: "node_1",
      target: "node_2",
      type: "connection",
      name: "Test Connection",
      text: "Test Description",
    };

    cy.request({
      method: "POST",
      url: "/api/edges/create",
      body: edgeData,
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    }).then((response) => {
      expect(response.status).to.eq(200);
      expect(response.body).to.have.property("id");
      expect(response.body.id).to.be.a("string");
    });
  });
});
