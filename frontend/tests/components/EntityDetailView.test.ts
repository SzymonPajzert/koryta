import { describe, it, expect, vi } from "vitest";
import { mountSuspended, mockNuxtImport } from "@nuxt/test-utils/runtime";
import { ref } from "vue";
import EntityDetailView from "../../app/components/EntityDetailView.vue";
import NoteEditor from "../../app/components/note/Editor.vue";
import PersonChanges from "../../app/components/succession/PersonChanges.vue";
import { authFetch } from "~/composables/auth";

// Signed in, so the notes on a person are on the page at all - logged out, a
// reader does not get them.
vi.mock("~/composables/auth", () => ({
  useAuthState: vi.fn(() => ({
    user: ref({ uid: "test-user" }),
    isAdmin: ref(false),
  })),
  authFetch: vi.fn(),
}));

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

async function mountFor(type: "person" | "region") {
  vi.mocked(authFetch).mockReturnValue({
    data: ref({ node: { id: "n1", type, name: "Jan Kowalski" } }),
    status: ref("success"),
    refresh: vi.fn(),
  } as never);
  return mountSuspended(EntityDetailView, {
    props: { node: "n1", type },
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
