import { describe, it, expect, vi, beforeEach } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { nextTick, ref } from "vue";
import EntityDetailsCard from "../../app/components/EntityDetailsCard.vue";
import { useAuthState } from "~/composables/auth";
import type { Article, Person } from "../../shared/model";

vi.mock("~/composables/auth", () => ({
  useAuthState: vi.fn(() => ({
    user: ref({ uid: "test-user" }),
    isAdmin: ref(false),
  })),
  authFetch: vi.fn(),
}));

vi.mock("@plausible-analytics/tracker", () => ({
  init: vi.fn(),
  track: vi.fn(),
}));

const person: Person = {
  id: "jan",
  type: "person",
  name: "Jan Kowalski",
} as Person;

/** The admin controls sit behind `d-none d-md-flex`, so a query on the text is
 * what tells them apart - the class is a media query, not a mount condition. */
const buttonLabels = (wrapper: {
  findAll: (s: string) => { text(): string }[];
}) => wrapper.findAll(".v-btn").map((b) => b.text());

const mountCard = (isAdmin: boolean, extraLocations?: string[]) => {
  (useAuthState as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    user: ref({ uid: "test-user" }),
    isAdmin: ref(isAdmin),
  });
  return mountSuspended(EntityDetailsCard, {
    props: { entity: person, type: "person", extraLocations },
  });
};

describe("EntityDetailsCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("offers an admin the explore shortcut next to the revisions one", async () => {
    const wrapper = await mountCard(true);
    const labels = buttonLabels(wrapper);
    expect(labels).toContain("Eksploruj");
    expect(labels).toContain("Rewizje");
  });

  it("hides both from a reader who is not an admin", async () => {
    const wrapper = await mountCard(false);
    const labels = buttonLabels(wrapper);
    expect(labels).not.toContain("Eksploruj");
    expect(labels).not.toContain("Rewizje");
  });

  it("opens the registers and a query per place the page knows about", async () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);

    // The button is a menu now, so the tabs are one item inside it rather than
    // what the button itself does.
    const wrapper = await mountCard(true, ["Kraków"]);
    const explore = wrapper
      .findAll(".v-btn")
      .find((b) => b.text() === "Eksploruj");
    await explore!.trigger("click");
    await nextTick();
    const all = document.querySelector<HTMLElement>(
      '[data-testid="person-search-all"]',
    );
    expect(all).not.toBeNull();
    all!.click();
    await nextTick();

    const opened = open.mock.calls.map((call) => decodeURIComponent(call[0]));
    expect(opened.some((url) => url.startsWith("https://rejestr.io/"))).toBe(
      true,
    );
    expect(opened.some((url) => url.includes("wikipedia.org"))).toBe(true);
    expect(opened).toContain(
      "https://www.google.com/search?q=Jan Kowalski PKW",
    );
    // The election town the entity itself does not carry - only the page's
    // edges do, and it reaches the button as `extraLocations`.
    expect(opened).toContain(
      "https://www.google.com/search?q=Jan Kowalski Kraków",
    );

    vi.unstubAllGlobals();
  });

  it("lets a long name send the party chips to the next line rather than squeeze them", async () => {
    // jsdom lays nothing out, so this pins the two things the row needs: it
    // may wrap, and `v-card-title`'s `white-space: nowrap` is lifted. With the
    // row on one line a long name kept its full width and the chip - the only
    // item whose `overflow: hidden` lets it shrink - took all the squeeze: on a
    // 393px phone „Wioletta Paprocka-Ślusarska” left her „PO” 13px of its 40.
    const wrapper = await mountSuspended(EntityDetailsCard, {
      props: {
        entity: {
          ...person,
          name: "Wioletta Paprocka-Ślusarska",
          parties: ["PO"],
        } as Person,
        type: "person",
      },
    });
    const title = wrapper.get(".v-card-title");
    expect(title.find(".chip").text()).toBe("PO");
    expect(title.classes()).toContain("flex-wrap");
    expect(title.classes()).toContain("text-wrap");
  });

  it("marks an unpublished page as a draft, and says nothing on a live one", async () => {
    const draft = await mountCard(false);
    expect(draft.text()).toContain("szkic");

    const live = await mountSuspended(EntityDetailsCard, {
      props: {
        entity: { ...person, published: true } as Person,
        type: "person",
      },
    });
    expect(live.text()).not.toContain("szkic");
  });
});

/** The card an article gets when it is opened by id: a draft, or one of the
 * articles an import stored without a name, which have no readable url. */
describe("EntityDetailsCard for an article", () => {
  const nameless = {
    id: "art",
    type: "article",
    name: "",
    sourceURL: "https://www.psl.pl/mamy-liste-357tlustych-kotow",
  } as Article;

  const mountArticle = (signedIn: boolean) => {
    (useAuthState as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      user: ref(signedIn ? { uid: "test-user" } : null),
      isAdmin: ref(false),
    });
    return mountSuspended(EntityDetailsCard, {
      props: { entity: nameless, type: "article" },
    });
  };

  it("says an article has no title rather than showing an empty heading", async () => {
    const wrapper = await mountArticle(true);
    expect(wrapper.get("h2").text()).toBe("Artykuł bez tytułu");
  });

  it("gives a signed in reader the pencil to name it", async () => {
    const wrapper = await mountArticle(true);
    expect(
      wrapper.find('[data-testid="article-propose-change"]').exists(),
    ).toBe(true);
  });

  it("gives a reader who is not signed in no pencil", async () => {
    // Szymon, 2026-10-24: for signed in readers only, as on the article page.
    const wrapper = await mountArticle(false);
    expect(
      wrapper.find('[data-testid="article-propose-change"]').exists(),
    ).toBe(false);
  });
});
