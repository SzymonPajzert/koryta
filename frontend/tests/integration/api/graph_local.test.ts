import { describe, it, expect } from "vitest";
import { setup, $fetch } from "@nuxt/test-utils/e2e";

describe("/api/graph/local", async () => {
  await setup({
    server: true,
  });

  describe("edges", () => {
    const fetchLocalGraph = async () => {
      const id = "2AOYnvuAF1Piqh1Vk30p";
      return await $fetch(
        `/api/graph/local/${id}?latest=true&distance=1&center=${id}`,
      );
    };

    it("each edge has subtype", async () => {
      const body = (await fetchLocalGraph()) as any;

      expect(body).toHaveProperty("edges");
      expect(Array.isArray(body.edges)).toBe(true);
      expect(body.edges.length).toBeGreaterThan(0);

      body.edges.forEach((edge: any) => {
        expect(edge).toHaveProperty("subtype");
      });
    });
  });
});
