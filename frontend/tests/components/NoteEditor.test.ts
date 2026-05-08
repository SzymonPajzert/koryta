import { describe, it, expect, vi, beforeEach } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import NoteEditor from "../../app/components/note/Editor.vue";
import { ref } from "vue";
import { useAuthState } from "~/composables/auth";
import { useNotes } from "~/composables/notes";

// Mocks must be hoisted or at top
vi.mock("~/composables/auth", () => ({
  useAuthState: vi.fn(() => ({ user: ref({ uid: "test-user-id" }) })),
}));

vi.mock("~/composables/notes", () => ({
  useNotes: vi.fn(() => ({
    userNote: ref(null),
    otherNotes: ref([]),
    saveNote: vi.fn(),
  })),
}));

vi.mock("@plausible-analytics/tracker", () => ({
  init: vi.fn(),
  track: vi.fn(),
}));

describe("NoteEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows add source button when logged in but no note exists", async () => {
    (useAuthState as any).mockReturnValue({ user: ref({ uid: "test-user" }) });
    (useNotes as any).mockReturnValue({
      userNote: ref(null),
      otherNotes: ref([]),
      saveNote: vi.fn(),
    });

    const wrapper = await mountSuspended(NoteEditor, {
      props: { nodeId: "node-123" },
    });

    expect(wrapper.text()).toContain("Dodaj źródło");
  });

  it("shows the form when add source button is clicked", async () => {
    (useAuthState as any).mockReturnValue({ user: ref({ uid: "test-user" }) });
    (useNotes as any).mockReturnValue({
      userNote: ref(null),
      otherNotes: ref([]),
      saveNote: vi.fn(),
    });

    const wrapper = await mountSuspended(NoteEditor, {
      props: { nodeId: "node-123" },
    });

    const addSourceBtn = wrapper
      .findAll("button")
      .find((b) => b.text().includes("Dodaj źródło"));
    await addSourceBtn?.trigger("click");

    expect(wrapper.html()).not.toContain("Notatki pozwalają");
    expect(wrapper.html()).toContain("Zapisz");
  });

  it("calls saveNote when save is clicked", async () => {
    (useAuthState as any).mockReturnValue({ user: ref({ uid: "test-user" }) });
    const mockSaveNote = vi.fn().mockResolvedValue(undefined);
    (useNotes as any).mockReturnValue({
      userNote: ref(null),
      otherNotes: ref([]),
      saveNote: mockSaveNote,
    });

    const wrapper = await mountSuspended(NoteEditor, {
      props: { nodeId: "node-123" },
    });

    // Start editing
    const addSourceBtn = wrapper
      .findAll("button")
      .find((b) => b.text().includes("Dodaj źródło"));
    await addSourceBtn?.trigger("click");

    const saveBtn = wrapper
      .findAll("button")
      .find((b) => b.text().includes("Zapisz"));
    expect(saveBtn).toBeTruthy();

    await saveBtn?.trigger("click");

    expect(mockSaveNote).toHaveBeenCalledWith({
      sources: [{ url: "", note: "" }],
    });
  });
});
