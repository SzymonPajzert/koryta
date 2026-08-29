import { describe, it, expect, vi } from "vitest";
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import KrawedziePage from "../../../app/pages/admin/rewizje-krawedzi.vue";
import type { PendingEdgeRevision } from "~~/server/api/revisions/pendingEdges.get";

/** What the endpoint hands out, set per test. */
let served: PendingEdgeRevision[] = [];

registerEndpoint("/api/revisions/pendingEdges", () => ({
  revisions: served,
  total: served.length,
}));

vi.mock("@plausible-analytics/tracker", () => ({
  init: vi.fn(),
  track: vi.fn(),
}));

const revision = (
  id: string,
  overrides: Partial<PendingEdgeRevision> = {},
): PendingEdgeRevision => ({
  id,
  edgeId: `edge-${id}`,
  edgeType: "election",
  updateTime: "2026-08-20T10:00:00.000Z",
  updateUser: "user-a",
  automatic: true,
  published: false,
  source: { id: "p-1", name: "Jan Testowy", type: "person" },
  target: { id: "r-1", name: "Powiat leszczyński", type: "region" },
  changes: [],
  ...overrides,
});

/** Mounts the page with the query the queue's button would have sent.
 *
 * The path is not the real one on purpose: `/admin/rewizje-krawedzi` carries
 * the `admin` middleware, which aborts a navigation made by a test with no
 * signed-in user and takes the query with it. Nothing on this page reads the
 * path - only `?rewizja=` - so a plain route with the same query exercises the
 * same code.
 *
 * The table asks for its first page from `update:options`, after mount, so
 * `mountSuspended` returns before any row exists; every test waits for what it
 * is about rather than for the request.
 */
const mount = async (query = "") => {
  const wrapper = await mountSuspended(KrawedziePage, {
    route: `/${query}`,
  });
  return wrapper;
};

const settled = async (wrapper: Awaited<ReturnType<typeof mount>>) =>
  await vi.waitUntil(
    () => {
      // A fetch that threw would otherwise show up as an opaque timeout, and
      // the page swallows the reason into an alert. Say it here instead.
      if (wrapper.text().includes("Nie udało się wczytać"))
        throw new Error("the page reported a failed fetch");
      // `tbody tr` is the wrong thing to wait for: Vuetify renders its
      // `no-data-text` as a row, so an empty table satisfies it immediately and
      // every assertion below then runs against a fetch still in flight.
      // `data-revision-row` comes from `row-props`, so only a real row has it.
      return (
        wrapper.findAll("[data-revision-row]").length > 0 ||
        wrapper.find('[data-testid="highlight-missing"]').exists()
      );
    },
    { timeout: 5000 },
  );

describe("the edge revision list", () => {
  it("marks the proposal the review queue linked to", async () => {
    served = [revision("rev-edge"), revision("rev-other")];
    const wrapper = await mount("?rewizja=rev-edge");
    await settled(wrapper);

    // The queue's one button promises "this proposal"; a list of rows with
    // nothing picked out would not have kept the promise.
    expect(wrapper.get('[data-revision-row="rev-edge"]').classes()).toContain(
      "highlighted-revision",
    );
    expect(
      wrapper.get('[data-revision-row="rev-other"]').classes(),
    ).not.toContain("highlighted-revision");
    expect(wrapper.find('[data-testid="highlight-missing"]').exists()).toBe(
      false,
    );
  });

  it("says so when the linked proposal is not on this list", async () => {
    // The list only holds pending revisions of the type the filter names, so a
    // proposal that has already been approved - which every deleted relation
    // leaves behind - can be linked here and legitimately not be here.
    served = [revision("rev-other")];
    const wrapper = await mount("?rewizja=rev-gone");
    await settled(wrapper);

    expect(wrapper.get('[data-testid="highlight-missing"]').text()).toContain(
      "nie ma na tej liście",
    );
    // The way back is the queue's pinned card, which answers for a proposal
    // whatever its status and still carries the approve/reject controls.
    expect(
      wrapper.findComponent('[data-testid="highlight-in-queue"]').props("to"),
    ).toBe("/admin/rewizje/kolejka?rewizja=rev-gone");
  });

  it("marks nothing when it was opened from the menu", async () => {
    served = [revision("rev-edge"), revision("rev-other")];
    const wrapper = await mount();
    await settled(wrapper);

    expect(wrapper.findAll(".highlighted-revision")).toHaveLength(0);
    expect(wrapper.find('[data-testid="highlight-missing"]').exists()).toBe(
      false,
    );
  });
});
