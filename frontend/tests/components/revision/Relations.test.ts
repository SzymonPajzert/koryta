import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { flushPromises } from "@vue/test-utils";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import Relations from "../../../app/components/revision/Relations.vue";
import type { Proposal } from "~~/shared/proposals";
import type {
  NodeRelationHistory,
  RelationHistory,
} from "~~/server/api/revisions/relations.get";

/** An entry's relations on /admin/rewizje/[id], each with its own revisions.
 *
 * Written for Hubert Papaj's page on 2026-10-17: two proposals and three draft
 * candidacies waited on it while the entry's own history said nothing did. */

const { mockAuthRequest, isAdmin } = vi.hoisted(() => ({
  mockAuthRequest: vi.fn(),
  isAdmin: { value: true as boolean | undefined },
}));

vi.mock("~/composables/auth", () => ({
  authRequest: mockAuthRequest,
  useAuthState: () => ({ isAdmin: ref(isAdmin.value), user: ref(null) }),
}));

const revision = (over: Partial<Proposal> = {}): Proposal => ({
  id: "rev-mayor",
  targetId: "bare-2018",
  targetCollection: "edges",
  targetName: "Anna Nowak → Jelenia Góra (kandydatura)",
  targetType: null,
  targetPath: "/osoba/anna-nowak-anna",
  targetExists: true,
  published: true,
  kind: "edit",
  deleteReason: null,
  changes: [
    { field: "position", label: "typ wyborów", from: null, to: "Prezydent" },
    {
      field: "committee",
      label: "komitet",
      from: null,
      to: "KWW Zadbajmy o Miasto",
    },
  ],
  changeCount: 2,
  updateTime: "2026-10-16T14:56:58.000Z",
  updateUser: "pipeline-people-import",
  author: null,
  automatic: true,
  status: "pending",
  statusDerived: false,
  rejectReason: null,
  reviewTime: null,
  reviewUser: null,
  stale: false,
  subject: {
    id: "anna",
    name: "Anna Nowak",
    type: "person",
    path: "/osoba/anna-nowak-anna",
    published: true,
  },
  ...over,
});

const relation = (over: Partial<RelationHistory> = {}): RelationHistory => ({
  id: "bare-2018",
  type: "election",
  name: "kandydatura",
  direction: "outgoing",
  other: {
    id: "teryt0261",
    name: "Jelenia Góra",
    type: "region",
    path: "/region/jelenia-gora-teryt0261",
    published: true,
  },
  startDate: "2018-01-01",
  endDate: null,
  position: null,
  committee: null,
  elected: false,
  published: true,
  deleted: false,
  state: "proposals",
  publishable: true,
  approvedRevisionId: "rev-created",
  waiting: 1,
  revisions: [
    revision(),
    revision({
      id: "rev-created",
      status: "approved",
      statusDerived: true,
      updateTime: "2026-03-26T01:45:46.000Z",
      changes: [],
      changeCount: 0,
    }),
  ],
  ...over,
});

const PAGE: NodeRelationHistory = {
  relations: [
    relation(),
    relation({
      id: "draft-2024",
      startDate: "2024-01-01",
      position: "Rada miasta",
      committee: "KWW Koalicja",
      elected: true,
      published: false,
      state: "draft",
      waiting: 0,
      approvedRevisionId: "rev-draft",
      revisions: [
        revision({
          id: "rev-draft",
          targetId: "draft-2024",
          published: false,
          status: "approved",
          changes: [],
          changeCount: 0,
        }),
      ],
    }),
    relation({
      id: "job",
      type: "employed",
      name: "Rada Nadzorcza",
      other: {
        id: "firma",
        name: "KARR",
        type: "place",
        path: "/instytucja/karr-firma",
        published: true,
      },
      startDate: "2007-08-10",
      endDate: "2015-10-12",
      state: "settled",
      waiting: 0,
      revisions: [],
    }),
  ],
  total: 3,
  drafts: 1,
  withProposals: 1,
  proposals: 1,
  nodePublished: true,
};

const mountSection = async (props: Record<string, unknown> = {}) => {
  const wrapper = await mountSuspended(Relations, {
    props: { nodeId: "anna", ...props },
    global: { stubs: { UserChip: true } },
  });
  await flushPromises();
  return wrapper;
};

type Wrapper = Awaited<ReturnType<typeof mountSection>>;

const rowIds = (wrapper: Wrapper) =>
  wrapper
    .findAll("[data-relation-row]")
    .map((row) => row.attributes("data-relation-row"));

const row = (wrapper: Wrapper, id: string) =>
  wrapper.get(`[data-relation-row="${id}"]`);

describe("RevisionRelations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isAdmin.value = true;
    mockAuthRequest.mockImplementation(async (url: string) =>
      url === "/api/revisions/relations" ? structuredClone(PAGE) : {},
    );
  });

  it("asks for this entry's relations and tells the page what waits", async () => {
    const wrapper = await mountSection();

    expect(mockAuthRequest).toHaveBeenCalledWith("/api/revisions/relations", {
      method: "GET",
      query: { nodeId: "anna" },
    });
    expect(wrapper.emitted("summary")?.[0]).toEqual([
      { total: 3, drafts: 1, withProposals: 1, proposals: 1 },
    ]);
  });

  it("lists what waits and leaves the settled ones behind the filter", async () => {
    const wrapper = await mountSection();

    expect(rowIds(wrapper)).toEqual(["bare-2018", "draft-2024"]);
    await wrapper.get("[data-testid='relation-filter-all']").trigger("click");
    expect(rowIds(wrapper)).toEqual(["bare-2018", "draft-2024", "job"]);
  });

  it("names a candidacy by its year, office and place", async () => {
    const wrapper = await mountSection();

    const bare = row(wrapper, "bare-2018").get("[data-row-toggle]").text();
    expect(bare).toContain("Kandydatura 2018");
    expect(bare).toContain("bez typu wyborów · Jelenia Góra");
    expect(bare).toContain("1 propozycja");
    const draft = row(wrapper, "draft-2024").get("[data-row-toggle]").text();
    expect(draft).toContain("Rada miasta · Jelenia Góra");
    expect(draft).toContain("szkic");
    expect(row(wrapper, "bare-2018").classes()).toContain("arow--tone-warning");
    expect(row(wrapper, "draft-2024").classes()).toContain("arow--tone-info");
  });

  it("opens the first relation that waits, with its history and decisions", async () => {
    const wrapper = await mountSection();

    const panel = row(wrapper, "bare-2018").get("[data-row-panel]");
    expect(
      panel
        .findAll("[data-relation-revision]")
        .map((el) => el.attributes("data-relation-revision")),
    ).toEqual(["rev-mayor", "rev-created"]);
    expect(panel.text()).toContain("Obecna wersja");
    expect(panel.find("[data-testid='approve-rev-mayor']").exists()).toBe(true);
    expect(panel.find("[data-testid='reject-rev-mayor']").exists()).toBe(true);
    expect(panel.find("[data-testid='approve-rev-created']").exists()).toBe(
      false,
    );
    expect(row(wrapper, "draft-2024").find("[data-row-panel]").exists()).toBe(
      false,
    );
  });

  it("approves a change and reads the relations again", async () => {
    const wrapper = await mountSection();

    await wrapper.get("[data-testid='approve-rev-mayor']").trigger("click");
    await flushPromises();

    expect(mockAuthRequest).toHaveBeenCalledWith("/api/revisions/approve", {
      body: { revision_id: "rev-mayor" },
    });
    expect(
      mockAuthRequest.mock.calls.filter(
        ([url]) => url === "/api/revisions/relations",
      ),
    ).toHaveLength(2);
  });

  it("publishes a draft as it stands", async () => {
    const wrapper = await mountSection();
    await row(wrapper, "draft-2024").get("[data-row-toggle]").trigger("click");

    await wrapper
      .get("[data-testid='relation-publish-draft-2024']")
      .trigger("click");
    await flushPromises();

    expect(mockAuthRequest).toHaveBeenCalledWith("/api/edges/publish", {
      body: { edge_ids: ["draft-2024"], published: true },
    });
  });

  it("says why a draft cannot be published while the page is a draft", async () => {
    mockAuthRequest.mockImplementation(async () => ({
      ...structuredClone(PAGE),
      nodePublished: false,
      relations: PAGE.relations.map((r) => ({ ...r, publishable: false })),
    }));
    const wrapper = await mountSection();
    await row(wrapper, "draft-2024").get("[data-row-toggle]").trigger("click");

    const button = wrapper.get("[data-testid='relation-publish-draft-2024']");
    expect(button.attributes("disabled")).toBeDefined();
    expect(row(wrapper, "draft-2024").text()).toContain(
      "Najpierw opublikuj tę stronę",
    );
  });

  it("warns when a draft candidacy would put the person in two places", async () => {
    mockAuthRequest.mockImplementation(async () => ({
      ...structuredClone(PAGE),
      relations: [
        relation({
          id: "live-2010",
          startDate: "2010-01-01",
          position: "Rada miasta",
          state: "settled",
          waiting: 0,
        }),
        relation({
          id: "draft-elsewhere",
          other: {
            id: "teryt1465",
            name: "Miasto Warszawa",
            type: "region",
            path: null,
            published: true,
          },
          startDate: "2010-01-01",
          position: "Rada miasta",
          published: false,
          state: "draft",
          waiting: 0,
        }),
      ],
    }));
    const wrapper = await mountSection();

    const draft = row(wrapper, "draft-elsewhere");
    expect(draft.get("[data-row-toggle]").text()).toContain("dwa miejsca");
    expect(draft.text()).toContain(
      "w dwóch miejscach w wyborach 2010 · Rada miasta: Jelenia Góra i Miasto Warszawa",
    );
  });

  it("says so when the entry has no relations", async () => {
    mockAuthRequest.mockImplementation(async () => ({
      ...structuredClone(PAGE),
      relations: [],
      total: 0,
      drafts: 0,
      withProposals: 0,
      proposals: 0,
    }));
    const wrapper = await mountSection();

    expect(wrapper.text()).toContain("Ta strona nie ma powiązań.");
  });
});
