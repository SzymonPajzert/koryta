import { describe, it, expect, vi, afterEach } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { ref } from "vue";
import PlaceDetailView from "../../../app/components/place/DetailView.vue";
import CompanySummary from "../../../app/components/card/CompanySummary.vue";
import ConnectionList from "../../../app/components/card/ConnectionList.vue";
import EmploymentHistory from "../../../app/components/card/EmploymentHistory.vue";
import CompanyChanges from "../../../app/components/succession/CompanyChanges.vue";
import DialogEditRelationHost from "../../../app/components/dialog/EditRelationHost.vue";
import DialogRemoveEdgeHost from "../../../app/components/dialog/RemoveEdgeHost.vue";
import NoteEditor from "../../../app/components/note/Editor.vue";
import { authFetch, useAuthState } from "~/composables/auth";
import { useEdges, type EdgeNode } from "~/composables/edges";
import type { EdgeType, Node } from "../../../shared/model";
import type { CompanySuccessions } from "../../../server/api/edges/successions.get";

vi.mock("~/composables/auth", () => ({
  useAuthState: vi.fn(() => ({ user: ref(null), isAdmin: ref(false) })),
  authFetch: vi.fn(),
}));

vi.mock("~/composables/edges", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/composables/edges")>()),
  useEdges: vi.fn(),
}));

vi.mock("@plausible-analytics/tracker", () => ({
  init: vi.fn(),
  track: vi.fn(),
}));

const COMPANY = "skm";

/** An edge into the company from a region or a company, the shape `useEdges`
 * hands the page. */
function into(
  id: string,
  type: EdgeType,
  from: { id: string; name: string; type: "region" | "place" },
): EdgeNode {
  return {
    id,
    type,
    source: from.id,
    target: COMPANY,
    label: type,
    visibility: true,
    richNode: { ...from } as unknown as Node,
  };
}

const GDYNIA = { id: "teryt2262", name: "Gdynia", type: "region" as const };
const GDANSK = {
  id: "teryt2261011",
  name: "Gmina Gdańsk",
  type: "region" as const,
};

async function mountWith(sources: EdgeNode[]) {
  vi.mocked(authFetch).mockReturnValue({
    data: ref({
      node: { id: COMPANY, type: "place", name: "PKP SKM", published: true },
    }),
    status: ref("success"),
    refresh: vi.fn(),
  } as never);
  vi.mocked(useEdges).mockResolvedValue({
    sources: ref(sources),
    targets: ref([]),
    referencedIn: ref([]),
    refresh: vi.fn(),
  } as never);
  return mountSuspended(PlaceDetailView, {
    props: { nodeId: COMPANY },
    // Every child stubbed: the lists, the graph and the comments each fetch on
    // their own, and what is under test is what the page hands them. The
    // card's content is still drawn, since the lists sit inside it.
    shallow: true,
    global: { renderStubDefaultSlot: true },
  });
}

describe("place/DetailView", () => {
  it("reads the location off the seat, not off a region that owns the company", async () => {
    // PKP SKM is registered in Gdynia and part owned by Gmina Gdańsk, whose
    // `owns` edge came back first - and was printed as „Lokalizacja".
    const page = await mountWith([
      into("edge_teryt2261011_skm_owns", "owns", GDANSK),
      into("seat1", "seat", GDYNIA),
    ]);
    expect(page.findComponent(CompanySummary).props("location")).toBe("Gdynia");
  });

  it("lists a gmina that both owns and seats the company once", async () => {
    const page = await mountWith([
      into("seat1", "seat", GDANSK),
      into("edge_teryt2261011_skm_owns", "owns", GDANSK),
      into("seat2", "seat", GDYNIA),
    ]);
    const owners = page
      .findAllComponents(ConnectionList)
      .find((list) => list.props("title") === "Właściciele")!;
    expect(owners.props("edges").map((e: EdgeNode) => e.id)).toEqual([
      "edge_teryt2261011_skm_owns",
      "seat2",
    ]);
    // The seat folded into the owner's row is not a relation the reader has
    // not seen, so it does not come back in the history underneath.
    expect(page.findComponent(EmploymentHistory).props("edges")).toEqual([]);
  });

  it("prints no location for a company with a gmina owner and no seat", async () => {
    const page = await mountWith([
      into("edge_teryt2261011_skm_owns", "owns", GDANSK),
    ]);
    expect(page.findComponent(CompanySummary).props("location")).toBe(
      undefined,
    );
  });
});

/** A post at the company, the shape `useEdges` hands the page: the person at
 * the far end, the company the target. */
function seat(id: string, start: string, end?: string): EdgeNode {
  return {
    id,
    type: "employed",
    source: `p-${id}`,
    target: COMPANY,
    label: "Zarząd",
    visibility: true,
    start_date: start,
    end_date: end,
    richNode: { id: `p-${id}`, type: "person", name: id } as unknown as Node,
  };
}

/** Today's board as `/api/edges/successions` names it: the posts „Obecny
 * skład” draws as cards. */
function board(...edgeIds: string[]): CompanySuccessions {
  return {
    successions: [],
    current: edgeIds.map((edgeId) => ({
      edgeId,
      personId: `p-${edgeId}`,
      personName: edgeId,
      parties: [],
      role: "Zarząd",
      start: "2024-04-12",
    })),
    hidden: 0,
  };
}

/** The page with its posts, the answer about its board in the state the
 * request is in, and whoever is reading. */
async function mountCompany({
  posts = [] as EdgeNode[],
  successions = null as CompanySuccessions | null,
  status = "success",
  signedIn = false,
} = {}) {
  vi.mocked(useAuthState).mockReturnValue({
    user: ref(signedIn ? { uid: "reader" } : null),
    isAdmin: ref(false),
  } as never);
  const refreshSuccessions = vi.fn();
  const refreshEdges = vi.fn();
  vi.mocked(authFetch).mockClear();
  vi.mocked(authFetch).mockImplementation(((url: string) =>
    url === "/api/edges/successions"
      ? {
          data: ref(successions),
          status: ref(status),
          refresh: refreshSuccessions,
        }
      : {
          data: ref({
            node: {
              id: COMPANY,
              type: "place",
              name: "PKP SKM",
              published: true,
            },
          }),
          status: ref("success"),
          refresh: vi.fn(),
        }) as never);
  vi.mocked(useEdges).mockResolvedValue({
    sources: ref([]),
    targets: ref(posts),
    referencedIn: ref([]),
    refresh: refreshEdges,
  } as never);
  const page = await mountSuspended(PlaceDetailView, {
    props: { nodeId: COMPANY },
    shallow: true,
    global: { renderStubDefaultSlot: true },
  });
  return { page, refreshEdges, refreshSuccessions };
}

const ids = (edges: EdgeNode[]) => edges.map((edge) => edge.id);

/** Today's board is drawn once, as the cards of „Obecny skład”: the history
 * under them leaves those posts out (Szymon, 2026-10-23). */
describe("place/DetailView, today's board", () => {
  const posts = [
    seat("prezes", "2024-04-12"),
    seat("czlonek", "2025-01-01"),
    seat("byly", "2016-02-16", "2024-04-12"),
  ];

  afterEach(() => {
    vi.mocked(useAuthState).mockReturnValue({
      user: ref(null),
      isAdmin: ref(false),
    } as never);
  });

  it("leaves the posts the board's cards draw out of the history", async () => {
    const { page } = await mountCompany({
      posts,
      successions: board("prezes"),
    });

    const history = page.findComponent(EmploymentHistory);
    // A post held today that the cards do not show stays, under „Obecnie”.
    expect(ids(history.props("edges"))).toEqual(["czlonek", "byly"]);
    // The caption counts everybody all the same, the board included.
    expect(ids(history.props("captionEdges"))).toEqual([
      "prezes",
      "czlonek",
      "byly",
    ]);
  });

  it("keeps every row until the first answer is in", async () => {
    // There are no cards yet, and a post left out of the history now would
    // be on the page nowhere.
    const { page } = await mountCompany({ posts, status: "pending" });

    expect(ids(page.findComponent(EmploymentHistory).props("edges"))).toEqual([
      "prezes",
      "czlonek",
      "byly",
    ]);
  });

  it("keeps every row once the request has failed", async () => {
    const { page } = await mountCompany({
      posts,
      successions: board("prezes"),
      status: "error",
    });

    expect(ids(page.findComponent(EmploymentHistory).props("edges"))).toEqual([
      "prezes",
      "czlonek",
      "byly",
    ]);
  });

  it("asks once, and hands the answer to the board, the absent line and the relay", async () => {
    const answer = board("prezes");
    const { page } = await mountCompany({ posts, successions: answer });

    const parts = page.findAllComponents(CompanyChanges);
    expect(parts.map((part) => part.props("part"))).toEqual([
      "current",
      "absent",
      "relay",
    ]);
    for (const part of parts) {
      expect(part.props("data")).toStrictEqual(answer);
      expect(part.props("status")).toBe("success");
    }
    expect(
      vi
        .mocked(authFetch)
        .mock.calls.filter(([url]) => url === "/api/edges/successions"),
    ).toHaveLength(1);
  });

  it("gives the board's cards the history's relations and permissions", async () => {
    const { page } = await mountCompany({
      posts,
      successions: board("prezes"),
      signedIn: true,
    });

    const current = page.findAllComponents(CompanyChanges)[0]!;
    const history = page.findComponent(EmploymentHistory);
    expect(ids(current.props("edges"))).toEqual(["prezes", "czlonek", "byly"]);
    for (const permission of [
      "canCite",
      "canCorrect",
      "canRemove",
      "subjectPublished",
    ]) {
      expect(current.props(permission)).toBe(history.props(permission));
    }
    expect(current.props("canCorrect")).toBe(true);
  });

  it("opens the page's own dialogs for a card's correction and bin", async () => {
    const { page } = await mountCompany({
      posts,
      successions: board("prezes"),
      signedIn: true,
    });

    const current = page.findAllComponents(CompanyChanges)[0]!;
    current.vm.$emit("edit", posts[0]);
    await flushPromises();
    const edit = page.findComponent(DialogEditRelationHost);
    expect(edit.props("modelValue")).toBe(true);
    expect(edit.props("edge")).toStrictEqual(posts[0]);

    current.vm.$emit("remove", posts[0]);
    await flushPromises();
    const remove = page.findComponent(DialogRemoveEdgeHost);
    expect(remove.props("modelValue")).toBe(true);
    expect(remove.props("edge")).toStrictEqual(posts[0]);
  });

  it("reads both answers again after a removal, so the post leaves its card too", async () => {
    // Today's board is listed only in its cards: a post removed with its
    // card's bin has to go from there, not only from the history.
    const { page, refreshEdges, refreshSuccessions } = await mountCompany({
      posts,
      successions: board("prezes"),
      signedIn: true,
    });

    page.findComponent(DialogRemoveEdgeHost).vm.$emit("removed");
    await flushPromises();

    expect(refreshEdges).toHaveBeenCalled();
    expect(refreshSuccessions).toHaveBeenCalled();
  });
});

describe("place/DetailView, the page's order", () => {
  it("leads with the people: the board, the history, then what the page lacks", async () => {
    // Then who owns it and what it owns, and only then the handovers, the
    // graph, the press and the notes (Szymon, 2026-10-23).
    const { page } = await mountCompany({
      posts: [seat("prezes", "2024-04-12")],
      successions: board("prezes"),
    });

    const blocks = [...page.get(".k-sections").element.children].map(
      (block) =>
        block.getAttribute("part") ??
        block.getAttribute("title") ??
        block.tagName.toLowerCase().replace(/-stub$/, ""),
    );
    expect(blocks.slice(0, 11)).toEqual([
      "card-company-summary",
      "revision-node-proposals",
      "current",
      "card-employment-history",
      "absent",
      "Właściciele",
      "Spółki zależne",
      "relay",
      "Graf powiązań",
      "mention-article-list",
      "note-editor",
    ]);
  });

  it("gives the header's „Notatki” the notes to scroll to", async () => {
    const { page } = await mountCompany();

    expect(page.findComponent(NoteEditor).attributes("id")).toBe("notatki");
  });

  it("draws no graph for a company with no relations", async () => {
    // Its graph is the one node, which is a heading over nothing.
    const { page } = await mountCompany();

    expect(page.find("[data-testid='entity-graph']").exists()).toBe(false);
  });
});

describe("place/DetailView, owners and subsidiaries", () => {
  afterEach(() => {
    vi.mocked(useAuthState).mockReturnValue({
      user: ref(null),
      isAdmin: ref(false),
    } as never);
  });

  const list = (
    page: Awaited<ReturnType<typeof mountCompany>>["page"],
    title: string,
  ) =>
    page
      .findAllComponents(ConnectionList)
      .find((connections) => connections.props("title") === title)!;

  it("counts each list in its own noun, and says what an empty one lacks", async () => {
    const { page } = await mountCompany();

    expect(list(page, "Właściciele").props()).toMatchObject({
      countNouns: ["podmiot", "podmioty", "podmiotów"],
      emptyText: "Nie znamy właścicieli.",
    });
    expect(list(page, "Spółki zależne").props()).toMatchObject({
      countNouns: ["spółka", "spółki", "spółek"],
      emptyText: "Nie znamy spółek zależnych.",
    });
  });

  it("folds a long list of subsidiaries after twelve for a reader who is not signed in", async () => {
    // Orlen lists about eighty.
    const { page } = await mountCompany();

    expect(list(page, "Spółki zależne").props("foldAfter")).toBe(12);
    // The owners are never that many.
    expect(list(page, "Właściciele").props("foldAfter")).toBeUndefined();
  });

  it("shows a signed in reader every subsidiary", async () => {
    // The contributor's page comes first, and an admin's rows carry controls
    // nothing may put a click away.
    const { page } = await mountCompany({ signedIn: true });

    expect(list(page, "Spółki zależne").props("foldAfter")).toBeUndefined();
  });
});
