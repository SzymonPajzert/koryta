import { describe, it, expect, vi } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import KolejkaPage from "../../../app/pages/admin/rewizje/kolejka.vue";
import type { Proposal } from "~~/shared/proposals";

const { mockAuthRequest } = vi.hoisted(() => ({ mockAuthRequest: vi.fn() }));

vi.mock("~/composables/auth", () => ({
  authRequest: mockAuthRequest,
  useAuthState: () => ({ user: { value: null }, isAdmin: { value: true } }),
}));

vi.mock("@plausible-analytics/tracker", () => ({
  init: vi.fn(),
  track: vi.fn(),
}));

const proposal = (overrides: Partial<Proposal> = {}): Proposal => ({
  id: "rev-1",
  targetId: "node-1",
  targetCollection: "nodes",
  targetName: "Jan Testowy",
  targetType: "person",
  targetPath: "/osoba/jan-testowy-node-1",
  targetExists: true,
  published: true,
  kind: "update",
  deleteReason: null,
  changes: [],
  changeCount: 0,
  updateTime: "2026-08-20T10:00:00.000Z",
  updateUser: "user-a",
  author: { displayName: "Autor Testowy", email: null, photoURL: null },
  automatic: false,
  status: "pending",
  statusDerived: false,
  rejectReason: null,
  reviewTime: null,
  stale: false,
  ...overrides,
});

const serve = (revisions: Proposal[]) => {
  mockAuthRequest.mockImplementation(async () => ({
    revisions,
    total: revisions.length,
    flagOnly: false,
    truncated: false,
    pinned: null,
  }));
};

const mount = () =>
  mountSuspended(KolejkaPage, {
    global: { stubs: { UserChip: true, VSnackbar: true } },
  });

describe("the review queue's rows", () => {
  it("offers one button, to this revision in the comparison view", async () => {
    serve([proposal()]);
    const wrapper = await mount();

    const row = wrapper.get("tbody tr");
    // One decision per row: everything that used to crowd the last column -
    // approve, approve-and-publish, reject, compare, copy link - now lives on
    // the screen the button opens.
    expect(row.findAll(".v-btn")).toHaveLength(1);

    // The href the anchor ends up with is the test router's business; what
    // this page decides is the target it hands the button.
    const button = wrapper.findComponent('[data-testid="review-rev-1"]');
    expect(button.text()).toContain("Rozpatrz");
    expect(button.props("to")).toBe("/admin/rewizje/node-1?revisionId=rev-1");
  });

  it("sends an edge revision to the page that can review it, naming it", async () => {
    serve([
      proposal({
        id: "rev-edge",
        targetCollection: "edges",
        targetPath: null,
      }),
    ]);
    const wrapper = await mount();

    const button = wrapper.findComponent('[data-testid="review-rev-edge"]');
    // Same word as every other row - which of the two screens it opens is the
    // tooltip's job, not the label's.
    expect(button.text()).toContain("Rozpatrz");
    expect(button.attributes("title")).toContain("rewizji powiązań");
    // With the id, so the list can mark the one row this is about.
    expect(button.props("to")).toBe("/admin/rewizje-krawedzi?rewizja=rev-edge");
  });

  it("names the columns a reviewer reads, author and date as one", async () => {
    serve([proposal()]);
    const wrapper = await mount();

    const headers = wrapper.findAll("thead th").map((th) => th.text());
    expect(headers).toEqual([
      "Zgłoszenie",
      "Czego dotyczy",
      "Proponowana zmiana",
      "",
    ]);
  });

  it("keeps the same label once a proposal has been decided", async () => {
    serve([proposal({ id: "rev-done", status: "approved" })]);
    const wrapper = await mount();

    // Whether it is still open is the status chip's job in the first column;
    // the button used to say "Zobacz" here and so said it twice.
    const button = wrapper.findComponent('[data-testid="review-rev-done"]');
    expect(button.text()).toContain("Rozpatrz");
    expect(button.text()).not.toContain("Zobacz");
  });

  it("offers the same button on every row, whatever the row is", async () => {
    // The report this asserts against: "nie rozumiem dlaczego mamy dwa typy
    // przyciskow po prawej stronie w tamtej kolumnie". These three rows are
    // the three shapes the column used to take - a proposal waiting, a
    // relation, and something already decided - and they appear together in
    // the queue whenever a reader proposes a relation, or the filters are
    // widened by the link out of "Najaktywniejsi".
    serve([
      proposal({ id: "rev-node" }),
      proposal({ id: "rev-edge", targetCollection: "edges", targetPath: null }),
      proposal({ id: "rev-old", status: "approved" }),
    ]);
    const wrapper = await mount();

    const labels = wrapper
      .findAll("tbody tr .v-btn")
      .map((button) => button.text().trim());
    expect(labels).toHaveLength(3);
    expect(new Set(labels).size).toBe(1);
  });
});
