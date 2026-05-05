import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
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

  it("shows create note button when logged in but no note exists", () => {
    (useAuthState as any).mockReturnValue({ user: ref({ uid: "test-user" }) });
    (useNotes as any).mockReturnValue({
      userNote: ref(null),
      otherNotes: ref([]),
      saveNote: vi.fn(),
    });

    const wrapper = mount(NoteEditor, {
      props: { nodeId: "node-123" },
      shallow: true,
      global: {
        stubs: {
          VCard: { template: "<div><slot /></div>" },
          VCardTitle: { template: "<div><slot /></div>" },
          VCardText: { template: "<div><slot /></div>" },
          VBtn: {
            template:
              "<button class='create-btn' @click=\"$emit('click')\"><slot /></button>",
          },
        },
      },
    });

    expect(wrapper.text()).toContain("Stwórz notatkę");
  });

  it("shows the form when create note button is clicked", async () => {
    (useAuthState as any).mockReturnValue({ user: ref({ uid: "test-user" }) });
    (useNotes as any).mockReturnValue({
      userNote: ref(null),
      otherNotes: ref([]),
      saveNote: vi.fn(),
    });

    const wrapper = mount(NoteEditor, {
      props: { nodeId: "node-123" },
      shallow: true,
      global: {
        stubs: {
          VCard: { template: "<div><slot /></div>" },
          VCardTitle: { template: "<div><slot /></div>" },
          VCardText: { template: "<div><slot /></div>" },
          VBtn: {
            template:
              "<button class='btn' @click=\"$emit('click')\"><slot /></button>",
          },
          VTextField: true,
          VTextarea: true,
          VRow: true,
          VCol: true,
        },
      },
    });

    await wrapper.find(".btn").trigger("click");

    // Check if form is visible by checking if Twoja notatka is rendered
    expect(wrapper.html()).toContain("Notatki pozwalają");
  });

  it("calls saveNote when save is clicked", async () => {
    (useAuthState as any).mockReturnValue({ user: ref({ uid: "test-user" }) });
    const mockSaveNote = vi.fn().mockResolvedValue(undefined);
    (useNotes as any).mockReturnValue({
      userNote: ref(null),
      otherNotes: ref([]),
      saveNote: mockSaveNote,
    });

    const wrapper = mount(NoteEditor, {
      props: { nodeId: "node-123" },
      shallow: true,
      global: {
        stubs: {
          VCard: { template: "<div><slot /></div>" },
          VCardTitle: { template: "<div><slot /></div>" },
          VCardText: { template: "<div><slot /></div>" },
          VBtn: {
            template:
              "<button class='btn' @click=\"$emit('click')\"><slot /></button>",
          },
          VTextField: true,
          VTextarea: true,
          VRow: true,
          VCol: true,
        },
      },
    });

    // Start editing
    await wrapper.find(".btn").trigger("click");

    // Find save button (second button, since first might be Anuluj if editing existing, or only one if creating)
    // Actually when creating new, there is no "Anuluj" button according to our template: `v-if="userNote"`
    // So there's only "Zapisz" button + "plus" button for sources.
    const saveBtn = wrapper
      .findAll(".btn")
      .find((b) => b.text().includes("Zapisz"));
    expect(saveBtn).toBeTruthy();

    await saveBtn?.trigger("click");

    expect(mockSaveNote).toHaveBeenCalledWith({
      sources: [],
    });
  });
});
