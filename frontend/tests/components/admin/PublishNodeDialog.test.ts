import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { defineComponent, h } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import PublishNodeDialog from "../../../app/components/admin/PublishNodeDialog.vue";
import type { NodeRelation } from "~~/server/api/edges/byNode.get";

const { mockAuthRequest } = vi.hoisted(() => ({ mockAuthRequest: vi.fn() }));

vi.mock("~/composables/auth", () => ({
  authRequest: mockAuthRequest,
  useAuthState: () => ({ user: { value: null } }),
}));

const vuetify = createVuetify({ components, directives });

/** Nuxt's auto-imported components are not registered outside a Nuxt env, and
 * an unresolved one renders nothing an assertion can reach. Same stub the other
 * component specs use - see tests/components/revision/TargetCell.test.ts. */
const NuxtLinkStub = defineComponent({
  props: { to: { type: [String, Object], default: "" } },
  setup(props, { slots }) {
    return () => h("a", { href: String(props.to) }, slots.default?.());
  },
});

// Vuetify's overlay measures the viewport as it opens, and jsdom has neither of
// these. Without them the dialog throws before it ever renders a row.
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
global.visualViewport = {
  width: 1024,
  height: 768,
  offsetLeft: 0,
  offsetTop: 0,
  pageLeft: 0,
  pageTop: 0,
  scale: 1,
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
} as unknown as VisualViewport;

const relation = (overrides: Partial<NodeRelation> = {}): NodeRelation => ({
  id: "edge-1",
  type: "employed",
  name: null,
  direction: "outgoing",
  otherId: "firma",
  otherName: "Firma sp. z o.o.",
  otherPublished: true,
  published: false,
  startDate: null,
  position: null,
  revisionToApprove: null,
  hasPendingRevision: false,
  publishable: true,
  ...overrides,
});

/** One of the page's candidacies, in the region whose TERYT code is given -
 * Jacek Wojciech Kowalski's, unless told otherwise: a career in powiat
 * gnieźnieński (3003), and one 2002 run in powiat kozienicki (1407) that went
 * live with his page on 2026-10-14. */
const candidacy = (
  id: string,
  teryt: string,
  year: string,
  overrides: Partial<NodeRelation> = {},
): NodeRelation =>
  relation({
    id,
    type: "election",
    name: "kandydatura",
    otherId: `teryt${teryt}`,
    otherName:
      { "3003": "Powiat gnieźnieński", "1407": "Powiat kozienicki" }[teryt] ??
      `Region ${teryt}`,
    startDate: `${year}-01-01`,
    position: "Samorząd",
    ...overrides,
  });

/** His page as the dialog met it on 2026-10-14, plus his one board seat. */
const kowalski = () => [
  candidacy("gniezno-2002", "3003", "2002"),
  candidacy("kozienice-2002", "1407", "2002"),
  candidacy("gniezno-2006", "3003", "2006"),
  candidacy("gniezno-2010", "3003", "2010"),
  relation({ id: "zol", name: "Rada Nadzorcza", otherName: "ZOL Gniezno" }),
];

/** What the node's revisions endpoint answers while a test says nothing about
 * it: a page with a version already approved, which is the case where the
 * dialog has nothing extra to say. */
let revisionsResponse: {
  revisions: Record<string, unknown>[];
  approvedRevisionId: string | null;
} = { revisions: [], approvedRevisionId: "rev-approved" };

/** The two GETs the dialog makes on open answer with the list and the
 * revisions; every POST it makes afterwards succeeds. */
function serveRelations(relations: NodeRelation[]) {
  mockAuthRequest.mockImplementation(
    async (url: string, opts: { method?: string } = {}) => {
      if (url === "/api/revisions/byNode") return revisionsResponse;
      return opts.method === "GET"
        ? { relations, nodePublished: false }
        : { ok: true, url };
    },
  );
}

function mountDialog() {
  return mount(PublishNodeDialog, {
    // The dialog content is teleported out of the component's own subtree, so
    // it only lands somewhere queryable if the component itself is in the
    // document.
    attachTo: document.body,
    props: {
      modelValue: false,
      nodeId: "jan-kowalski",
      nodeName: "Jan Kowalski",
    },
    global: { plugins: [vuetify], stubs: { NuxtLink: NuxtLinkStub } },
  });
}

/** The dialog loads on the false -> true transition, which is how the page
 * drives it, so every test opens it the same way rather than mounting it open. */
async function open(wrapper: ReturnType<typeof mountDialog>) {
  await wrapper.setProps({ modelValue: true });
  await flushPromises();
}

const el = (testid: string) =>
  document.body.querySelector(`[data-testid="${testid}"]`);

const checkbox = (id: string) =>
  document.body.querySelector<HTMLInputElement>(
    `[data-testid="publish-relation-check-${id}"] input`,
  );

/** A native click is what Vuetify's own handlers listen for, and it works on
 * teleported nodes that `wrapper.find` cannot reach. */
async function click(target: Element | null) {
  expect(target).not.toBeNull();
  (target as HTMLElement).click();
  await flushPromises();
}

const confirmButton = () => el("publish-confirm") as HTMLElement;

/** The calls that do something, in order. The revisions probe is left out: it
 * only decides whether the dialog can name the version about to go live, and
 * every assertion below is about what the confirm button sets in motion. */
const requestedUrls = () =>
  mockAuthRequest.mock.calls
    .map(([url]) => url as string)
    .filter((url) => url !== "/api/revisions/byNode");

let wrapper: ReturnType<typeof mountDialog> | undefined;

describe("PublishNodeDialog.vue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    revisionsResponse = { revisions: [], approvedRevisionId: "rev-approved" };
    serveRelations([]);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    document.body.innerHTML = "";
  });

  it("asks for the node's relations when it opens and offers only the unpublished ones", async () => {
    serveRelations([
      relation({ id: "waiting", otherName: "Firma sp. z o.o." }),
      relation({ id: "live", published: true, otherName: "Druga Firma" }),
    ]);
    wrapper = mountDialog();

    // Nothing is fetched while the dialog is closed - the page keeps it mounted
    // the whole time it is on screen.
    expect(mockAuthRequest).not.toHaveBeenCalled();

    await open(wrapper);

    expect(mockAuthRequest).toHaveBeenCalledWith("/api/edges/byNode", {
      method: "GET",
      query: { nodeId: "jan-kowalski" },
    });
    expect(el("publish-relation-waiting")).not.toBeNull();
    // An already public relation has nothing left to decide, so listing it
    // would only bury the row that does.
    expect(el("publish-relation-live")).toBeNull();
  });

  it("names the other end of each relation and marks the ones with a proposal waiting", async () => {
    serveRelations([
      relation({
        id: "praca",
        otherName: "Firma sp. z o.o.",
        hasPendingRevision: true,
      }),
    ]);
    wrapper = mountDialog();
    await open(wrapper);

    const row = el("publish-relation-praca") as HTMLElement;
    expect(row.textContent).toContain("Zatrudniony/a w");
    expect(row.textContent).toContain("Firma sp. z o.o.");
    expect(row.textContent).toContain("propozycja czeka na zatwierdzenie");
  });

  it("disables the checkbox of a relation whose other end is still a draft", async () => {
    serveRelations([
      relation({ id: "ready" }),
      relation({
        id: "blocked",
        otherId: "szkic",
        otherName: "Szkic Nieopublikowany",
        otherPublished: false,
        publishable: false,
      }),
    ]);
    wrapper = mountDialog();
    await open(wrapper);

    expect(checkbox("ready")?.disabled).toBe(false);
    // Publishing this edge would be refused by the API, so the row is shown -
    // greyed - rather than hidden, and cannot be ticked.
    expect(checkbox("blocked")?.disabled).toBe(true);
    expect((el("publish-relation-blocked") as HTMLElement).className).toContain(
      "text-disabled",
    );
  });

  it("ticks every publishable relation on 'Zaznacz wszystkie' and none of the blocked ones", async () => {
    serveRelations([
      relation({ id: "ready-a" }),
      relation({ id: "ready-b", otherId: "druga", otherName: "Druga Firma" }),
      relation({ id: "blocked", otherPublished: false, publishable: false }),
    ]);
    wrapper = mountDialog();
    await open(wrapper);

    await click(el("publish-select-all"));

    expect(checkbox("ready-a")?.checked).toBe(true);
    expect(checkbox("ready-b")?.checked).toBe(true);
    expect(checkbox("blocked")?.checked).toBe(false);
    expect(confirmButton().textContent).toContain(
      "Opublikuj stronę i 2 powiązania",
    );
  });

  it("clears the selection when 'Zaznacz wszystkie' is pressed a second time", async () => {
    serveRelations([relation({ id: "ready-a" }), relation({ id: "ready-b" })]);
    wrapper = mountDialog();
    await open(wrapper);

    await click(el("publish-select-all"));
    expect(el("publish-select-all")?.textContent).toContain(
      "Odznacz wszystkie",
    );

    await click(el("publish-select-all"));

    expect(checkbox("ready-a")?.checked).toBe(false);
    expect(checkbox("ready-b")?.checked).toBe(false);
    expect(el("publish-select-all")?.textContent).toContain(
      "Zaznacz wszystkie",
    );
  });

  it("offers only the page itself while nothing is ticked", async () => {
    serveRelations([relation({ id: "ready" })]);
    wrapper = mountDialog();
    await open(wrapper);

    expect(confirmButton().textContent).toContain("Opublikuj tylko stronę");
  });

  it("counts the ticked relations in Polish", async () => {
    serveRelations(
      ["a", "b", "c", "d", "e"].map((id) => relation({ id: `ready-${id}` })),
    );
    wrapper = mountDialog();
    await open(wrapper);

    await click(checkbox("ready-a"));
    expect(confirmButton().textContent).toContain(
      "Opublikuj stronę i 1 powiązanie",
    );

    await click(checkbox("ready-b"));
    expect(confirmButton().textContent).toContain(
      "Opublikuj stronę i 2 powiązania",
    );

    await click(checkbox("ready-c"));
    await click(checkbox("ready-d"));
    await click(checkbox("ready-e"));
    expect(confirmButton().textContent).toContain(
      "Opublikuj stronę i 5 powiązań",
    );
  });

  it("publishes the page on its own when no relation was ticked", async () => {
    serveRelations([relation({ id: "ready" })]);
    wrapper = mountDialog();
    await open(wrapper);

    await click(confirmButton());

    expect(mockAuthRequest).toHaveBeenCalledWith("/api/nodes/publish", {
      body: { node_id: "jan-kowalski", published: true },
    });
    expect(requestedUrls()).not.toContain("/api/edges/publish");
  });

  it("publishes the page before its relations", async () => {
    serveRelations([relation({ id: "ready-a" }), relation({ id: "ready-b" })]);
    wrapper = mountDialog();
    await open(wrapper);
    await click(checkbox("ready-a"));

    await click(confirmButton());

    // Order is load bearing: an edge may not be published while either of its
    // pages is a draft, and this node is one of them until the first call
    // lands.
    expect(requestedUrls()).toEqual([
      "/api/edges/byNode",
      "/api/nodes/publish",
      "/api/edges/publish",
    ]);
    expect(mockAuthRequest).toHaveBeenLastCalledWith("/api/edges/publish", {
      body: { edge_ids: ["ready-a"], published: true },
    });
  });

  it("sends every relation the reviewer ticked, and none it did not", async () => {
    serveRelations([
      relation({ id: "ready-a" }),
      relation({ id: "ready-b" }),
      relation({ id: "ready-c" }),
      relation({ id: "left-alone" }),
    ]);
    wrapper = mountDialog();
    await open(wrapper);

    await click(checkbox("ready-a"));
    await click(checkbox("ready-b"));
    await click(checkbox("ready-c"));

    await click(confirmButton());

    // The whole point of the dialog is that the reviewer decides relation by
    // relation, so the request has to carry exactly the ticks - a set that
    // silently widened would publish a claim nobody looked at, and one that
    // narrowed would leave the page live with relations missing from it.
    const [url, options] = mockAuthRequest.mock.calls.at(-1) as [
      string,
      { body: { edge_ids: string[]; published: boolean } },
    ];
    expect(url).toBe("/api/edges/publish");
    expect(options.body.published).toBe(true);
    expect([...options.body.edge_ids].sort()).toEqual([
      "ready-a",
      "ready-b",
      "ready-c",
    ]);
  });

  it("does not claim the relations went live when the API refused them", async () => {
    serveRelations([relation({ id: "ready-a" }), relation({ id: "ready-b" })]);
    wrapper = mountDialog();
    await open(wrapper);
    await click(el("publish-select-all"));

    // /api/edges/publish refuses the batch as a whole - one blocked relation
    // takes the rest down with it - and by then the page itself is already
    // live. That asymmetry is the state worth pinning: whatever the reviewer
    // is told, it must not be "the relations are published", because they are
    // not, and the dialog is the last place that knows.
    const refusal = Object.assign(new Error("Nie można opublikować"), {
      statusCode: 400,
    });
    mockAuthRequest.mockImplementation(
      async (url: string, opts: { method?: string } = {}) => {
        if (opts.method === "GET")
          return { relations: [], nodePublished: false };
        if (url === "/api/edges/publish") throw refusal;
        return { ok: true, url };
      },
    );

    await click(confirmButton());

    expect(requestedUrls()).toEqual([
      "/api/edges/byNode",
      "/api/nodes/publish",
      "/api/edges/publish",
    ]);
    expect(wrapper.emitted("failed")).toEqual([
      [{ error: refusal, nodePublished: true }],
    ]);
    expect(wrapper.emitted("published")).toBeUndefined();
    // Still open, with the ticks intact, because retrying is the only way out:
    // the page is published now, so reopening the dialog would offer to hide
    // it rather than to publish the relations again.
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    expect(checkbox("ready-a")?.checked).toBe(true);
    expect(checkbox("ready-b")?.checked).toBe(true);
  });

  it("says the page went live without its relations when they are refused", async () => {
    serveRelations([relation({ id: "ready-a" }), relation({ id: "ready-b" })]);
    wrapper = mountDialog();
    await open(wrapper);
    await click(el("publish-select-all"));

    // ofetch parks the parsed body on `data`, which is where the endpoint's
    // own Polish explanation of the refusal arrives.
    mockAuthRequest.mockImplementation(
      async (url: string, opts: { method?: string } = {}) => {
        if (opts.method === "GET")
          return { relations: [], nodePublished: false };
        if (url === "/api/edges/publish")
          throw Object.assign(new Error("400"), {
            data: {
              message:
                "Nie można opublikować powiązania, którego druga strona nie jest opublikowana: Szpital.",
            },
          });
        return { ok: true, url };
      },
    );

    await click(confirmButton());

    const alert = el("publish-relations-failed") as HTMLElement;
    expect(alert).not.toBeNull();
    // The half that did happen is the part the reviewer cannot see, since the
    // dialog is still covering the page whose toggle it just flipped.
    expect(alert.textContent).toContain(
      "Strona została opublikowana, ale powiązania nie",
    );
    // Verbatim, because "which page is holding it back" is the only thing that
    // tells them what to do next.
    expect(alert.textContent).toContain(
      "druga strona nie jest opublikowana: Szpital.",
    );
    // Publishing the page is what puts this dialog out of reach, so the way
    // back to those relations has to be on screen.
    expect(alert.querySelector("a")?.getAttribute("href")).toBe(
      "/admin/krawedzie",
    );
  });

  it("clears the half-published warning when the dialog is reopened", async () => {
    serveRelations([relation({ id: "ready-a" })]);
    wrapper = mountDialog();
    await open(wrapper);
    await click(checkbox("ready-a"));
    mockAuthRequest.mockImplementation(
      async (url: string, opts: { method?: string } = {}) => {
        if (opts.method === "GET")
          return {
            relations: [relation({ id: "ready-a" })],
            nodePublished: true,
          };
        if (url === "/api/edges/publish") throw new Error("400");
        return { ok: true, url };
      },
    );
    await click(confirmButton());
    expect(el("publish-relations-failed")).not.toBeNull();

    await wrapper.setProps({ modelValue: false });
    await open(wrapper);

    // A stale warning on a fresh look would describe an attempt that is no
    // longer the one on screen.
    expect(el("publish-relations-failed")).toBeNull();
  });

  it("reports how many relations went live and closes", async () => {
    serveRelations([relation({ id: "ready-a" }), relation({ id: "ready-b" })]);
    wrapper = mountDialog();
    await open(wrapper);
    await click(el("publish-select-all"));

    await click(confirmButton());

    expect(wrapper.emitted("published")).toEqual([[{ relations: 2 }]]);
    expect(wrapper.emitted("failed")).toBeUndefined();
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([false]);
  });

  it("says which version it is about to publish when nothing is approved", async () => {
    // The page is going live with a version nobody picked, so the dialog names
    // it rather than leaving the reviewer to find out from the table after.
    revisionsResponse = {
      approvedRevisionId: null,
      revisions: [
        {
          id: "rev-old",
          data: { name: "Jan Kowalski" },
          update_time: "2026-07-09T10:00:00Z",
        },
        {
          id: "rev-new",
          data: { name: "Jan Kowalski" },
          update_time: "2026-08-12T10:00:00Z",
        },
      ],
    };
    serveRelations([]);
    wrapper = mountDialog();
    await open(wrapper);

    expect(el("publish-auto-approve")?.textContent).toContain("12.08.2026");
  });

  it("says nothing about approving when every revision is unusable", async () => {
    // Then there is no version to promise, and the publication will be refused
    // outright - which the error says better than a date would.
    revisionsResponse = {
      approvedRevisionId: null,
      revisions: [
        {
          id: "rev-rejected",
          status: "rejected",
          data: { name: "Jan Kowalski" },
          update_time: "2026-08-12T10:00:00Z",
        },
      ],
    };
    serveRelations([]);
    wrapper = mountDialog();
    await open(wrapper);

    expect(el("publish-auto-approve")).toBeNull();
  });

  it("says nothing about approving when the page already has a version", async () => {
    wrapper = mountDialog();
    await open(wrapper);

    expect(el("publish-auto-approve")).toBeNull();
  });

  it("passes on the revision the server approved to get the page live", async () => {
    mockAuthRequest.mockImplementation(
      async (url: string, opts: { method?: string } = {}) =>
        opts.method === "GET"
          ? { relations: [], nodePublished: false }
          : { approvedRevisionId: "rev-new" },
    );
    wrapper = mountDialog();
    await open(wrapper);

    await click(confirmButton());

    expect(wrapper.emitted("published")).toEqual([
      [{ relations: 0, approvedRevisionId: "rev-new" }],
    ]);
  });

  it("stays open and reports the error when publishing fails", async () => {
    serveRelations([relation({ id: "ready" })]);
    wrapper = mountDialog();
    await open(wrapper);
    const failure = new Error("Firestore niedostępny");
    mockAuthRequest.mockRejectedValueOnce(failure);

    await click(confirmButton());

    expect(wrapper.emitted("failed")).toEqual([
      [{ error: failure, nodePublished: false }],
    ]);
    expect(wrapper.emitted("published")).toBeUndefined();
    // The admin has to be able to read the message and retry, so the dialog
    // must not ask its parent to close.
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    expect(confirmButton()).not.toBeNull();
    // Nothing went live at all, so the half-published warning would be a lie.
    expect(el("publish-relations-failed")).toBeNull();
  });

  it("still publishes the page when the relations could not be loaded", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mockAuthRequest.mockImplementation(
      async (_url: string, opts: { method?: string } = {}) => {
        if (opts.method === "GET") throw new Error("500");
        return { ok: true };
      },
    );
    wrapper = mountDialog();
    await open(wrapper);

    expect(el("publish-relations-error")).not.toBeNull();
    expect(confirmButton().textContent).toContain("Opublikuj tylko stronę");

    await click(confirmButton());

    expect(mockAuthRequest).toHaveBeenLastCalledWith("/api/nodes/publish", {
      body: { node_id: "jan-kowalski", published: true },
    });
    expect(wrapper.emitted("published")).toEqual([[{ relations: 0 }]]);
    consoleError.mockRestore();
  });

  it("says so when the node has no relations waiting for publication", async () => {
    serveRelations([relation({ id: "live", published: true })]);
    wrapper = mountDialog();
    await open(wrapper);

    expect((el("publish-no-relations") as HTMLElement).textContent).toContain(
      "Ta strona nie ma powiązań czekających na publikację",
    );
    expect(el("publish-select-all")).toBeNull();
  });

  it("refetches and forgets the previous ticks each time it is reopened", async () => {
    serveRelations([relation({ id: "ready-a" }), relation({ id: "ready-b" })]);
    wrapper = mountDialog();
    await open(wrapper);
    await click(el("publish-select-all"));
    await wrapper.setProps({ modelValue: false });

    await open(wrapper);

    // A second look at the same node can meet a different answer - a relation
    // may have been published elsewhere in the meantime - so the list and the
    // selection both start over.
    expect(requestedUrls()).toEqual(["/api/edges/byNode", "/api/edges/byNode"]);
    expect(confirmButton().textContent).toContain("Opublikuj tylko stronę");
  });
});

/** The two-places warning. Publishing a page used to publish whatever was
 * ticked, and „Zaznacz wszystkie" ticked everything - which is how a
 * namesake's run went live with Mariusz Michał Wiśniewski's page on 10-07 and
 * with Jacek Wojciech Kowalski's on 10-14, and how the second one held the
 * night's people upload. */
describe("PublishNodeDialog.vue - candidacies in two places", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    revisionsResponse = { revisions: [], approvedRevisionId: "rev-approved" };
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    document.body.innerHTML = "";
  });

  /** What the last /api/edges/publish carried, sorted. */
  const publishedIds = () => {
    const call = mockAuthRequest.mock.calls
      .filter(([url]) => url === "/api/edges/publish")
      .at(-1) as [string, { body: { edge_ids: string[] } }] | undefined;
    return [...(call?.[1].body.edge_ids ?? [])].sort();
  };

  it("says which election each candidacy is", async () => {
    // Every candidacy is named „kandydatura", so without the year and the
    // office his four rows read the same.
    serveRelations([candidacy("gniezno-2006", "3003", "2006")]);
    wrapper = mountDialog();
    await open(wrapper);

    expect(el("publish-relation-gniezno-2006")?.textContent).toContain(
      "kandydatura · 2006 · Samorząd",
    );
  });

  it("puts the two places of one election in a block of their own, with how often he stood in each", async () => {
    serveRelations(kowalski());
    wrapper = mountDialog();
    await open(wrapper);

    const block = el("publish-place-clash-2002-local") as HTMLElement;
    expect(block.textContent).toContain("Wybory 2002 · Samorząd");
    expect(
      block.querySelector('[data-testid="publish-relation-kozienice-2002"]')
        ?.textContent,
    ).toContain("tu tylko w 2002");
    expect(
      block.querySelector('[data-testid="publish-relation-gniezno-2002"]')
        ?.textContent,
    ).toContain("tu też w 2006 i 2010");
    // The rest of his page stays in the list below, and only there.
    expect(
      block.querySelector('[data-testid="publish-relation-zol"]'),
    ).toBeNull();
    expect(el("publish-relation-gniezno-2006")).not.toBeNull();
  });

  it("leaves both sides out of „Zaznacz wszystkie”, so publishing everything publishes neither", async () => {
    serveRelations(kowalski());
    wrapper = mountDialog();
    await open(wrapper);

    await click(el("publish-select-all"));
    await click(confirmButton());

    expect(publishedIds()).toEqual(["gniezno-2006", "gniezno-2010", "zol"]);
  });

  it("publishes the side the reviewer picks, and says nothing about it", async () => {
    serveRelations(kowalski());
    wrapper = mountDialog();
    await open(wrapper);

    await click(el("publish-select-all"));
    await click(checkbox("gniezno-2002"));

    expect(el("publish-clash-after")).toBeNull();
    // „Odznacz wszystkie" still means everything, the picked one included.
    expect(el("publish-select-all")?.textContent).toContain(
      "Odznacz wszystkie",
    );

    await click(confirmButton());

    expect(publishedIds()).toEqual([
      "gniezno-2002",
      "gniezno-2006",
      "gniezno-2010",
      "zol",
    ]);
  });

  it("warns by the button once both sides are ticked, and still publishes both if asked", async () => {
    serveRelations(kowalski());
    wrapper = mountDialog();
    await open(wrapper);

    await click(checkbox("gniezno-2002"));
    await click(checkbox("kozienice-2002"));

    const warning = el("publish-clash-after") as HTMLElement;
    expect(warning.textContent).toContain("w wyborach 2002 · Samorząd");
    expect(warning.textContent).toContain(
      "Powiat gnieźnieński i Powiat kozienicki",
    );

    // A warning, not a refusal: the rule is about TERYT prefixes, and the
    // reviewer may know something it does not.
    await click(confirmButton());
    expect(publishedIds()).toEqual(["gniezno-2002", "kozienice-2002"]);
  });

  it("counts a candidacy already live as one side of the clash", async () => {
    serveRelations([
      candidacy("gniezno-2002", "3003", "2002", { published: true }),
      candidacy("kozienice-2002", "1407", "2002"),
    ]);
    wrapper = mountDialog();
    await open(wrapper);

    const live = el("publish-relation-gniezno-2002") as HTMLElement;
    expect(live.textContent).toContain("już opublikowana");
    expect(checkbox("gniezno-2002")?.checked).toBe(true);
    expect(checkbox("gniezno-2002")?.disabled).toBe(true);
    expect(el("publish-clash-after")).toBeNull();

    await click(checkbox("kozienice-2002"));

    expect(el("publish-clash-after")).not.toBeNull();
  });

  it("says nothing about a sejmik run beside a council run inside its województwo", async () => {
    // 30 is Wielkopolskie, and 3003 one of its powiats.
    serveRelations([
      candidacy("sejmik-2002", "30", "2002"),
      candidacy("gniezno-2002", "3003", "2002"),
    ]);
    wrapper = mountDialog();
    await open(wrapper);
    await click(el("publish-select-all"));

    expect(document.body.querySelector(".place-clash")).toBeNull();
    expect(el("publish-clash-after")).toBeNull();
    expect(checkbox("sejmik-2002")?.checked).toBe(true);
    expect(checkbox("gniezno-2002")?.checked).toBe(true);
  });

  it("puts a Senat run and a Sejm run of one year in one block, and names both", async () => {
    // Łukasz Mikołajczyk's page on 2026-10-29: his Senat run in wielkopolskie
    // and a namesake's Sejm run in dolnośląskie, one parliamentary election.
    serveRelations([
      candidacy("senat-2015", "30", "2015", { position: "Senat" }),
      candidacy("sejm-2015", "02", "2015", { position: "Sejm" }),
      candidacy("gniezno-2010", "3003", "2010"),
    ]);
    wrapper = mountDialog();
    await open(wrapper);

    const block = el("publish-place-clash-2015-parliament") as HTMLElement;
    expect(block.textContent).toContain("Wybory 2015 · Senat i Sejm");
    expect(
      block.querySelector('[data-testid="publish-relation-senat-2015"]'),
    ).not.toBeNull();
    expect(
      block.querySelector('[data-testid="publish-relation-sejm-2015"]'),
    ).not.toBeNull();

    await click(el("publish-select-all"));
    expect(checkbox("senat-2015")?.checked).toBe(false);
    expect(checkbox("sejm-2015")?.checked).toBe(false);

    await click(checkbox("senat-2015"));
    await click(checkbox("sejm-2015"));
    expect(el("publish-clash-after")?.textContent).toContain(
      "w wyborach 2015 · Senat i Sejm",
    );
  });

  it("orders the blocks newest election first", async () => {
    serveRelations([
      candidacy("gniezno-2002", "3003", "2002"),
      candidacy("kozienice-2002", "1407", "2002"),
      candidacy("gniezno-2014", "3003", "2014"),
      candidacy("kozienice-2014", "1407", "2014"),
    ]);
    wrapper = mountDialog();
    await open(wrapper);

    const heads = Array.from(
      document.body.querySelectorAll(".place-clash__head"),
    ).map((head) => head.textContent.trim());
    expect(heads[0]).toContain("2014");
    expect(heads[1]).toContain("2002");
  });
});
