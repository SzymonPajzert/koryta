import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { flushPromises } from "@vue/test-utils";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import HistoryList from "../../../app/components/revision/HistoryList.vue";
import type { Proposal } from "~~/shared/proposals";
import type { NodeRevisionHistory } from "~~/server/api/revisions/node.get";

/** An entry's history as rows on /admin/rewizje/[id] and inside an entry's
 * row on /admin/rewizje.
 *
 * Written for what the owner could not see before: who proposed a revision.
 * The table it replaces as the first thing on the page printed a bare uid in a
 * column header forty columns wide.
 */

const { mockAuthRequest, isAdmin } = vi.hoisted(() => ({
  mockAuthRequest: vi.fn(),
  isAdmin: { value: true as boolean | undefined },
}));

vi.mock("~/composables/auth", () => ({
  authRequest: mockAuthRequest,
  useAuthState: () => ({ isAdmin: ref(isAdmin.value), user: ref(null) }),
}));

const proposal = (over: Partial<Proposal> = {}): Proposal => ({
  id: "rev-new",
  targetId: "node-1",
  targetCollection: "nodes",
  targetName: "Anna Nowak",
  targetType: "person",
  targetPath: "/osoba/anna-nowak-node-1",
  targetExists: true,
  published: true,
  kind: "edit",
  deleteReason: null,
  changes: [
    { field: "content", label: "opis", from: "Stary opis.", to: "Nowy opis." },
    { field: "parties", label: "partie", from: null, to: "PSL" },
  ],
  changeCount: 2,
  updateTime: "2026-09-20T10:00:00.000Z",
  updateUser: "anna-uid",
  author: {
    displayName: "Anna Nowak",
    email: "anna@example.com",
    photoURL: null,
  },
  automatic: false,
  status: "pending",
  statusDerived: false,
  rejectReason: null,
  reviewTime: null,
  reviewUser: null,
  stale: false,
  ...over,
});

/** Newest first, as the endpoint answers: a proposal waiting, the version the
 * entry is serving (written by the pipeline), and an older human one a newer
 * approval overtook. */
const HISTORY: Proposal[] = [
  proposal(),
  proposal({
    id: "rev-live",
    updateTime: "2026-09-10T10:00:00.000Z",
    updateUser: "pipeline-uid",
    author: { displayName: "Szymon", email: null, photoURL: null },
    automatic: true,
    status: "approved",
    changes: [],
    changeCount: 0,
  }),
  proposal({
    id: "rev-old",
    updateTime: "2026-08-01T10:00:00.000Z",
    updateUser: "old-uid",
    author: null,
    status: "superseded",
    statusDerived: true,
    reviewUser: "admin-uid",
    reviewTime: "2026-08-02T10:00:00.000Z",
    stale: true,
  }),
];

let history: NodeRevisionHistory;

const serve = (revisions: Proposal[]) => {
  history = {
    revisions,
    approvedRevisionId: "rev-live",
    published: true,
    exists: true,
  };
};

const mountList = async (props: Record<string, unknown> = {}) => {
  const wrapper = await mountSuspended(HistoryList, {
    props: { nodeId: "node-1", ...props },
    global: { stubs: { UserChip: true } },
  });
  await flushPromises();
  return wrapper;
};

type Wrapper = Awaited<ReturnType<typeof mountList>>;

const rowIds = (wrapper: Wrapper) =>
  wrapper
    .findAll("[data-revision-row]")
    .map((row) => row.attributes("data-revision-row"));

const row = (wrapper: Wrapper, id: string) =>
  wrapper.get(`[data-revision-row="${id}"]`);

const isOpen = (wrapper: Wrapper, id: string) =>
  row(wrapper, id).find("[data-row-panel]").exists();

describe("RevisionHistoryList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isAdmin.value = true;
    serve(HISTORY);
    mockAuthRequest.mockImplementation(async (url: string) =>
      url === "/api/revisions/node" ? history : {},
    );
  });

  it("asks for this entry's history", async () => {
    await mountList();

    expect(mockAuthRequest).toHaveBeenCalledWith("/api/revisions/node", {
      method: "GET",
      query: { nodeId: "node-1" },
    });
  });

  it("names who filed each revision on the closed line", async () => {
    // Embedded, so nothing opens by itself and every line is closed.
    const wrapper = await mountList({ embedded: true });

    expect(wrapper.find("[data-row-panel]").exists()).toBe(false);
    expect(
      wrapper.findAll("[data-revision-author]").map((el) => el.text()),
    ).toEqual([
      "Anna Nowak",
      // The ingest writes as somebody's admin account, so its name would
      // claim a person made the change.
      "pipeline",
      // Nothing resolved: the uid, rather than nothing at all.
      "old-uid",
    ]);
    const first = row(wrapper, "rev-new").get("[data-row-toggle]").text();
    expect(first).toContain("20.09.2026 12:00");
    expect(first).toContain("Ręczna");
    expect(first).toContain("Opis, Partie");
    expect(row(wrapper, "rev-live").get("[data-row-toggle]").text()).toContain(
      "Obecna wersja wpisu",
    );
  });

  it("calls an approval a newer one overtook superseded, not pending", async () => {
    const wrapper = await mountList({ embedded: true });

    expect(
      row(wrapper, "rev-old")
        .get("[data-revision-status]")
        .attributes("aria-label"),
    ).toBe("Zastąpiona");
    expect(row(wrapper, "rev-old").classes()).toContain("arow--tone-neutral");
    expect(row(wrapper, "rev-new").classes()).toContain("arow--tone-warning");
  });

  it("opens the newest revision still waiting, with its diff and decisions", async () => {
    const wrapper = await mountList();

    expect(isOpen(wrapper, "rev-new")).toBe(true);
    expect(isOpen(wrapper, "rev-live")).toBe(false);
    const panel = row(wrapper, "rev-new").get("[data-row-panel]");
    expect(panel.find("[data-testid='revision-diff']").exists()).toBe(true);
    expect(panel.find("[data-testid='approve-rev-new']").exists()).toBe(true);
    expect(panel.find("[data-testid='reject-rev-new']").exists()).toBe(true);
    // On the comparison page the table is right below - no link to itself.
    expect(panel.text()).not.toContain("Porównanie");
    expect(
      panel.get("[data-testid='history-preview-rev-new']").attributes("href"),
    ).toBe("/entity/person/node-1?revisionId=rev-new");
  });

  it("opens the revision a link named instead, and marks it", async () => {
    const wrapper = await mountList({ highlightId: "rev-old" });

    expect(isOpen(wrapper, "rev-old")).toBe(true);
    expect(isOpen(wrapper, "rev-new")).toBe(false);
    expect(row(wrapper, "rev-old").classes()).toContain("arow--target");
    expect(row(wrapper, "rev-old").attributes("id")).toBe("rev-rev-old");
    const panel = row(wrapper, "rev-old").get("[data-row-panel]");
    expect(panel.text()).toContain("Zastąpiona (odczytany z wpisu)");
    expect(panel.text()).toContain("Rozpatrzono");
    expect(panel.text()).toContain(
      "Wpis zmienił się po zgłoszeniu — zatwierdzenie cofnie nowsze zmiany.",
    );
  });

  it("lets an old version be approved back, but not rejected again", async () => {
    const wrapper = await mountList({ highlightId: "rev-old" });
    const panel = row(wrapper, "rev-old").get("[data-row-panel]");

    expect(panel.find("[data-testid='approve-rev-old']").exists()).toBe(true);
    expect(panel.find("[data-testid='reject-rev-old']").exists()).toBe(false);

    await row(wrapper, "rev-live").get("[data-row-toggle]").trigger("click");
    const live = row(wrapper, "rev-live").get("[data-row-panel]");
    expect(live.find("[data-testid='approve-rev-live']").exists()).toBe(false);
  });

  it("shows the diff but no decisions to a reader who is not an admin", async () => {
    isAdmin.value = false;
    const wrapper = await mountList();

    const panel = row(wrapper, "rev-new").get("[data-row-panel]");
    expect(panel.find("[data-testid='revision-diff']").exists()).toBe(true);
    expect(panel.find("[data-testid='approve-rev-new']").exists()).toBe(false);
    expect(panel.find("[data-testid^='permalink-']").exists()).toBe(false);
  });

  it("shows every changed field, not the queue's first six", async () => {
    const changes = Array.from({ length: 8 }, (_, i) => ({
      field: `field${i}`,
      label: `pole ${i}`,
      from: null,
      to: `wartość ${i}`,
    }));
    serve([proposal({ changes, changeCount: 8 })]);

    const wrapper = await mountList();

    const panel = row(wrapper, "rev-new").get("[data-row-panel]");
    expect(panel.findAll(".revision-diff__row")).toHaveLength(8);
    expect(panel.text()).not.toContain("…i jeszcze");
  });

  it("filters to people's revisions and to the ones waiting", async () => {
    const wrapper = await mountList({ embedded: true });

    expect(wrapper.get("[data-testid='history-filter-all']").text()).toContain(
      "Wszystkie (3)",
    );
    expect(
      wrapper.get("[data-testid='history-filter-manual']").text(),
    ).toContain("Od ludzi (2)");
    // `Zastąpiona` is not waiting for anything.
    expect(
      wrapper.get("[data-testid='history-filter-pending']").text(),
    ).toContain("Oczekujące (1)");

    await wrapper.get("[data-testid='history-filter-manual']").trigger("click");
    expect(rowIds(wrapper)).toEqual(["rev-new", "rev-old"]);

    await wrapper
      .get("[data-testid='history-filter-pending']")
      .trigger("click");
    expect(rowIds(wrapper)).toEqual(["rev-new"]);
  });

  it("never filters out the revision a link named", async () => {
    const wrapper = await mountList({ highlightId: "rev-live" });

    await wrapper
      .get("[data-testid='history-filter-pending']")
      .trigger("click");

    expect(rowIds(wrapper)).toEqual(["rev-new", "rev-live"]);
  });

  it("follows a filter the page holds", async () => {
    // The comparison page binds its table's filter here, so both show the
    // same revisions.
    const wrapper = await mountList({ filter: "manual" });
    expect(rowIds(wrapper)).toEqual(["rev-new", "rev-old"]);

    await wrapper.get("[data-testid='history-filter-all']").trigger("click");
    expect(wrapper.emitted("update:filter")).toEqual([["all"]]);
  });

  it("stops after ten lines when embedded, and shows the rest on request", async () => {
    serve(
      Array.from({ length: 12 }, (_, i) =>
        proposal({
          id: `rev-${i}`,
          updateTime: new Date(Date.UTC(2026, 8, 20 - i)).toISOString(),
          status: "superseded",
        }),
      ),
    );

    const wrapper = await mountList({ embedded: true, highlightId: "rev-11" });

    // The ten newest, and the one a link named even though it is older.
    expect(rowIds(wrapper)).toHaveLength(11);
    expect(rowIds(wrapper).at(-1)).toBe("rev-11");
    expect(wrapper.find("[data-row-panel]").exists()).toBe(false);
    const showAll = wrapper.get("[data-testid='history-show-all']");
    expect(showAll.text()).toContain("Pokaż wszystkie (12)");
    expect(
      wrapper
        .findAllComponents({ name: "VBtn" })
        .find((btn) => btn.attributes("data-testid") === "history-full-page")
        ?.props("to"),
    ).toBe("/admin/rewizje/node-1");

    await showAll.trigger("click");

    expect(rowIds(wrapper)).toHaveLength(12);
    expect(wrapper.find("[data-testid='history-show-all']").exists()).toBe(
      false,
    );
  });

  it("offers the comparison page from an embedded row", async () => {
    const wrapper = await mountList({ embedded: true });
    await row(wrapper, "rev-new").get("[data-row-toggle]").trigger("click");

    const compare = row(wrapper, "rev-new")
      .findAllComponents({ name: "VBtn" })
      .find((btn) => btn.text().includes("Porównanie"));
    expect(compare?.props("to")).toBe(
      "/admin/rewizje/node-1?revisionId=rev-new",
    );
  });

  it("re-reads the history after an approval and tells the page", async () => {
    const wrapper = await mountList();

    await wrapper.get("[data-testid='approve-rev-new']").trigger("click");
    await flushPromises();

    expect(mockAuthRequest).toHaveBeenCalledWith("/api/revisions/approve", {
      body: { revision_id: "rev-new" },
    });
    expect(
      mockAuthRequest.mock.calls.filter(
        ([url]) => url === "/api/revisions/node",
      ),
    ).toHaveLength(2);
    expect(wrapper.emitted("changed")).toHaveLength(1);
  });

  it("says so when the history cannot be read", async () => {
    mockAuthRequest.mockRejectedValue(new Error("403"));

    const wrapper = await mountList();

    expect(wrapper.text()).toContain("Nie udało się wczytać historii zmian.");
    expect(wrapper.find("[data-revision-row]").exists()).toBe(false);
  });
});
