import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ref } from "vue";
import { flushPromises } from "@vue/test-utils";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import VoteButtons from "../../../app/components/extraction/VoteButtons.vue";
import type { VoteCategory } from "../../../shared/model";

/** This reader's vote document, shared by both categories because that is what
 * it is in production: `useVotes("correct")` and `useVotes("insufficient")`
 * read the same `votes/${factId}_${uid}` map (app/composables/votes.ts). A test
 * that gave each its own map could not catch the row writing one axis while
 * reading the other. */
const categoryVotes = ref<Record<string, number>>({});

/** Every `castVote` the row made, tagged with the category it was made on - the
 * component passes a delta and no category, so the category has to be captured
 * where the composable is handed out. */
const { castVote } = vi.hoisted(() => ({
  castVote: vi.fn<(category: string, value: number) => Promise<void>>(),
}));

vi.mock("~/composables/votes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/composables/votes")>();
  return {
    ...actual,
    useVotes: (_id: string, category: VoteCategory) => ({
      userCategoryVotes: categoryVotes,
      config: actual.voteCategoryConfig[category],
      loading: ref(false),
      castVote: (value: number) => castVote(category, value),
    }),
  };
});

/** The three buttons in the order `ExtractionVerdictButtons` renders them. */
const INCORRECT = 0;
const INSUFFICIENT = 1;
const CORRECT = 2;

async function mount() {
  return mountSuspended(VoteButtons, { props: { id: "fact-1" } });
}

describe("ExtractionVoteButtons", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    castVote.mockResolvedValue(undefined);
    categoryVotes.value = {};
  });

  afterEach(() => {
    // The snackbar is teleported out of the wrapper, so it outlives an unmount
    // and the next test would read the previous test's message.
    document.body.innerHTML = "";
  });

  it("aims the delta at the target value", async () => {
    categoryVotes.value = { correct: 1 };
    const buttons = await mount();

    await buttons.findAll("button")[INCORRECT]!.trigger("click");

    // `castVote` applies a delta and the reader is at +1, so „niepoprawny” is
    // -2 rather than -1.
    expect(castVote).toHaveBeenCalledWith("correct", -2);
  });

  it("takes a verdict back when the same button is clicked again", async () => {
    categoryVotes.value = { insufficient: 1 };
    const buttons = await mount();

    await buttons.findAll("button")[INSUFFICIENT]!.trigger("click");

    expect(castVote).toHaveBeenCalledWith("insufficient", -1);
  });

  it("tells the reader when the write was refused", async () => {
    // `castVote` propagates a rules rejection since it started awaiting the
    // `setDoc` (app/composables/votes.ts); this row used to call it without
    // `await`, which made a PERMISSION_DENIED an unhandled promise rejection
    // and left the buttons looking as though the click had landed.
    castVote.mockRejectedValue(
      new Error("Missing or insufficient permissions."),
    );
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const buttons = await mount();

    await buttons.findAll("button")[CORRECT]!.trigger("click");
    await flushPromises();

    expect(document.body.textContent).toContain("Nie udało się zapisać oceny.");
    // The rules message names neither the fact nor the category, so it belongs
    // in the console rather than in the snackbar - but it has to be somewhere.
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });

  it("says nothing when the write lands", async () => {
    const buttons = await mount();

    await buttons.findAll("button")[CORRECT]!.trigger("click");
    await flushPromises();

    expect(castVote).toHaveBeenCalledWith("correct", 1);
    expect(document.body.textContent).not.toContain("Nie udało się");
  });
});
