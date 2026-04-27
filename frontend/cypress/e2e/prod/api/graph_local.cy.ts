describe("/api/graph/local", () => {
  const baseUrl = "http://localhost:3000/api/graph/local";

  describe("edges", () => {
    const req = () => {
      const id = "2AOYnvuAF1Piqh1Vk30p";
      return cy.request(`${baseUrl}/${id}?latest=true&distance=1&center=${id}`);
    };

    it("each edge has subtype", () => {
      req().then((response) => {
        expect(response.status).to.eq(200);

        const body = response.body;
        expect(body).to.have.property("edges");

        expect(body.edges).to.be.an("array");
        expect(body.edges.length).to.be.greaterThan(0);

        body.edges.forEach((edge) => {
          expect(edge).to.have.property("subtype");
        });
      });
    });
  });
});
