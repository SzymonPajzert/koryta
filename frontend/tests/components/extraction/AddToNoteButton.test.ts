import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import AddToNoteButton from "../../../app/components/extraction/AddToNoteButton.vue";
import type { ExtractionFact, Note } from "../../../shared/model";

const userNote = ref<Note | null>(null);
const { saveNote } = vi.hoisted(() => ({
  saveNote: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/composables/notes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/composables/notes")>()),
  useNotes: () => ({ userNote, saveNote, otherNotes: ref([]) }),
}));

function fact(fields: Partial<ExtractionFact> = {}): ExtractionFact {
  return {
    id: "fact-1",
    url: "example.com/a",
    articleUrl: "example.com/a",
    articleDomain: "example.com",
    justification: "prezesem spółki został Piotr Gajda",
    fact_type: "employment",
    person: "Piotr Gajda",
    organization: "Wodociągi Miejskie",
    role: "prezes",
    personNodeId: "abc123",
    personNodeName: "Piotr Gajda",
    tag: "v26",
    ...fields,
  } as ExtractionFact;
}

async function mount(fields: Partial<ExtractionFact> = {}) {
  return mountSuspended(AddToNoteButton, {
    props: { fact: fact(fields), nodeId: "abc123" },
  });
}

describe("ExtractionAddToNoteButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userNote.value = null;
  });

  it("files the fact as a source, with its quote and its article", async () => {
    const button = await mount();

    await button.find("button").trigger("click");

    // A source and not a correction: the reader is saying the piece is worth
    // reading, and `noteNeedsAction` would put a correction in the admin queue.
    expect(saveNote).toHaveBeenCalledWith({
      sources: [
        {
          kind: "source",
          url: "https://example.com/a",
          note: "Zatrudnienie: Piotr Gajda - prezes - Wodociągi Miejskie. Cytat z artykułu: „prezesem spółki został Piotr Gajda”",
        },
      ],
    });
    expect(button.text()).toContain("W Twojej notatce");
  });

  it("keeps the entries the reader already wrote", async () => {
    // `saveNote` merges fields and `sources` is one field, so an append that
    // forgets what is there deletes the author's own note.
    userNote.value = {
      userUid: "reader",
      nodeId: "abc123",
      sources: [{ url: "wyborcza.pl/x", note: "znalazłem to sam" }],
    };
    const button = await mount();

    await button.find("button").trigger("click");

    const sources = saveNote.mock.calls[0]![0].sources;
    expect(sources).toHaveLength(2);
    expect(sources[0]).toEqual({
      url: "wyborcza.pl/x",
      note: "znalazłem to sam",
    });
  });

  it("does not offer a fact the note already carries", async () => {
    userNote.value = {
      userUid: "reader",
      nodeId: "abc123",
      sources: [
        {
          url: "https://example.com/a",
          // Matched on the quote inside the entry, not on the whole of it: the
          // note is the reader's own text and they may write around the
          // citation.
          note: "Ważne: prezesem spółki został Piotr Gajda - sprawdzić KRS",
        },
      ],
    };
    const button = await mount();

    expect(button.text()).toContain("W Twojej notatce");
    expect(button.find("button").attributes("disabled")).toBeDefined();
  });

  it("says so when the write fails, and lets the reader try again", async () => {
    // The note is a section away and its own save is not involved, so a silent
    // failure looks exactly like a stored entry until the page is reloaded.
    vi.spyOn(console, "error").mockImplementation(() => {});
    saveNote.mockRejectedValueOnce(new Error("offline"));
    const button = await mount();

    await button.find("button").trigger("click");
    await vi.waitFor(() =>
      expect(button.text()).toContain("Nie udało się zapisać"),
    );
    expect(button.find("button").attributes("disabled")).toBeUndefined();

    await button.find("button").trigger("click");
    expect(saveNote).toHaveBeenCalledTimes(2);
  });

  it("offers nothing for a fact with neither a quote nor an article", async () => {
    // Everything that makes the entry worth having comes from the article; the
    // claim alone is the card the reader is already looking at.
    const button = await mount({ justification: "", articleUrl: "" });

    expect(button.find("button").exists()).toBe(false);
  });

  it("stores a url Firestore will take, from one stored without a protocol", async () => {
    const button = await mount({ justification: "" });

    await button.find("button").trigger("click");

    expect(saveNote.mock.calls[0]![0].sources[0]).toEqual({
      kind: "source",
      url: "https://example.com/a",
      note: "Zatrudnienie: Piotr Gajda - prezes - Wodociągi Miejskie.",
    });
  });
});
