import { describe, it, expect, vi } from "vitest";
import { mountSuspended, mockNuxtImport } from "@nuxt/test-utils/runtime";
import { ref } from "vue";
import EntityDetailView from "../../app/components/EntityDetailView.vue";
import NoteEditor from "../../app/components/note/Editor.vue";
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

vi.mock("~/composables/edges", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/composables/edges")>()),
  useEdges: vi.fn(async () => ({
    sources: ref([]),
    targets: ref([]),
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
});
