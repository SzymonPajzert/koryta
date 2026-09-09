import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import QuickVerdict from "../../../app/components/extraction/QuickVerdict.vue";
import type { NodeStats } from "../../../shared/model";

const { castVoteOnce } = vi.hoisted(() => ({
  castVoteOnce: vi.fn().mockResolvedValue(true),
}));

vi.mock("~/composables/votes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/composables/votes")>()),
  castVoteOnce,
}));

const currentUser = ref<{ uid: string } | null>({ uid: "reviewer" });
vi.mock("vuefire", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vuefire")>()),
  useCurrentUser: () => currentUser,
}));

async function mount(props: Record<string, unknown> = {}) {
  return mountSuspended(QuickVerdict, { props: { id: "fact-1", ...props } });
}

/** The three buttons in the order the template renders them. */
const INCORRECT = 0;
const INSUFFICIENT = 1;
const CORRECT = 2;

function votes(fields: Record<string, unknown>): NodeStats["votes"] {
  return fields as NodeStats["votes"];
}

describe("ExtractionQuickVerdict", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    currentUser.value = { uid: "reviewer" };
  });

  it("records a verdict with one write and no listener", async () => {
    // `useVotes` would subscribe to the fact's vote document, and the person
    // page this is built for mounts every card at once.
    const buttons = await mount();

    await buttons.findAll("button")[CORRECT]!.trigger("click");

    expect(castVoteOnce).toHaveBeenCalledTimes(1);
    expect(castVoteOnce).toHaveBeenCalledWith(
      "fact-1",
      "correct",
      1,
      "extraction",
    );
  });

  it("files „nie wiem” on its own axis", async () => {
    const buttons = await mount();

    await buttons.findAll("button")[INSUFFICIENT]!.trigger("click");

    // A reviewer who cannot decide has not said the fact is wrong.
    expect(castVoteOnce).toHaveBeenCalledWith(
      "fact-1",
      "insufficient",
      1,
      "extraction",
    );
  });

  it("takes a verdict back when the same button is clicked again", async () => {
    const buttons = await mount();

    await buttons.findAll("button")[INCORRECT]!.trigger("click");
    await buttons.findAll("button")[INCORRECT]!.trigger("click");

    // Zero rather than a delete: the same document holds this reader's „To nie
    // ta osoba” flag.
    expect(castVoteOnce).toHaveBeenLastCalledWith(
      "fact-1",
      "correct",
      0,
      "extraction",
    );
  });

  it("clears the other axis when a verdict moves across it", async () => {
    const buttons = await mount();

    await buttons.findAll("button")[INSUFFICIENT]!.trigger("click");
    await buttons.findAll("button")[CORRECT]!.trigger("click");

    // Otherwise the fact would count as „za mało informacji” and „poprawny” at
    // once: the two live in separate categories of one merged document.
    expect(castVoteOnce).toHaveBeenNthCalledWith(
      2,
      "fact-1",
      "insufficient",
      0,
      "extraction",
    );
    expect(castVoteOnce).toHaveBeenNthCalledWith(
      3,
      "fact-1",
      "correct",
      1,
      "extraction",
    );
  });

  it("starts on whatever the crowd already settled on", async () => {
    // The aggregate cannot say whether *this* reader voted, and asking would
    // cost the listener. A fact somebody has judged reading as judged is the
    // more useful half of the truth.
    const buttons = await mount({ votes: votes({ correct: 2 }) });

    expect(buttons.findAll("button")[CORRECT]!.classes()).toContain(
      "v-btn--variant-tonal",
    );

    await buttons.findAll("button")[CORRECT]!.trigger("click");
    expect(castVoteOnce).toHaveBeenCalledWith(
      "fact-1",
      "correct",
      0,
      "extraction",
    );
  });

  it("reads a negative sum as a fact readers rejected", async () => {
    const buttons = await mount({ votes: votes({ correct: -1 }) });

    expect(buttons.findAll("button")[INCORRECT]!.classes()).toContain(
      "v-btn--variant-tonal",
    );
  });

  it("writes nothing for a logged out reader", async () => {
    // They are sent to /login, as everywhere else on the site. The router
    // reaches for a `history` this environment does not define; without the
    // stub the navigation rejects out of the click handler and vitest reports
    // an unhandled error for the whole run.
    vi.stubGlobal("history", {
      state: {},
      length: 1,
      scrollRestoration: "auto",
      pushState: () => {},
      replaceState: () => {},
      go: () => {},
    });
    currentUser.value = null;
    const router = useRouter();
    const buttons = await mount();

    await buttons.findAll("button")[CORRECT]!.trigger("click");

    await vi.waitFor(() =>
      expect(router.currentRoute.value.path).toBe("/login"),
    );
    expect(router.currentRoute.value.query.redirect).toBeDefined();
    expect(castVoteOnce).not.toHaveBeenCalled();
  });
});
