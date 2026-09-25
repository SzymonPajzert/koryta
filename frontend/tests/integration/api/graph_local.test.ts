import { describe, it, expect } from "vitest";
import { setup, $fetch } from "@nuxt/test-utils/e2e";

describe("/api/graph/local", async () => {
  await setup({
    server: true,
  });

  describe("edges", () => {
    const fetchLocalGraph = async () => {
      const id = "2AOYnvuAF1Piqh1Vk30p";
      // `latest=true` is inert here and has been since the flag stopped being
      // an authorization signal - see the draft test below. It is left on the
      // url because that is what the browser sends, and this assertion is
      // about the shape of an edge rather than about visibility.
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

  /** `latest=true` must not hand drafts to a caller with no token.
   *
   * It used to. `authFetch` appends the flag to every request a signed in
   * reader makes, which made it read like "this is an editor", and
   * `getLocalGraph`'s `showUnapproved` argument was taken straight from it.
   * Measured against production on 2026-09-14 with no Authorization header:
   * the plain url returned 63 nodes and no drafts, and `&latest=true` returned
   * 76 nodes and 77 edges including thirteen unpublished people by name.
   *
   * The rule this restores is the one the site already states everywhere else:
   * a person and the relation to them reach a logged out reader only once both
   * have been published.
   */
  describe("drafts", () => {
    it("serves no unpublished node to a caller with no token, whatever it asks for", async () => {
      const id = "2AOYnvuAF1Piqh1Vk30p";
      const body = (await $fetch(
        `/api/graph/local/${id}?latest=true&distance=2&center=${id}`,
      )) as { nodes?: Record<string, { visibility?: boolean }> };

      const nodes = Object.values(body.nodes ?? {});
      expect(nodes.length).toBeGreaterThan(0);
      // `parseNodeDoc` stamps `visibility` with `pageIsPublic`, so a draft that
      // slipped through is visible in the response itself.
      expect(nodes.filter((node) => node.visibility === false)).toEqual([]);
    });
  });
});
