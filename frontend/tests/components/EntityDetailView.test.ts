import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  mountSuspended,
  mockNuxtImport,
  registerEndpoint,
} from "@nuxt/test-utils/runtime";
import { createError } from "h3";
import { ref } from "vue";
import EntityDetailView from "../../app/components/EntityDetailView.vue";
import NoteEditor from "../../app/components/note/Editor.vue";
import PersonChanges from "../../app/components/succession/PersonChanges.vue";
import PersonTeaser from "../../app/components/card/PersonTeaser.vue";
import { authFetch } from "~/composables/auth";

/** Who is reading. Signed in unless a test says otherwise, so the notes on a
 * person are on the page at all - logged out, a reader does not get them. */
const reader = vi.hoisted(() => ({
  user: { uid: "test-user" } as { uid: string } | null,
}));

vi.mock("~/composables/auth", () => ({
  useAuthState: vi.fn(() => ({
    user: ref(reader.user),
    isAdmin: ref(false),
  })),
  authFetch: vi.fn(),
}));

/** What /api/nodes/[id]/teaser answers, or null for its 404. Each test of a
 * logged out reader mounts its own node id: the view's teaser is async data
 * keyed by the node, and a key shared with a view still mounted from an
 * earlier test would hand back that view's answer. */
let teaserAnswer: Record<string, unknown> | null = null;
for (const id of ["t1", "t2", "t3"]) {
  registerEndpoint(`/api/nodes/${id}/teaser`, () => {
    if (!teaserAnswer) throw createError({ statusCode: 404 });
    return teaserAnswer;
  });
}

/** The page's own relations, running from it: what a person's employments are
 * to the local graph. Empty unless a test says otherwise. */
const outgoing = vi.hoisted(() => ({ edges: [] as unknown[] }));

vi.mock("~/composables/edges", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/composables/edges")>()),
  useEdges: vi.fn(async () => ({
    sources: ref([]),
    targets: ref(outgoing.edges),
    referencedIn: ref([]),
    refresh: vi.fn(),
  })),
}));

mockNuxtImport("usePersonSuccessions", () => () => ({ data: ref(null) }));

vi.mock("@plausible-analytics/tracker", () => ({
  init: vi.fn(),
  track: vi.fn(),
}));

async function mountFor(
  type: "person" | "region",
  status = "success",
  node = "n1",
) {
  vi.mocked(authFetch).mockReturnValue({
    data: ref(
      status === "success"
        ? { node: { id: node, type, name: "Jan Kowalski" } }
        : null,
    ),
    status: ref(status),
    refresh: vi.fn(),
  } as never);
  return mountSuspended(EntityDetailView, {
    props: { node, type },
    // Every child stubbed - the relations, the graph and the comments each
    // fetch on their own - but the card's content still drawn, since the
    // notes sit inside it.
    shallow: true,
    global: { renderStubDefaultSlot: true },
  });
}

describe("EntityDetailView", () => {
  // „Kiedy jest dużo miejsca, to powinny być dwie kolumny (na stronie osoby na
  // komputerze)” - asked of the person page and of nothing else. A region's
  // page is drawn by this same component, and its notes were not part of the
  // request.
  it("asks for the notes in two columns on a person's page only", async () => {
    const person = await mountFor("person");
    expect(person.findComponent(NoteEditor).props("columns")).toBe(true);

    const region = await mountFor("region");
    expect(region.findComponent(NoteEditor).exists()).toBe(true);
    expect(region.findComponent(NoteEditor).props("columns")).toBe(false);
  });

  it("counts the relations the history lists, not the copy it leaves out", async () => {
    // One post at PZO Gliwice, stored once without a role and once as
    // „Prokurent": the history lists it once, so „Zmiany na stanowisku" must
    // say "z 1 powiązania", not "z 2".
    const post = {
      type: "employed",
      source: "n1",
      target: "pzo",
      start_date: "2026-07-14",
      richNode: { id: "pzo", type: "place", name: "PZO Gliwice" },
    };
    outgoing.edges = [
      { ...post, id: "bez-funkcji", label: "Zatrudniony/a w" },
      { ...post, id: "prokurent", name: "Prokurent", label: "Prokurent" },
    ];
    try {
      const person = await mountFor("person");
      expect(person.findComponent(PersonChanges).props("relationCount")).toBe(
        1,
      );
    } finally {
      outgoing.edges = [];
    }
  });
});

/** The wall's own words. Its „Dostęp zastrzeżony" heading is the card's
 * `title` prop, which the shallow mount does not draw. */
const WALL = "Ta strona nie została znaleziona lub oczekuje na zatwierdzenie";

describe("EntityDetailView, logged out on a page nobody has published", () => {
  // /api/nodes/[id] answers a logged out reader's request for an unpublished
  // page with a 404, and the view used to say only „Dostęp zastrzeżony" -
  // not even whose page it was.
  beforeEach(() => {
    reader.user = null;
    teaserAnswer = {
      id: "n1",
      name: "Jan Kowalski",
      post: {
        id: "job",
        name: "Prezes Zarządu",
        start_date: "2023-02-01",
        company: { id: "c1", name: "ENERGA", visibility: true },
      },
      employmentCount: 2,
    };
  });
  afterEach(() => {
    reader.user = { uid: "test-user" };
    teaserAnswer = null;
  });

  it("shows a person's teaser in place of the wall", async () => {
    const view = await mountFor("person", "error", "t1");

    const teaser = view.findComponent(PersonTeaser);
    expect(teaser.exists()).toBe(true);
    expect(teaser.props("teaser")).toEqual(teaserAnswer);
    expect(teaser.props("nodeId")).toBe("t1");
    expect(view.text()).not.toContain(WALL);
  });

  it("keeps the wall where there is no such person", async () => {
    // A removed page, or an id that was never anybody's.
    teaserAnswer = null;
    const view = await mountFor("person", "error", "t2");

    expect(view.findComponent(PersonTeaser).exists()).toBe(false);
    expect(view.text()).toContain(WALL);
  });

  it("keeps the wall on a page that is not a person's", async () => {
    const view = await mountFor("region", "error", "t3");

    expect(view.findComponent(PersonTeaser).exists()).toBe(false);
    expect(view.text()).toContain(WALL);
  });
});
