import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import WrongPersonButton from "../../../app/components/extraction/WrongPersonButton.vue";

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
  return mountSuspended(WrongPersonButton, {
    props: { id: "fact-1", personName: "Piotr Gajda", ...props },
  });
}

describe("ExtractionWrongPersonButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    currentUser.value = { uid: "reviewer" };
  });

  it("files the flag against the extraction, on its own axis", async () => {
    const button = await mount();

    await button.find("button").trigger("click");

    // Not a shade of `correct`: the sentence can be a good fact about somebody
    // the graph has never heard of.
    expect(castVoteOnce).toHaveBeenCalledWith(
      "fact-1",
      "wrongPerson",
      1,
      "extraction",
    );
    expect(button.text()).toContain("Zgłoszono złe dopasowanie");
  });

  it("takes the flag back with a second click", async () => {
    const button = await mount();

    await button.find("button").trigger("click");
    await button.find("button").trigger("click");

    // Zero rather than a delete: the vote document also holds this reviewer's
    // verdict on the fact itself.
    expect(castVoteOnce).toHaveBeenLastCalledWith(
      "fact-1",
      "wrongPerson",
      0,
      "extraction",
    );
    expect(button.text()).toContain("To nie ta osoba");
  });

  it("starts flagged when somebody else already reported the match", async () => {
    const button = await mount({ reported: 2 });

    expect(button.text()).toContain("Zgłoszono złe dopasowanie");

    await button.find("button").trigger("click");

    expect(castVoteOnce).toHaveBeenCalledWith(
      "fact-1",
      "wrongPerson",
      0,
      "extraction",
    );
  });

  it("files nothing for a logged out reader", async () => {
    // They are sent to /login instead, the same as every other vote on the
    // site - what matters here is that the click does not silently write a
    // flag nobody can be held to.
    //
    // That redirect is a real navigation, and the router reaches for a
    // `history` this environment does not define; without the stub it rejects
    // out of the click handler and vitest reports an unhandled error for the
    // whole run.
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
    const button = await mount();

    await button.find("button").trigger("click");

    // Waited for rather than assumed. The component does not await its own
    // `router.push`, and vue-router finishes the navigation on a timer - so
    // under a full run the last leg of it lands after this file's teardown has
    // taken the stub back, and `history is not defined` is reported as an
    // unhandled rejection against whatever was running by then. Holding the
    // test open until the route has actually moved keeps the stub in place for
    // as long as the navigation needs it, and says what the redirect is while
    // it is here.
    await vi.waitFor(() =>
      expect(router.currentRoute.value.path).toBe("/login"),
    );
    expect(router.currentRoute.value.query.redirect).toBeDefined();

    expect(castVoteOnce).not.toHaveBeenCalled();
  });
});
