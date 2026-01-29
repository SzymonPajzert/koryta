describe("API /api/person/bulk_create", () => {
  let authToken: string;

  beforeEach(() => {
    cy.login();

    cy.window()
      .then((win) => {
        return new Cypress.Promise((resolve, reject) => {
          const req = win.indexedDB.open("firebaseLocalStorageDb");
          req.onsuccess = (e) => {
            const db = (e.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains("firebaseLocalStorage")) {
              resolve(null);
              return;
            }
            const transaction = db.transaction(
              ["firebaseLocalStorage"],
              "readonly",
            );
            const objectStore = transaction.objectStore("firebaseLocalStorage");
            const getAllRequest = objectStore.getAll();
            getAllRequest.onsuccess = () => {
              const users = getAllRequest.result;
              if (users && users.length > 0) {
                const user = users[0].value || users[0];
                resolve(user.stsTokenManager?.accessToken);
              } else {
                resolve(null);
              }
            };
            getAllRequest.onerror = () => reject("Failed to read from DB");
          };
          req.onerror = () => reject("Failed to open DB");
        });
      })
      .then((token) => {
        authToken = token as string;
      });
  });

  it("creates a person with companies", () => {
    cy.wait(1000);
    cy.wrap(authToken).should("be.ok");

    const uniqueSuffix = Date.now();
    const personName = `Test Person ${uniqueSuffix}`;
    const companyName = `Test Company ${uniqueSuffix}`;
    const krs = `123456${uniqueSuffix.toString().slice(-6)}`;

    const articleUrl = `https://example.com/article-${uniqueSuffix}`;

    const payload = {
      name: personName,
      content: "Bio content",
      wikipedia: "https://pl.wikipedia.org/wiki/Test",
      companies: [
        {
          name: companyName,
          krs: krs,
          role: "CEO",
          start: "2020-01-01",
        },
      ],
      articles: [
        {
          url: articleUrl,
        },
      ],
    };

    // 1. Create Person
    cy.request({
      method: "POST",
      url: "/api/person/bulk_create",
      body: payload,
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    }).then((resp) => {
      expect(resp.status).to.eq(200);
      expect(resp.body.personId).to.be.a("string");
      expect(resp.body.status).to.eq("ok");

      // Verify Companies response
      expect(resp.body.companies).to.be.an("array").that.has.length(1);
      expect(resp.body.companies[0].companyId).to.be.a("string");
      expect(resp.body.companies[0].created).to.eq(true);

      // Verify Articles response
      expect(resp.body.articles).to.be.an("array").that.has.length(1);
      expect(resp.body.articles[0].articleId).to.be.a("string");
      expect(resp.body.articles[0].created).to.eq(true);

      const personId = resp.body.personId;
      const companyId = resp.body.companies[0].companyId;
      const articleId = resp.body.articles[0].articleId;

      // 2. Verify Person Created via GET API
      cy.request({
        method: "GET",
        url: `/api/nodes/entry/${personId}`,
        headers: { Authorization: `Bearer ${authToken}` },
      }).then((res) => {
        expect(res.status).to.eq(200);
        expect(res.body.node.name).to.eq(personName);
        expect(res.body.node.content).to.eq("Bio content");
      });

      // 3. Verify Edges
      cy.request({
        method: "GET",
        url: "/api/graph/edges",
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      }).then((res) => {
        expect(res.status).to.eq(200);
        const edges = res.body;

        // Verify Company Edge
        const companyEdge = edges.find(
          (e: { source: string; target: string }) =>
            e.source === personId && e.target === companyId,
        );
        cy.wrap(companyEdge).should("exist", "Should find edge to company");
        expect(companyEdge.label).to.eq("CEO");

        // Verify Article Edge
        const articleEdge = edges.find(
          (e: { source: string; target: string }) =>
            e.source === personId && e.target === articleId,
        );
        cy.wrap(articleEdge).should("exist", "Should find edge to article");
      });

      // 4. Verify Nodes are visible in /api/nodes list
      cy.request({
        method: "GET",
        url: "/api/nodes",
        headers: { Authorization: `Bearer ${authToken}` },
      }).then((res) => {
        expect(res.status).to.eq(200);
        const nodes = res.body.nodes;

        // Verify Person is in list
        expect(nodes).to.have.property(personId);
        expect(nodes[personId].name).to.eq(personName);

        // Verify Company is in list
        expect(nodes).to.have.property(companyId);
        expect(nodes[companyId].name).to.eq(companyName);

        // Verify Article is in list
        expect(nodes).to.have.property(articleId);
        expect(nodes[articleId].name).to.eq(articleUrl);
      });

      // 5. Verify Duplicates (in same session to avoid login flake)
      cy.request({
        method: "POST",
        url: "/api/person/bulk_create",
        body: payload,
        headers: { Authorization: `Bearer ${authToken}` },
      }).then((resp2) => {
        const id2 = resp2.body.personId;
        expect(personId).to.eq(
          id2,
          "Should return same ID for existing person",
        );
        // Verify duplicate companies/articles return created: false
        expect(resp2.body.companies[0].companyId).to.eq(companyId);
        expect(resp2.body.companies[0].created).to.eq(false);

        expect(resp2.body.articles[0].articleId).to.eq(articleId);
        expect(resp2.body.articles[0].created).to.eq(false);
      });
    });
  });
});
