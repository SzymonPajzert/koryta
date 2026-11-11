import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockNuxtImport } from "@nuxt/test-utils/runtime";
import { ref, toValue } from "vue";
import { useCurrentUser } from "vuefire";
import { useRegionElectionRuns } from "~/composables/electionLists";

const fetched = vi.hoisted(() => ({
  calls: [] as { url: string; options: { query: unknown; key: string } }[],
}));

vi.mock("~/composables/auth", () => ({
  authFetch: vi.fn((url: string, options: { query: unknown; key: string }) => {
    fetched.calls.push({ url, options });
    return {};
  }),
}));

// A page url that asks for the latest answer and points at a list, which the
// request must follow neither of.
mockNuxtImport("useRoute", () => () => ({
  path: "/region/powiat-x-teryt1005",
  query: { latest: "1" },
  hash: "#lista-local-2024--kww-nasz-powiat",
}));

beforeEach(() => {
  fetched.calls = [];
});

describe("useRegionElectionRuns", () => {
  it("asks a logged out reader's lists from the cache, whatever the page url says", () => {
    useRegionElectionRuns("teryt1005");
    const [call] = fetched.calls;
    expect(call!.url).toBe("/api/nodes/teryt1005/election-lists");
    expect(toValue(call!.options.query)).toEqual({});
  });

  it("asks for the latest answer for a signed in reader", () => {
    vi.mocked(useCurrentUser).mockReturnValueOnce(
      ref({ uid: "u1" }) as unknown as ReturnType<typeof useCurrentUser>,
    );
    useRegionElectionRuns("teryt1005");
    expect(toValue(fetched.calls[0]!.options.query)).toEqual({ latest: true });
  });
});
