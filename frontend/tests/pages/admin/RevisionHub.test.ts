import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { useRouter } from "#app";
import RewizjePage from "../../../app/pages/admin/rewizje/index.vue";
import type { Proposal } from "~~/shared/proposals";
import type { RevisionQueue } from "~~/server/api/revisions/queue.get";
import type { PendingEdgeRevision } from "~~/server/api/revisions/pendingEdges.get";
import type { RevisedNode } from "~/components/revision/NodeRow.vue";

const { mockAuthRequest, auth } = vi.hoisted(() => ({
  mockAuthRequest: vi.fn(),
  auth: { isAdmin: true as boolean | undefined },
}));

// Refs in shape only: each test sets `auth.isAdmin` before it mounts, and the
// page reads `.value` rather than watching it change.
vi.mock("~/composables/auth", () => ({
  authRequest: mockAuthRequest,
  useAuthState: () => ({
    user: { value: null },
    isAdmin: { value: auth.isAdmin },
  }),
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
  kind: "edit",
  deleteReason: null,
  changes: [
    { field: "content", label: "opis", from: "stary", to: "nowy" },
    { field: "parties", label: "partie", from: null, to: "PSL" },
  ],
  changeCount: 2,
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

const edgeRevision = (
  overrides: Partial<PendingEdgeRevision> = {},
): PendingEdgeRevision => ({
  id: "edge-rev-1",
  edgeId: "edge-1",
  edgeType: "election",
  updateTime: "2026-08-21T10:00:00.000Z",
  updateUser: "pipeline-uid",
  automatic: true,
  published: false,
  source: { id: "p1", name: "Anna Nowak", type: "person" },
  target: { id: "r1", name: "Rada Miasta", type: "place" },
  changes: [{ field: "committee", from: null, to: "KW PSL" }],
  ...overrides,
});

const revisedNode = (overrides: Partial<RevisedNode> = {}): RevisedNode => ({
  id: "n1",
  name: "Piotr Wpisowy",
  type: "person",
  visibility: true,
  revisions: {
    total: 2,
    latest_time: "2026-08-22T10:00:00.000Z",
    has_unapproved: true,
  },
  ...overrides,
});

type Served = {
  queue?: Partial<RevisionQueue>;
  edges?: PendingEdgeRevision[];
  nodes?: RevisedNode[];
};

const serve = ({ queue = {}, edges = [], nodes = [] }: Served = {}) => {
  mockAuthRequest.mockImplementation(async (url: string) => {
    switch (url) {
      case "/api/revisions/queue":
        return {
          revisions: [],
          total: queue.revisions?.length ?? 0,
          flagOnly: false,
          truncated: false,
          pinned: null,
          ...queue,
        };
      case "/api/revisions/pendingEdges":
        return { revisions: edges, total: edges.length };
      case "/api/nodes/revisions":
        return {
          nodes: Object.fromEntries(nodes.map((node) => [node.id, node])),
          total: nodes.length,
        };
      default:
        return {};
    }
  });
};

/** Every call to one endpoint, as `[url, options]`. */
const callsTo = (url: string) =>
  mockAuthRequest.mock.calls.filter(([called]) => called === url);

const mounted: { unmount: () => void }[] = [];

/** The page opened at `route` - on "/", whose page has no middleware, since
 * the router runs the real `auth` one for /admin/rewizje. What this page reads
 * is the query and the hash, which are the same either way. */
const mount = async (route = "/") => {
  const wrapper = await mountSuspended(RewizjePage, {
    route,
    // In the document, so the page can find the section or row it scrolls to
    // by id.
    attachTo: document.body,
    global: {
      stubs: {
        UserChip: true,
        VSnackbar: true,
        RevisionHistoryList: true,
      },
    },
  });
  mounted.push(wrapper);
  await flushPromises();
  return wrapper;
};

/** The ids of the elements the page scrolled into view, in order. */
const scrolled: string[] = [];

beforeEach(async () => {
  mockAuthRequest.mockReset();
  auth.isAdmin = true;
  scrolled.length = 0;
  vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (
    this: Element,
  ) {
    scrolled.push(this.id);
  });
  await useRouter().replace("/");
});

afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.restoreAllMocks();
});

describe("/admin/rewizje, for a reader who is not an admin", () => {
  it("shows only the entries, and asks nothing of the admin endpoints", async () => {
    auth.isAdmin = false;
    serve({ nodes: [revisedNode()] });
    const wrapper = await mount();

    expect(wrapper.find("#kolejka").exists()).toBe(false);
    expect(wrapper.find("#powiazania").exists()).toBe(false);
    expect(wrapper.find("#wpisy [data-node-row]").exists()).toBe(true);
    expect(callsTo("/api/revisions/queue")).toHaveLength(0);
    expect(callsTo("/api/revisions/pendingEdges")).toHaveLength(0);
  });
});

describe("the review queue section", () => {
  it("draws a proposal as one closed line, the decisions inside it", async () => {
    serve({ queue: { revisions: [proposal()] } });
    const wrapper = await mount();

    const row = wrapper.get('#kolejka [data-proposal-id="rev-1"]');
    const line = row.get("[data-row-toggle]").text();
    expect(line).toContain("Jan Testowy");
    expect(line).toContain("Opis, partie");
    expect(line).toContain("Autor Testowy");
    expect(row.find("[data-row-panel]").exists()).toBe(false);
    expect(wrapper.find('[data-testid="approve-rev-1"]').exists()).toBe(false);

    await row.get("[data-row-toggle]").trigger("click");

    expect(wrapper.find('[data-testid="approve-rev-1"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="reject-rev-1"]').exists()).toBe(true);
    // The href the anchor ends up with is the test router's business; what
    // this page decides is the target it hands the button.
    const compare = wrapper
      .findAllComponents({ name: "VBtn" })
      .find((button) => button.text().includes("Porównanie"));
    expect(compare?.props("to")).toBe("/admin/rewizje/node-1?revisionId=rev-1");
  });

  it("names what kind of change a line is when it is not an edit", async () => {
    serve({
      queue: {
        revisions: [
          proposal({ id: "rev-new", kind: "create" }),
          proposal({
            id: "rev-gone",
            kind: "removal",
            changes: [],
            changeCount: 0,
            deleteReason: "duplikat",
          }),
          proposal({
            id: "rev-edge",
            targetCollection: "edges",
            targetPath: null,
            automatic: true,
          }),
        ],
      },
    });
    const wrapper = await mount();
    const line = (id: string) =>
      wrapper.get(`[data-proposal-id="${id}"] [data-row-toggle]`).text();

    expect(line("rev-new")).toContain("Nowy wpis");
    expect(line("rev-gone")).toContain("Usunięcie");
    expect(line("rev-gone")).toContain("duplikat");
    expect(line("rev-edge")).toContain("Powiązanie");
    expect(line("rev-edge")).toContain("pipeline");
  });

  it("asks for the queue under the url's own names", async () => {
    serve();
    await mount("/?status=all&automatic=all&author=user-a&page=2");

    expect(callsTo("/api/revisions/queue")[0]![1]).toEqual({
      method: "GET",
      query: {
        page: 2,
        limit: 25,
        status: "all",
        automatic: "all",
        author: "user-a",
        revision: undefined,
      },
    });
  });

  it("reads a status it does not know as the default, not as a query", async () => {
    // `status=unapproved` is what the entry list on this url used to write.
    serve();
    await mount("/?status=unapproved");

    expect(callsTo("/api/revisions/queue")[0]![1].query.status).toBe("pending");
  });

  it("pins a permalinked proposal on top, open and marked", async () => {
    serve({
      queue: {
        revisions: [proposal()],
        pinned: proposal({ id: "rev-9", status: "approved" }),
      },
    });
    const wrapper = await mount("/?rewizja=rev-9#kolejka");

    expect(callsTo("/api/revisions/queue")[0]![1].query.revision).toBe("rev-9");
    const pinned = wrapper.get("[data-pinned]");
    expect(pinned.text()).toContain("Propozycja z linku");
    expect(pinned.text()).toContain("Ta propozycja została już rozpatrzona.");
    const row = pinned.get('[data-proposal-id="rev-9"]');
    expect(row.classes()).toContain("arow--target");
    expect(row.find("[data-row-panel]").exists()).toBe(true);
  });

  it("moves a permalinked proposal up rather than showing it twice", async () => {
    serve({
      queue: { revisions: [proposal(), proposal({ id: "rev-2" })] },
    });
    const wrapper = await mount("/?rewizja=rev-2");

    expect(
      wrapper.findAll('[data-proposal-id="rev-2"]').map((row) => row.element),
    ).toHaveLength(1);
    expect(
      wrapper.find('[data-pinned] [data-proposal-id="rev-2"]').exists(),
    ).toBe(true);
    expect(
      wrapper.findAll("[data-queue-list] [data-proposal-row]"),
    ).toHaveLength(1);
  });

  it("takes an approved proposal off the list without reading it again", async () => {
    serve({ queue: { revisions: [proposal(), proposal({ id: "rev-2" })] } });
    const wrapper = await mount();

    await wrapper
      .get('[data-proposal-id="rev-1"] [data-row-toggle]')
      .trigger("click");
    await wrapper.get('[data-testid="approve-rev-1"]').trigger("click");
    await flushPromises();

    expect(callsTo("/api/revisions/approve")[0]![1]).toEqual({
      body: { revision_id: "rev-1" },
    });
    expect(wrapper.find('[data-proposal-id="rev-1"]').exists()).toBe(false);
    expect(wrapper.find('[data-proposal-id="rev-2"]').exists()).toBe(true);
    expect(callsTo("/api/revisions/queue")).toHaveLength(1);
  });

  it("narrows to one author from an open row, with both filters off", async () => {
    serve({ queue: { revisions: [proposal()] } });
    const wrapper = await mount();

    await wrapper.get("[data-row-toggle]").trigger("click");
    await wrapper.get("[data-focus-author]").trigger("click");

    // The navigation settles a few ticks later than the click.
    const router = useRouter();
    await vi.waitFor(() =>
      expect(router.currentRoute.value.query).toMatchObject({
        author: "user-a",
        status: "all",
        automatic: "all",
      }),
    );
    const route = router.currentRoute.value;
    // Named in the hash, so the page lands on the section it just changed.
    expect(route.hash).toBe("#kolejka");
  });

  it("celebrates an empty default queue instead of an empty list", async () => {
    serve();
    const wrapper = await mount();

    expect(wrapper.get("#kolejka").text()).toContain(
      "Kolejka jest pusta — nic nie czeka na rozpatrzenie.",
    );
  });
});

describe("the edge revisions section", () => {
  it("says what a pending relation change is and sends it to the queue", async () => {
    serve({ edges: [edgeRevision()] });
    const wrapper = await mount("/?edgePage=1&nodeType=person");

    const row = wrapper.get('#powiazania [data-revision-id="edge-rev-1"]');
    const line = row.get("[data-row-toggle]").text();
    expect(line).toContain("Anna Nowak → Rada Miasta");
    expect(line).toContain("Kandydatura");
    expect(line).toContain("1 zmiana");

    await row.get("[data-row-toggle]").trigger("click");

    // What the relation is now, not whether this proposal was approved.
    expect(row.text()).toContain("nieopublikowane");
    expect(row.text()).toContain("komitet");
    expect(row.text()).toContain("KW PSL");
    const review = wrapper.getComponent(
      '[data-testid="edge-review-edge-rev-1"]',
    );
    // The other sections' filters stay as they were.
    expect(review.props("to")).toEqual({
      query: { edgePage: "1", nodeType: "person", rewizja: "edge-rev-1" },
      hash: "#kolejka",
    });
  });

  it("names a person who proposed a change on its line, not their uid", async () => {
    serve({
      edges: [
        edgeRevision({
          id: "edge-rev-2",
          updateUser: "user-b",
          automatic: false,
        }),
      ],
    });
    const served = mockAuthRequest.getMockImplementation()!;
    mockAuthRequest.mockImplementation(
      async (url: string, options?: unknown) =>
        url.startsWith("/api/users/lookup")
          ? {
              users: {
                "user-b": {
                  displayName: "Beata Autorka",
                  email: null,
                  photoURL: null,
                },
              },
            }
          : served(url, options),
    );
    const wrapper = await mount();
    const line = () =>
      wrapper.get('[data-revision-id="edge-rev-2"] [data-row-toggle]').text();

    await vi.waitFor(() => expect(line()).toContain("Beata Autorka"));
    expect(line()).not.toContain("user-b");
  });

  it("filters by the url's edge type", async () => {
    serve();
    await mount("/?edgeType=election&edgePage=3");

    expect(callsTo("/api/revisions/pendingEdges")[0]![1]).toEqual({
      method: "GET",
      query: { page: 3, limit: 25, type: "election" },
    });
  });
});

describe("the entries section", () => {
  it("draws an entry as a line, its history inside", async () => {
    serve({ nodes: [revisedNode()] });
    const wrapper = await mount();

    const row = wrapper.get('#wpisy [data-node-id="n1"]');
    const line = row.get("[data-row-toggle]").text();
    expect(line).toContain("Piotr Wpisowy");
    expect(line).toContain("Osoba");
    expect(line).toContain("2 rewizje");
    expect(row.find("[data-waiting]").exists()).toBe(true);
    expect(row.getComponent("[data-compare-link]").props("to")).toBe(
      "/admin/rewizje/n1",
    );

    await row.get("[data-row-toggle]").trigger("click");

    // The history itself is another component's; this page hands it the id.
    const history = row
      .get("[data-row-panel]")
      .getComponent({ name: "RevisionHistoryList" });
    expect(history.props("nodeId")).toBe("n1");
    expect(history.props("embedded")).toBe(true);
  });

  it("asks for the entries sorted by the latest change by default", async () => {
    serve();
    await mount();

    expect(callsTo("/api/nodes/revisions")[0]![1]).toEqual({
      method: "GET",
      query: {
        page: 1,
        limit: 10,
        sortBy: "revisions.latest_time",
        sortDesc: "true",
        status: undefined,
        type: undefined,
      },
    });
  });

  it("keeps its own filters and paging apart from the queue's", async () => {
    serve();
    await mount(
      "/?nodeStatus=unapproved&nodeType=place&nodePage=2&nodePerPage=25&sortBy=revisions.total&sortDesc=false&page=4",
    );

    expect(callsTo("/api/nodes/revisions")[0]![1].query).toEqual({
      page: 2,
      limit: 25,
      sortBy: "revisions.total",
      sortDesc: "false",
      status: "unapproved",
      type: "place",
    });
    expect(callsTo("/api/revisions/queue")[0]![1].query.page).toBe(4);
  });

  it("holds a page size to the ones it offers", async () => {
    // The endpoint takes any limit at all, and reads every document up to it.
    serve();
    await mount("/?nodePerPage=100000");

    expect(callsTo("/api/nodes/revisions")[0]![1].query.limit).toBe(10);
  });

  it("does not read the queue again when only the entries move on", async () => {
    serve({ nodes: [revisedNode()] });
    await mount();

    await useRouter().push({ query: { nodePage: "2" }, hash: "#wpisy" });
    await flushPromises();

    expect(callsTo("/api/nodes/revisions")).toHaveLength(2);
    expect(callsTo("/api/revisions/queue")).toHaveLength(1);
    expect(callsTo("/api/revisions/pendingEdges")).toHaveLength(1);
  });
});

describe("arriving at an anchor", () => {
  it("scrolls to the section the hash names once the rows are in", async () => {
    serve({ nodes: [revisedNode()] });
    await mount("/#wpisy");

    // Once, after all three sections have loaded: scrolled earlier, the
    // queue and the edge list would have filled in above it and pushed it
    // down again.
    expect(scrolled).toEqual(["wpisy"]);
  });

  it("scrolls to the proposal a permalink names", async () => {
    serve({ queue: { pinned: proposal({ id: "rev-9" }) } });
    await mount("/?rewizja=rev-9#kolejka");

    expect(scrolled).toEqual(["rewizja-rev-9"]);
  });

  it("stays where it is without a hash", async () => {
    serve({ nodes: [revisedNode()] });
    await mount();

    expect(scrolled).toEqual([]);
  });
});

describe("the old addresses", () => {
  const redirectOf = (path: string) => {
    const record = useRouter()
      .getRoutes()
      .find((route) => route.path === path);
    return record?.redirect as (to: {
      query: Record<string, string>;
    }) => unknown;
  };

  it("sends the queue, query and all, to its section", () => {
    expect(
      redirectOf("/admin/rewizje/kolejka")({
        query: { rewizja: "rev-1", status: "all" },
      }),
    ).toEqual({
      path: "/admin/rewizje",
      query: { rewizja: "rev-1", status: "all" },
      hash: "#kolejka",
    });
  });

  it("renames the edge list's parameters on the way", () => {
    expect(
      redirectOf("/admin/rewizje-krawedzi")({
        query: { type: "election", page: "2", itemsPerPage: "50" },
      }),
    ).toEqual({
      path: "/admin/rewizje",
      query: { edgeType: "election", edgePage: "2" },
      hash: "#powiazania",
    });
  });
});
