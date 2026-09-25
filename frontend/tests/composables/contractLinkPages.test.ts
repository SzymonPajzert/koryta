import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { mockNuxtImport } from "@nuxt/test-utils/runtime";
import {
  useContractLinkPages,
  usePageViewOnce,
} from "../../app/composables/contractLinks";
import type {
  ContractLinkItem,
  ContractLinkListResponse,
} from "../../shared/contractLinks";

const { authRequest, firstPage, router } = vi.hoisted(() => ({
  authRequest: vi.fn(),
  firstPage: { current: null as unknown },
  router: { current: null as Router | null },
}));

// The first page as `useFetch` would hand it over; „Pokaż kolejne" goes
// through `authRequest`, which each test answers.
vi.mock("~/composables/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/composables/auth")>()),
  authFetch: () => ({
    data: ref(firstPage.current),
    pending: ref(false),
    error: ref(undefined),
    refresh: vi.fn(),
  }),
  authRequest: (...args: unknown[]) => authRequest(...args),
}));

mockNuxtImport(
  "useRouter",
  (original: () => Router) => () => router.current ?? original(),
);

/** Just enough of a finding for the list to key and dedupe it. */
function item(id: string): ContractLinkItem {
  return { id } as ContractLinkItem;
}

function page(ids: string[], nextCursor: string | null) {
  return {
    items: ids.map(item),
    nextCursor,
    summary: null,
  } as unknown as ContractLinkListResponse;
}

beforeEach(() => {
  authRequest.mockReset();
  router.current = null;
});

describe("„Pokaż kolejne”", () => {
  it("says a failed page failed, and lets the same button try again", async () => {
    firstPage.current = page(["cru_1", "cru_2"], "2");
    const list = useContractLinkPages({ woj: "podlaskie" });
    authRequest.mockRejectedValueOnce(new Error("503"));

    // Resolves rather than throwing into the click handler, where the
    // rejection reached nobody and the list silently stayed as it was.
    await expect(list.loadMore()).resolves.toBeUndefined();
    expect(list.loadMoreError.value).toBe(true);
    expect(list.loadingMore.value).toBe(false);
    expect(list.nextCursor.value).toBe("2");

    authRequest.mockResolvedValueOnce(page(["cru_3"], null));
    await list.loadMore();
    expect(list.loadMoreError.value).toBe(false);
    expect(list.items.value.map((entry) => entry.id)).toEqual([
      "cru_1",
      "cru_2",
      "cru_3",
    ]);
    expect(list.nextCursor.value).toBeNull();
  });
});

describe("usePageViewOnce", () => {
  async function onRouter() {
    const component = { render: () => null };
    const testRouter = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/eksploruj/umowy", component },
        { path: "/eksploruj", component },
      ],
    });
    await testRouter.push("/eksploruj/umowy");
    router.current = testRouter;
    return testRouter;
  }

  it("claims a name once per page view", async () => {
    await onRouter();
    const once = usePageViewOnce();

    expect(once("hero")).toBe(true);
    expect(once("hero")).toBe(false);
    // Each ask is counted on its own.
    expect(once("teaser")).toBe(true);
  });

  it("keeps the claim across a mode switch, which is the same page view", async () => {
    const testRouter = await onRouter();
    // A remounted component asks again: the claim is not the instance's.
    expect(usePageViewOnce()("hero")).toBe(true);

    await testRouter.push("/eksploruj/umowy?tryb=umowy");
    await testRouter.push("/eksploruj/umowy");
    expect(usePageViewOnce()("hero")).toBe(false);
  });

  it("starts again on another path, as Plausible counts a new page view", async () => {
    const testRouter = await onRouter();
    const once = usePageViewOnce();
    expect(once("hero")).toBe(true);

    await testRouter.push("/eksploruj");
    await testRouter.push("/eksploruj/umowy");
    expect(once("hero")).toBe(true);
  });
});
