import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockNuxtImport } from "@nuxt/test-utils/runtime";
import {
  nodeUrlLocation,
  redirectToNodeUrl,
} from "../../app/composables/slugRedirect";

const { navigateTo, cacheControl } = vi.hoisted(() => ({
  navigateTo: vi.fn((to: unknown) => ({ to })),
  cacheControl: { value: undefined as string | undefined },
}));
mockNuxtImport("navigateTo", () => navigateTo);
mockNuxtImport("useResponseHeader", () => () => cacheControl);

/** The previews of a proposal go through these redirects: /admin/rewizje
 * links to a page by its /entity/ url, and the reader's list of proposals by
 * the name the proposal gives it. Both carry the proposal as `?revisionId=`,
 * which the redirect dropped, so the preview of a renamed article opened the
 * article as it was. */
describe("redirects to a node's own address", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cacheControl.value = undefined;
  });

  it("keep the query and the hash they were asked with", () => {
    expect(
      nodeUrlLocation("/artykul/nowy-tytul-a3", {
        query: { revisionId: "proposal_a3" },
        hash: "#fakty",
      }),
    ).toBe("/artykul/nowy-tytul-a3?revisionId=proposal_a3#fakty");
  });

  it("add nothing when there is nothing to carry", () => {
    expect(
      nodeUrlLocation("/osoba/jan-kowalski-1", { query: {}, hash: "" }),
    ).toBe("/osoba/jan-kowalski-1");
  });

  it("keep a region's own query, and let it win over the link's", () => {
    // A region has no page: its address is the table, filtered by its own
    // `teryt`, which a location object's `path` would have lost.
    expect(
      nodeUrlLocation("/eksploruj/tabela?teryt=1862", {
        query: { teryt: "9999", revisionId: "r1" },
        hash: "",
      }),
    ).toBe("/eksploruj/tabela?teryt=1862&revisionId=r1");
  });

  it("stay a 301 to a node's page when a query comes along", () => {
    // `slugRedirectCode` reads the node's address, and the query in the one
    // asked for would have made every one of these a 302.
    redirectToNodeUrl("/artykul/nowy-tytul-a3", {
      query: { revisionId: "proposal_a3" },
      hash: "",
    });

    expect(navigateTo).toHaveBeenCalledWith(
      "/artykul/nowy-tytul-a3?revisionId=proposal_a3",
      { redirectCode: 301 },
    );
    expect(cacheControl.value).toBe("no-store");
  });

  it("stay a 302 where a node has no page of its own", () => {
    redirectToNodeUrl("/eksploruj/tabela?teryt=1862", { query: {}, hash: "" });

    expect(navigateTo).toHaveBeenCalledWith("/eksploruj/tabela?teryt=1862", {
      redirectCode: 302,
    });
  });
});
