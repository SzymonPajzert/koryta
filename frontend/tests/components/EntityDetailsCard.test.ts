import { describe, it, expect, vi, beforeEach } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { nextTick, ref } from "vue";
import EntityDetailsCard from "../../app/components/EntityDetailsCard.vue";
import { useAuthState } from "~/composables/auth";
import type { Person } from "../../shared/model";

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

  it("lets „Pokaż więcej” go once the bio is open, and hands focus to the bio", async () => {
    // jsdom lays nothing out, so the four-line clamp and the phone-only media
    // query are not seen here: this pins what the button does, not where.
    const wrapper = await mountSuspended(EntityDetailsCard, {
      props: {
        entity: { ...person, content: "Długi opis. ".repeat(30) } as Person,
        type: "person",
      },
      attachTo: document.body,
    });
    const bio = wrapper.get('[data-testid="person-bio"]');
    const more = wrapper.get('[data-testid="person-bio-more"]');
    expect(bio.classes()).toContain("person-bio--folded");
    expect(more.text()).toBe("Pokaż więcej");
    expect(more.attributes("aria-controls")).toBe(bio.attributes("id"));
    expect(more.find(".v-btn__append .v-icon").exists()).toBe(true);

    await more.trigger("click");
    await flushPromises();

    expect(bio.classes()).not.toContain("person-bio--folded");
    expect(wrapper.find('[data-testid="person-bio-more"]').exists()).toBe(
      false,
    );
    expect(wrapper.text()).not.toContain("Pokaż mniej");
    expect(document.activeElement).toBe(bio.element);
    wrapper.unmount();
  });

  it("shows a short bio whole, with no button", async () => {
    const wrapper = await mountSuspended(EntityDetailsCard, {
      props: {
        entity: { ...person, content: "Krótki opis." } as Person,
        type: "person",
      },
    });
    expect(wrapper.get('[data-testid="person-bio"]').classes()).not.toContain(
      "person-bio--folded",
    );
    expect(wrapper.find('[data-testid="person-bio-more"]').exists()).toBe(
      false,
    );
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
